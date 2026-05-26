import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createWidgetStore } from './widget-store';
import { createSecretsStore } from './secrets-store';
import { createOnboardingStore } from './onboarding-store';
import { runCodex } from './codex-runner';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  const store = createWidgetStore(userData);
  const secrets = createSecretsStore(userData);
  const onboarding = createOnboardingStore(userData);
  registerIpc(ipcMain, store, secrets, onboarding, runCodex, () => mainWindow!.webContents);

  ipcMain.handle('app:codexStatus', () => checkCodexStatus());
  ipcMain.handle('app:codexAvailable', async () => {
    const status = await checkCodexStatus();
    return status.installed && status.authenticated;
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
