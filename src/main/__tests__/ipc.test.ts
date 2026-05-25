import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWidgetStore } from '../widget-store';
import { registerIpc } from '../ipc';

function fakeIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: (channel: string, fn: any) => handlers.set(channel, fn),
    handlers,
    invoke: (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args)
  };
}

function fakeSender() {
  const sent: any[] = [];
  return {
    send: (channel: string, payload: any) => sent.push({ channel, payload }),
    sent
  };
}

describe('ipc', () => {
  it('widget:create creates a widget, runs codex, and sends widget:ready on success', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, runCodex as any, () => sender as any);

    const { uuid } = await ipc.invoke('widget:create', 'p');
    // Wait for the codex run + ready event to flush.
    await new Promise((r) => setTimeout(r, 10));

    expect(typeof uuid).toBe('string');
    expect(runCodex).toHaveBeenCalled();
    expect(sender.sent).toContainEqual({ channel: 'widget:ready', payload: { uuid } });
  });

  it('widget:create sends widget:error when codex fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async () => ({ ok: false, error: 'boom' }));

    registerIpc(ipc as any, store, runCodex as any, () => sender as any);

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'boom' } });
  });

  it('widget:delete removes the widget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, runCodex as any, () => sender as any);
    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    await ipc.invoke('widget:delete', uuid);

    expect((await store.list()).map((w) => w.uuid)).not.toContain(uuid);
  });

  it('widget:list returns widgets via store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, runCodex as any, () => sender as any);
    await ipc.invoke('widget:create', 'first');
    await new Promise((r) => setTimeout(r, 10));

    const list = await ipc.invoke('widget:list');
    expect(list).toHaveLength(1);
    expect(list[0].prompt).toBe('first');
  });
});
