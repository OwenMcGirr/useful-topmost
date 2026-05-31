import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Prefs {
  geekMode: boolean;
  lanServer: {
    enabled: boolean;
    port: number;
  };
}

export interface PrefsStore {
  get(): Promise<Prefs>;
  setGeekMode(value: boolean): Promise<void>;
  setLanServer(value: Prefs['lanServer']): Promise<void>;
}

export const DEFAULT_LAN_SERVER_PORT = 32177;

const DEFAULT_PREFS: Prefs = {
  geekMode: false,
  lanServer: {
    enabled: false,
    port: DEFAULT_LAN_SERVER_PORT
  }
};

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function normalizePrefs(parsed: Partial<Prefs> | null | undefined): Prefs {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS, lanServer: { ...DEFAULT_PREFS.lanServer } };
  const lanServer = typeof parsed.lanServer === 'object' && parsed.lanServer !== null
    ? parsed.lanServer
    : undefined;

  return {
    geekMode: typeof parsed.geekMode === 'boolean' ? parsed.geekMode : DEFAULT_PREFS.geekMode,
    lanServer: {
      enabled: typeof lanServer?.enabled === 'boolean' ? lanServer.enabled : DEFAULT_PREFS.lanServer.enabled,
      port: validPort(lanServer?.port) ? lanServer.port : DEFAULT_PREFS.lanServer.port
    }
  };
}

export function createPrefsStore(root: string): PrefsStore {
  const filePath = path.join(root, 'prefs.json');

  const read = async (): Promise<Prefs> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      return normalizePrefs(parsed);
    } catch {
      return normalizePrefs(undefined);
    }
  };

  const write = async (next: Prefs): Promise<void> => {
    await fs.writeFile(filePath, JSON.stringify(next, null, 2));
  };

  return {
    get: () => read(),
    async setGeekMode(value: boolean) {
      const current = await read();
      await write({ ...current, geekMode: value });
    },

    async setLanServer(value: Prefs['lanServer']) {
      if (!validPort(value.port)) throw new Error('port must be between 1024 and 65535');
      const current = await read();
      await write({
        ...current,
        lanServer: {
          enabled: value.enabled,
          port: value.port
        }
      });
    }
  };
}
