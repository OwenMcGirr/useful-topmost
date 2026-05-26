import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload?: any) => void;

const mocked = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const autoUpdater = {
    autoDownload: false,
    allowPrerelease: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, listener: Listener) => {
      const current = listeners.get(event) ?? [];
      listeners.set(event, [...current, listener]);
      return autoUpdater;
    }),
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    emit: (event: string, payload?: any) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    reset: () => {
      listeners.clear();
      autoUpdater.autoDownload = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.on.mockClear();
      autoUpdater.checkForUpdates.mockReset().mockResolvedValue(undefined);
      autoUpdater.quitAndInstall.mockClear();
    }
  };
  return { app: { isPackaged: false }, autoUpdater };
});

vi.mock('electron', () => ({ app: mocked.app }));
vi.mock('electron-updater', () => ({ autoUpdater: mocked.autoUpdater }));

const originalPlatform = process.platform;
const originalAppImage = process.env.APPIMAGE;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

async function loadUpdater() {
  vi.resetModules();
  return import('../updater');
}

beforeEach(() => {
  mocked.app.isPackaged = false;
  mocked.autoUpdater.reset();
  delete process.env.APPIMAGE;
  setPlatform(originalPlatform);
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = originalAppImage;
});

describe('updater', () => {
  it('returns unsupported in development mode', async () => {
    mocked.app.isPackaged = false;
    setPlatform('win32');
    const { createUpdateController } = await loadUpdater();

    const controller = createUpdateController(vi.fn());

    expect(controller.getState()).toEqual({
      status: 'unsupported',
      reason: 'Updates are only available in packaged builds.'
    });
    expect(await controller.checkNow()).toEqual(controller.getState());
    expect(mocked.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('returns unsupported for Linux packages that are not AppImage', async () => {
    mocked.app.isPackaged = true;
    setPlatform('linux');
    const { createUpdateController } = await loadUpdater();

    const controller = createUpdateController(vi.fn());

    expect(controller.getState()).toEqual({
      status: 'unsupported',
      reason: 'Linux auto updates require the AppImage package.'
    });
  });

  it('configures prerelease auto-downloads and checks on Windows packaged builds', async () => {
    mocked.app.isPackaged = true;
    setPlatform('win32');
    const { createUpdateController } = await loadUpdater();

    const controller = createUpdateController(vi.fn());
    await controller.checkNow();

    expect(mocked.autoUpdater.autoDownload).toBe(true);
    expect(mocked.autoUpdater.allowPrerelease).toBe(true);
    expect(mocked.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(mocked.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('uses downloaded state to gate quitAndInstall', async () => {
    mocked.app.isPackaged = true;
    setPlatform('win32');
    const { createUpdateController } = await loadUpdater();
    const send = vi.fn();
    const controller = createUpdateController(send);

    controller.quitAndInstall();
    expect(mocked.autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    mocked.autoUpdater.emit('update-downloaded', { version: '2026.1.0-alpha.2' });

    expect(controller.getState()).toEqual({ status: 'downloaded', version: '2026.1.0-alpha.2' });
    expect(send).toHaveBeenCalledWith({ status: 'downloaded', version: '2026.1.0-alpha.2' });

    controller.quitAndInstall();
    expect(mocked.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('supports Linux AppImage packaged builds', async () => {
    mocked.app.isPackaged = true;
    setPlatform('linux');
    process.env.APPIMAGE = '/tmp/useful-topmost.AppImage';
    const { createUpdateController } = await loadUpdater();

    const controller = createUpdateController(vi.fn());
    await controller.checkNow();

    expect(controller.getState().status).not.toBe('unsupported');
    expect(mocked.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
