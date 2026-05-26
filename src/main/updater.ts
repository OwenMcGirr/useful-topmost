import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdateState =
  | { status: 'unsupported'; reason: string }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; version?: string; percent?: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

export interface UpdateController {
  getState(): UpdateState;
  checkNow(): Promise<UpdateState>;
  quitAndInstall(): void;
}

function getUnsupportedState(): UpdateState | null {
  if (!app.isPackaged) {
    return { status: 'unsupported', reason: 'Updates are only available in packaged builds.' };
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return { status: 'unsupported', reason: 'Linux auto updates require the AppImage package.' };
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return { status: 'unsupported', reason: 'Auto updates are only configured for Windows and Linux AppImage.' };
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createUpdateController(sendToRenderer: (state: UpdateState) => void): UpdateController {
  const unsupported = getUnsupportedState();
  let state: UpdateState = unsupported ?? { status: 'idle' };

  const setState = (next: UpdateState) => {
    state = next;
    sendToRenderer(state);
  };

  if (!unsupported) {
    autoUpdater.autoDownload = true;
    autoUpdater.allowPrerelease = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => setState({ status: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }));
    autoUpdater.on('download-progress', (progress) =>
      setState({ status: 'downloading', percent: progress.percent }));
    autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }));
    autoUpdater.on('error', (error) => setState({ status: 'error', message: errorMessage(error) }));
  }

  return {
    getState: () => state,
    checkNow: async () => {
      if (unsupported) return state;
      try {
        void autoUpdater.checkForUpdates().catch((error) => {
          setState({ status: 'error', message: errorMessage(error) });
        });
        return state;
      } catch (error) {
        setState({ status: 'error', message: errorMessage(error) });
        return state;
      }
    },
    quitAndInstall: () => {
      if (state.status === 'downloaded') {
        autoUpdater.quitAndInstall();
      }
    }
  };
}
