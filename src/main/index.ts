import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createWidgetStore } from './widget-store';
import { createSecretsStore } from './secrets-store';
import { createOnboardingStore } from './onboarding-store';
import { createPrefsStore } from './prefs-store';
import { createLanServerController } from './lan-server';
import { runCodex } from './codex-runner';
import { registerIpc } from './ipc';
import { createUpdateController } from './updater';
import { isExternalHttpUrl } from './external-links';

// Hand external http(s) URLs to the system default browser. Applied to both the
// main window and every attached widget webview so:
//   - <a target="_blank"> / window.open → opens in the user's browser, no new
//     Electron window appears.
//   - <a href="https://…"> click (no target) inside a widget → opens externally;
//     the widget's own frame is not navigated away.
// Internal navigations (file://, dev-server URL) pass through unchanged.
function attachExternalLinkHandlers(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isExternalHttpUrl(url) && url !== contents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

let mainWindow: BrowserWindow | null = null;
const APP_USER_MODEL_ID = 'com.owenmcgirr.useful-topmost';
let stopLanServer: (() => Promise<void>) | null = null;

function runCodexCommand(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    // shell: true so Windows finds the npm-global codex.cmd shim.
    const child = spawn('codex', args, { shell: true });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
}

async function checkCodexStatus(): Promise<CodexStatus> {
  const installed = await runCodexCommand(['--version']);
  if (!installed) return { installed: false, authenticated: false };
  const authenticated = await runCodexCommand(['login', 'status']);
  return { installed: true, authenticated };
}

function appIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#0d1117',
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  attachExternalLinkHandlers(mainWindow.webContents);
  mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
    attachExternalLinkHandlers(webviewContents);
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Single-instance lock. If another copy is already running, hand the focus to
// it and quit silently. The second-instance event below restores and focuses
// the existing window when a user re-launches the .exe / .desktop.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  const userData = app.getPath('userData');
  const store = createWidgetStore(userData);
  const secrets = createSecretsStore(userData);
  const onboarding = createOnboardingStore(userData);
  const prefs = createPrefsStore(userData);
  const lan = createLanServerController({ widgets: store, secrets });
  stopLanServer = () => lan.stop();
  registerIpc(ipcMain, store, secrets, onboarding, runCodex, () => mainWindow!.webContents, prefs, lan);
  void prefs.get().then((p) => lan.applyConfig(p.lanServer));

  ipcMain.handle('app:codexStatus', () => checkCodexStatus());
  ipcMain.handle('app:codexAvailable', async () => {
    const status = await checkCodexStatus();
    return status.installed && status.authenticated;
  });

  createWindow();

  const updates = createUpdateController((state) => {
    mainWindow?.webContents.send('update:state', state);
  });

  ipcMain.handle('update:getState', () => updates.getState());
  ipcMain.handle('update:checkNow', () => updates.checkNow());
  ipcMain.handle('update:restart', () => updates.quitAndInstall());

  setTimeout(() => void updates.checkNow(), 5000);
});

app.on('before-quit', () => {
  if (stopLanServer) void stopLanServer();
});

app.on('window-all-closed', () => app.quit());
