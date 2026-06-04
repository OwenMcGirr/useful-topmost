import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CacheEntry {
  value: unknown;
  fetchedAt?: number;
  expiresAt?: number;
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
      if (value && typeof value === 'object' && 'value' in (value as object)) {
        const fetchedAt = typeof (value as any).fetchedAt === 'number' ? (value as any).fetchedAt : undefined;
        const expiresAt = typeof (value as any).expiresAt === 'number' ? (value as any).expiresAt : undefined;
        if (fetchedAt !== undefined || expiresAt !== undefined) {
          out[key] = { value: (value as any).value, fetchedAt, expiresAt };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function getCacheEntry(widgetDir: string, key: string, ttlMs: number): Promise<CacheEntry | null> {
  if (ttlMs <= 0) return null;
  const cache = await readCache(widgetDir);
  const entry = cache[key];
  if (!entry) return null;
  if (entry.fetchedAt !== undefined) {
    if (entry.fetchedAt + ttlMs <= Date.now()) return null;
    return entry;
  }
  if (entry.expiresAt === undefined || entry.expiresAt <= Date.now()) return null;
  return entry;
}

export async function getCacheEntryUnexpired(widgetDir: string, key: string): Promise<CacheEntry | null> {
  const cache = await readCache(widgetDir);
  return cache[key] ?? null;
}

export async function writeCacheEntry(
  widgetDir: string,
  key: string,
  value: unknown,
  ttlMs: number
): Promise<void> {
  if (ttlMs <= 0) return;
  const now = Date.now();
  const cache = await readCache(widgetDir);
  cache[key] = { value, fetchedAt: now, expiresAt: now + ttlMs };
  await fs.writeFile(cachePath(widgetDir), JSON.stringify(cache, null, 2));
}

export async function writeWebhookCacheEntry(
  widgetDir: string,
  payload: unknown,
  receivedAt: string
): Promise<void> {
  const cache = await readCache(widgetDir);
  cache.webhook = {
    value: { receivedAt, payload },
    fetchedAt: Date.now()
  };
  await fs.writeFile(cachePath(widgetDir), JSON.stringify(cache, null, 2));
}
