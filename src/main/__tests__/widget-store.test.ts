import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWidgetStore } from '../widget-store';

async function freshRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'widget-store-'));
}

describe('widget-store', () => {
  it('create() appends uuid, writes meta.json, creates the widget folder', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);

    const uuid = await store.create('show the weather');

    const meta = JSON.parse(await fs.readFile(path.join(root, 'widgets', uuid, 'meta.json'), 'utf8'));
    expect(meta.prompt).toBe('show the weather');
    expect(typeof meta.created_at).toBe('string');

    const dashboard = JSON.parse(await fs.readFile(path.join(root, 'dashboard.json'), 'utf8'));
    expect(dashboard.widgets).toEqual([uuid]);
  });

  it('list() returns widgets in stored order with meta', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const a = await store.create('first');
    const b = await store.create('second');

    const items = await store.list();

    expect(items.map((w) => w.uuid)).toEqual([a, b]);
    expect(items[0].prompt).toBe('first');
    expect(items[1].prompt).toBe('second');
    expect(items[0].pinned).toBe(false);
  });

  it('list() returns pinned state for pinned widgets', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('important');

    await store.setPinned(uuid, true);

    expect(await store.list()).toEqual([
      expect.objectContaining({ uuid, pinned: true })
    ]);
  });

  it('delete() removes uuid from dashboard and deletes the folder', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('temp');

    await store.delete(uuid);

    const dashboard = JSON.parse(await fs.readFile(path.join(root, 'dashboard.json'), 'utf8'));
    expect(dashboard.widgets).toEqual([]);
    await expect(fs.access(path.join(root, 'widgets', uuid))).rejects.toThrow();
  });

  it('two concurrent create() calls produce different uuids, both stored', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);

    const [a, b] = await Promise.all([store.create('a'), store.create('b')]);

    expect(a).not.toBe(b);
    const dashboard = JSON.parse(await fs.readFile(path.join(root, 'dashboard.json'), 'utf8'));
    expect(dashboard.widgets.sort()).toEqual([a, b].sort());
  });

  it('list() returns empty array when dashboard.json does not exist yet', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    expect(await store.list()).toEqual([]);
  });

  it('htmlPath(uuid) returns the absolute path to the widget HTML file', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('p');
    expect(store.htmlPath(uuid)).toBe(path.join(root, 'widgets', uuid, 'index.html'));
  });

  it('appends and replaces chat messages', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('p');
    const userMessage = { id: 'm1', role: 'user' as const, text: 'make a clock', created_at: 'now' };
    const statusMessage = { id: 'm2', role: 'status' as const, text: 'Building...', created_at: 'now', status: 'building' as const };

    await store.appendChatMessage(uuid, userMessage);
    await store.appendChatMessage(uuid, statusMessage);
    await store.replaceChatMessage(uuid, 'm2', { ...statusMessage, text: 'Updated', status: 'updated' });

    expect((await store.getMeta(uuid)).chat).toEqual([
      userMessage,
      { ...statusMessage, text: 'Updated', status: 'updated' }
    ]);
  });

  it('updates prompt', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('old');

    await store.updatePrompt(uuid, 'new');

    expect((await store.getMeta(uuid)).prompt).toBe('new');
  });

  it('sets pinned state', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('p');

    await store.setPinned(uuid, true);
    expect((await store.getMeta(uuid)).pinned).toBe(true);

    await store.setPinned(uuid, false);
    expect((await store.getMeta(uuid)).pinned).toBe(false);
  });

  it('setPinned rejects for missing widgets', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);

    await expect(store.setPinned('missing', true)).rejects.toThrow();
  });

  it('sets size and surfaces it in list()', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('p');

    expect((await store.list())[0].size).toBeUndefined();

    await store.setSize(uuid, 'large');
    expect((await store.getMeta(uuid)).size).toBe('large');
    expect((await store.list())[0].size).toBe('large');
  });

  it('reads and replaces widget HTML', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('p');

    expect(await store.readWidgetHtml(uuid)).toBeNull();
    await store.replaceWidgetHtml(uuid, '<html>ok</html>');

    expect(await store.readWidgetHtml(uuid)).toBe('<html>ok</html>');
  });

  it('existing widgets without chat still load', async () => {
    const root = await freshRoot();
    const store = createWidgetStore(root);
    const uuid = await store.create('legacy');
    const metaPath = path.join(root, 'widgets', uuid, 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    delete meta.chat;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    expect(await store.list()).toEqual([{ uuid, prompt: 'legacy', created_at: meta.created_at, pinned: false }]);
    expect((await store.getMeta(uuid)).chat).toBeUndefined();
  });
});
