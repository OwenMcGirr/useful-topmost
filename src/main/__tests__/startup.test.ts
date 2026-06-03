import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStartupController } from '../startup';

function fakeApp(openAtLogin = false) {
  let value = openAtLogin;
  return {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: value })),
    setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => {
      value = Boolean(settings.openAtLogin);
    })
  };
}

async function freshHome(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'startup-home-'));
}

describe('startup controller', () => {
  it('maps Windows openAtLogin to enabled and updates login item settings', async () => {
    const app = fakeApp(true);
    const controller = createStartupController({ app, platform: 'win32' });

    expect(await controller.getState()).toEqual({ enabled: true, supported: true, platform: 'win32' });

    expect(await controller.setEnabled(false)).toEqual({ enabled: false, supported: true, platform: 'win32' });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });

    expect(await controller.setEnabled(true)).toEqual({ enabled: true, supported: true, platform: 'win32' });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('maps macOS openAtLogin to enabled and updates login item settings', async () => {
    const app = fakeApp(true);
    const controller = createStartupController({ app, platform: 'darwin' });

    expect(await controller.getState()).toEqual({ enabled: true, supported: true, platform: 'darwin' });

    await controller.setEnabled(false);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it('returns disabled on Linux when the autostart file is absent', async () => {
    const homeDir = await freshHome();
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: {},
      execPath: '/opt/useful-topmost/useful-topmost',
      homeDir
    });

    expect(await controller.getState()).toEqual({ enabled: false, supported: true, platform: 'linux' });
  });

  it('creates a Linux autostart desktop file with the resolved executable', async () => {
    const homeDir = await freshHome();
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: {},
      execPath: '/opt/useful-topmost/useful-topmost',
      homeDir
    });

    expect(await controller.setEnabled(true)).toEqual({ enabled: true, supported: true, platform: 'linux' });

    const autostartFile = path.join(homeDir, '.config', 'autostart', 'useful-topmost.desktop');
    const raw = await fs.readFile(autostartFile, 'utf8');
    expect(raw).toContain('Type=Application');
    expect(raw).toContain('Name=Useful Topmost');
    expect(raw).toContain('Exec="/opt/useful-topmost/useful-topmost"');
    expect(raw).toContain('Terminal=false');
    expect(raw).toContain('X-GNOME-Autostart-enabled=true');
  });

  it('uses APPIMAGE over process execPath for Linux autostart', async () => {
    const homeDir = await freshHome();
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: { APPIMAGE: '/home/user/Useful Topmost.AppImage' },
      execPath: '/tmp/.mount/useful-topmost',
      homeDir
    });

    await controller.setEnabled(true);

    const raw = await fs.readFile(path.join(homeDir, '.config', 'autostart', 'useful-topmost.desktop'), 'utf8');
    expect(raw).toContain('Exec="/home/user/Useful Topmost.AppImage"');
    expect(raw).not.toContain('/tmp/.mount/useful-topmost');
  });

  it('uses XDG_CONFIG_HOME for Linux autostart when present', async () => {
    const homeDir = await freshHome();
    const configHome = path.join(homeDir, 'xdg-config');
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: { XDG_CONFIG_HOME: configHome },
      execPath: '/opt/useful-topmost/useful-topmost',
      homeDir
    });

    await controller.setEnabled(true);

    expect(await fs.stat(path.join(configHome, 'autostart', 'useful-topmost.desktop'))).toBeTruthy();
  });

  it('removes the Linux autostart desktop file when disabled', async () => {
    const homeDir = await freshHome();
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: {},
      execPath: '/opt/useful-topmost/useful-topmost',
      homeDir
    });

    await controller.setEnabled(true);
    expect(await controller.setEnabled(false)).toEqual({ enabled: false, supported: true, platform: 'linux' });
    await expect(fs.stat(path.join(homeDir, '.config', 'autostart', 'useful-topmost.desktop'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats an existing Linux desktop file with Hidden=true as disabled', async () => {
    const homeDir = await freshHome();
    const autostartDir = path.join(homeDir, '.config', 'autostart');
    await fs.mkdir(autostartDir, { recursive: true });
    await fs.writeFile(path.join(autostartDir, 'useful-topmost.desktop'), '[Desktop Entry]\nHidden=true\n');
    const controller = createStartupController({
      app: fakeApp(),
      platform: 'linux',
      env: {},
      execPath: '/opt/useful-topmost/useful-topmost',
      homeDir
    });

    expect(await controller.getState()).toEqual({ enabled: false, supported: true, platform: 'linux' });
  });

  it('reports unsupported platforms without mutating login settings', async () => {
    const app = fakeApp();
    const controller = createStartupController({ app, platform: 'freebsd' });

    expect(await controller.getState()).toEqual({
      enabled: false,
      supported: false,
      platform: 'freebsd',
      error: 'start with system is not supported on this platform'
    });
    expect(await controller.setEnabled(true)).toEqual({
      enabled: false,
      supported: false,
      platform: 'freebsd',
      error: 'start with system is not supported on this platform'
    });
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
