import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createWidgetStore } from './widget-store';
import { createSecretsStore } from './secrets-store';
import { runCodex } from './codex-runner';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;

function checkCodexAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // shell: true so Windows finds the npm-global codex.cmd shim.
    const child = spawn('codex', ['--version'], { shell: true });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
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
  const store = createWidgetStore(app.getPath('userData'));
  const secrets = createSecretsStore(app.getPath('userData'));
  registerIpc(ipcMain, store, secrets, runCodex, () => mainWindow!.webContents);

  ipcMain.handle('app:codexAvailable', () => checkCodexAvailable());

  createWindow();
});

app.on('window-all-closed', () => app.quit());
