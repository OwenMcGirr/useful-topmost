import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCacheEntry, readCache, writeCacheEntry } from '../widget-cache-store';

async function freshDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'widget-cache-'));
}

describe('widget-cache-store', () => {
  it('getCacheEntry returns null when cache.json does not exist', async () => {
    const dir = await freshDir();
    expect(await getCacheEntry(dir, 'k')).toBeNull();
  });

  it('writeCacheEntry persists; getCacheEntry returns it; readCache surfaces it', async () => {
    const dir = await freshDir();
    await writeCacheEntry(dir, 'weather', { temp: 17 }, 60_000);
    const entry = await getCacheEntry(dir, 'weather');
    expect(entry).not.toBeNull();
    expect(entry!.value).toEqual({ temp: 17 });
    expect(entry!.expiresAt).toBeGreaterThan(Date.now());

    const all = await readCache(dir);
    expect(Object.keys(all)).toEqual(['weather']);
  });

  it('setting two keys retains both', async () => {
    const dir = await freshDir();
    await writeCacheEntry(dir, 'a', 1, 60_000);
    await writeCacheEntry(dir, 'b', 2, 60_000);
    const all = await readCache(dir);
    expect(all.a.value).toBe(1);
    expect(all.b.value).toBe(2);
  });

  it('expired entries return null from getCacheEntry', async () => {
    const dir = await freshDir();
    // Write directly with an already-past expiry so we don't depend on time travel.
    await fs.writeFile(path.join(dir, 'cache.json'), JSON.stringify({
      stale: { value: 'old', expiresAt: Date.now() - 1000 }
    }));
    expect(await getCacheEntry(dir, 'stale')).toBeNull();
  });

  it('corrupt cache.json is treated as empty without throwing', async () => {
    const dir = await freshDir();
    await fs.writeFile(path.join(dir, 'cache.json'), 'not json');
    expect(await readCache(dir)).toEqual({});
    expect(await getCacheEntry(dir, 'k')).toBeNull();
  });

  it('writeCacheEntry with ttlMs <= 0 is a no-op', async () => {
    const dir = await freshDir();
    await writeCacheEntry(dir, 'k', 'v', 0);
    expect(await readCache(dir)).toEqual({});
    await writeCacheEntry(dir, 'k', 'v', -1);
    expect(await readCache(dir)).toEqual({});
  });
});
