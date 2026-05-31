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
    expect(await store.get()).toEqual({ geekMode: false, lanServer: { enabled: false, port: 32177 } });
  });

  it('get() returns defaults (no throw) when prefs.json is corrupted', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'prefs.json'), 'not json');
    const store = createPrefsStore(root);
    expect(await store.get()).toEqual({ geekMode: false, lanServer: { enabled: false, port: 32177 } });
  });

  it('setGeekMode(true) persists, and a fresh store sees it on disk', async () => {
    const root = await freshRoot();
    await createPrefsStore(root).setGeekMode(true);

    const fresh = createPrefsStore(root);
    expect(await fresh.get()).toEqual({ geekMode: true, lanServer: { enabled: false, port: 32177 } });
  });

  it('setGeekMode round-trip toggles', async () => {
    const root = await freshRoot();
    const store = createPrefsStore(root);
    await store.setGeekMode(true);
    expect((await store.get()).geekMode).toBe(true);
    await store.setGeekMode(false);
    expect((await store.get()).geekMode).toBe(false);
  });

  it('get() backfills LAN defaults for older prefs.json files', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'prefs.json'), JSON.stringify({ geekMode: true }));
    const store = createPrefsStore(root);
    expect(await store.get()).toEqual({ geekMode: true, lanServer: { enabled: false, port: 32177 } });
  });

  it('get() falls back to the default LAN port when the stored port is invalid', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'prefs.json'), JSON.stringify({ lanServer: { enabled: true, port: 80 } }));
    const store = createPrefsStore(root);
    expect(await store.get()).toEqual({ geekMode: false, lanServer: { enabled: true, port: 32177 } });
  });

  it('setLanServer persists and preserves geekMode', async () => {
    const root = await freshRoot();
    const store = createPrefsStore(root);
    await store.setGeekMode(true);
    await store.setLanServer({ enabled: true, port: 32178 });

    expect(await store.get()).toEqual({ geekMode: true, lanServer: { enabled: true, port: 32178 } });
  });

  it('setGeekMode preserves LAN prefs', async () => {
    const root = await freshRoot();
    const store = createPrefsStore(root);
    await store.setLanServer({ enabled: true, port: 32178 });
    await store.setGeekMode(true);

    expect(await store.get()).toEqual({ geekMode: true, lanServer: { enabled: true, port: 32178 } });
  });
});
