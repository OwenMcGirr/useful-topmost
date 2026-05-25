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
});
