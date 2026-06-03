import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from 'electron';

export interface StartupState {
  enabled: boolean;
  supported: boolean;
  platform: NodeJS.Platform;
  error?: string;
}

export interface StartupController {
  getState(): Promise<StartupState>;
  setEnabled(enabled: boolean): Promise<StartupState>;
}

export interface StartupControllerOptions {
  app: Pick<App, 'getLoginItemSettings' | 'setLoginItemSettings'>;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  homeDir?: string;
}

const DESKTOP_FILE_NAME = 'useful-topmost.desktop';

function unsupported(platform: NodeJS.Platform): StartupState {
  return {
    enabled: false,
    supported: false,
    platform,
    error: 'start with system is not supported on this platform'
  };
}

function linuxConfigHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME
    : path.join(homeDir, '.config');
}

function linuxAutostartPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  return path.join(linuxConfigHome(env, homeDir), 'autostart', DESKTOP_FILE_NAME);
}

function linuxExecPath(env: NodeJS.ProcessEnv, execPath: string): string {
  return env.APPIMAGE && env.APPIMAGE.trim() ? env.APPIMAGE : execPath;
}

function quoteDesktopExec(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function desktopFile(execPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Useful Topmost',
    `Exec=${quoteDesktopExec(execPath)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n');
}

function isDesktopFileEnabled(raw: string): boolean {
  return !raw.split(/\r?\n/).some((line) => /^\s*Hidden\s*=\s*true\s*$/i.test(line));
}

export function createStartupController(options: StartupControllerOptions): StartupController {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return {
      async getState() {
        return unsupported(platform);
      },
      async setEnabled() {
        return unsupported(platform);
      }
    };
  }

  if (platform === 'win32' || platform === 'darwin') {
    return {
      async getState() {
        try {
          return {
            enabled: Boolean(options.app.getLoginItemSettings().openAtLogin),
            supported: true,
            platform
          };
        } catch (e: any) {
          return {
            enabled: false,
            supported: true,
            platform,
            error: e?.message ?? 'could not read startup setting'
          };
        }
      },
      async setEnabled(enabled: boolean) {
        try {
          options.app.setLoginItemSettings({ openAtLogin: enabled });
          return {
            enabled: Boolean(options.app.getLoginItemSettings().openAtLogin),
            supported: true,
            platform
          };
        } catch (e: any) {
          return {
            enabled: false,
            supported: true,
            platform,
            error: e?.message ?? 'could not update startup setting'
          };
        }
      }
    };
  }

  const autostartPath = linuxAutostartPath(env, homeDir);

  return {
    async getState() {
      try {
        const raw = await fs.readFile(autostartPath, 'utf8');
        return {
          enabled: isDesktopFileEnabled(raw),
          supported: true,
          platform
        };
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          return {
            enabled: false,
            supported: true,
            platform
          };
        }
        return {
          enabled: false,
          supported: true,
          platform,
          error: e?.message ?? 'could not read startup setting'
        };
      }
    },
    async setEnabled(enabled: boolean) {
      try {
        if (enabled) {
          await fs.mkdir(path.dirname(autostartPath), { recursive: true });
          await fs.writeFile(autostartPath, desktopFile(linuxExecPath(env, execPath)), 'utf8');
        } else {
          await fs.rm(autostartPath, { force: true });
        }
        return await this.getState();
      } catch (e: any) {
        return {
          enabled: false,
          supported: true,
          platform,
          error: e?.message ?? 'could not update startup setting'
        };
      }
    }
  };
}
