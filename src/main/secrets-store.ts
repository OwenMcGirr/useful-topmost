import { promises as fs } from 'node:fs';
import path from 'node:path';

export type AuthStrategy =
  | { type: 'query'; param: string }
  | { type: 'header'; name: string; prefix?: string };

export interface Provider {
  id: string;
  name: string;
  hostnames: string[];
  auth: AuthStrategy;
  value: string;
}

export type PublicProvider = Omit<Provider, 'value'>;

export interface SecretsStore {
  list(): Promise<PublicProvider[]>;
  listForProxy(): Promise<Provider[]>;
  save(p: Provider): Promise<void>;
  delete(id: string): Promise<void>;
}

interface SecretsFile {
  providers: Provider[];
}

export function createSecretsStore(root: string): SecretsStore {
  const filePath = path.join(root, 'secrets.json');

  let writeChain: Promise<void> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const read = async (): Promise<SecretsFile> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as SecretsFile;
      if (!parsed || !Array.isArray(parsed.providers)) return { providers: [] };
      return parsed;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return { providers: [] };
      // Corrupted JSON or read error: treat as empty.
      return { providers: [] };
    }
  };

  const write = (data: SecretsFile) =>
    fs.writeFile(filePath, JSON.stringify(data, null, 2));

  const strip = (p: Provider): PublicProvider => {
    const { value: _value, ...rest } = p;
    return rest;
  };

  return {
    async list() {
      const f = await read();
      return f.providers.map(strip);
    },

    async listForProxy() {
      const f = await read();
      return f.providers;
    },

    async save(p) {
      await withLock(async () => {
        const f = await read();
        const idx = f.providers.findIndex((x) => x.id === p.id);
        if (idx >= 0) f.providers[idx] = p;
        else f.providers.push(p);
        await write(f);
      });
    },

    async delete(id) {
      await withLock(async () => {
        const f = await read();
        f.providers = f.providers.filter((x) => x.id !== id);
        await write(f);
      });
    }
  };
}
