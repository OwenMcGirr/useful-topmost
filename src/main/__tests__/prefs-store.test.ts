import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPrefsStore } from '../prefs-store';

async function freshRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'prefs-store-'));
}

describe('prefs-store', () => {
  it('get() returns geekMode:false when prefs.json does not exist', async () => {
    const root = await freshRoot();
    const store = createPrefsStore(root);
    expect(await store.get()).toEqual({ geekMode: false });
  });

  it('get() returns defaults (no throw) when prefs.json is corrupted', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'prefs.json'), 'not json');
    const store = createPrefsStore(root);
    expect(await store.get()).toEqual({ geekMode: false });
  });

  it('setGeekMode(true) persists, and a fresh store sees it on disk', async () => {
    const root = await freshRoot();
    await createPrefsStore(root).setGeekMode(true);

    const fresh = createPrefsStore(root);
    expect(await fresh.get()).toEqual({ geekMode: true });
  });

  it('setGeekMode round-trip toggles', async () => {
    const root = await freshRoot();
    const store = createPrefsStore(root);
    await store.setGeekMode(true);
    expect((await store.get()).geekMode).toBe(true);
    await store.setGeekMode(false);
    expect((await store.get()).geekMode).toBe(false);
  });
});
