import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const FILE_NAME = 'cache.json';

function cachePath(widgetDir: string): string {
  return path.join(widgetDir, FILE_NAME);
}

export async function readCache(widgetDir: string): Promise<Record<string, CacheEntry>> {
  try {
    const raw = await fs.readFile(cachePath(widgetDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CacheEntry> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'value' in (value as object) && typeof (value as any).expiresAt === 'number') {
        out[key] = { value: (value as any).value, expiresAt: (value as any).expiresAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getCacheEntry(widgetDir: string, key: string): Promise<CacheEntry | null> {
  const cache = await readCache(widgetDir);
  const entry = cache[key];
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

export async function writeCacheEntry(
  widgetDir: string,
  key: string,
  value: unknown,
  ttlMs: number
): Promise<void> {
  if (ttlMs <= 0) return;
  const cache = await readCache(widgetDir);
  cache[key] = { value, expiresAt: Date.now() + ttlMs };
  await fs.writeFile(cachePath(widgetDir), JSON.stringify(cache, null, 2));
}
