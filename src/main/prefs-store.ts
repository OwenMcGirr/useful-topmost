import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Prefs {
  geekMode: boolean;
}

export interface PrefsStore {
  get(): Promise<Prefs>;
  setGeekMode(value: boolean): Promise<void>;
}

const DEFAULT_PREFS: Prefs = { geekMode: false };

export function createPrefsStore(root: string): PrefsStore {
  const filePath = path.join(root, 'prefs.json');

  const read = async (): Promise<Prefs> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
      return {
        geekMode: typeof parsed.geekMode === 'boolean' ? parsed.geekMode : DEFAULT_PREFS.geekMode
      };
    } catch {
      return { ...DEFAULT_PREFS };
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
    }
  };
}
