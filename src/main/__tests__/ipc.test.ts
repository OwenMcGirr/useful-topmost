import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWidgetStore } from '../widget-store';
import { createSecretsStore } from '../secrets-store';
import { createOnboardingStore } from '../onboarding-store';
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
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

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
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async () => ({ ok: false, error: 'boom' }));

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'boom' } });
  });

  it('widget:delete removes the widget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);
    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    await ipc.invoke('widget:delete', uuid);

    expect((await store.list()).map((w) => w.uuid)).not.toContain(uuid);
  });

  it('widget:list returns widgets via store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);
    await ipc.invoke('widget:create', 'first');
    await new Promise((r) => setTimeout(r, 10));

    const list = await ipc.invoke('widget:list');
    expect(list).toHaveLength(1);
    expect(list[0].prompt).toBe('first');
  });

  // ----- API key feature -----
  it('secrets:save adds a provider; secrets:list returns it without value', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const provider = {
      id: 'p1',
      name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query' as const, param: 'appid' },
      value: 'SECRET'
    };

    const saveResult = await ipc.invoke('secrets:save', provider);
    expect(saveResult).toEqual({ ok: true });

    const list = await ipc.invoke('secrets:list');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', name: 'OpenWeather' });
    expect('value' in list[0]).toBe(false);
  });

  it('secrets:save validates: empty name returns ok:false', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invoke('secrets:save', {
      id: 'p1',
      name: '',
      hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' },
      value: 'V'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/i);
    expect(await ipc.invoke('secrets:list')).toEqual([]);
  });

  it('secrets:save on update with empty value preserves the existing value', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const provider = {
      id: 'p1',
      name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query' as const, param: 'appid' },
      value: 'ORIGINAL'
    };
    await ipc.invoke('secrets:save', provider);

    const result = await ipc.invoke('secrets:save', { ...provider, name: 'OpenWeather X', value: '' });
    expect(result).toEqual({ ok: true });

    const stillThere = await secrets.listForProxy();
    expect(stillThere[0].value).toBe('ORIGINAL');
    expect(stillThere[0].name).toBe('OpenWeather X');
  });

  it('secrets:save on create with empty value returns ok:false', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invoke('secrets:save', {
      id: 'fresh',
      name: 'X',
      hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' },
      value: ''
    });

    expect(result.ok).toBe(false);
    expect(await secrets.listForProxy()).toEqual([]);
  });

  it('secrets:delete removes the provider', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    await ipc.invoke('secrets:save', {
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    });
    await ipc.invoke('secrets:delete', 'p1');

    expect(await ipc.invoke('secrets:list')).toEqual([]);
  });

  it('app:fetch delegates to proxy and returns the envelope', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('OK', { status: 200, headers: { 'x-h': '1' } })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    try {
      const env = await ipc.invoke('app:fetch', 'https://example.com/');
      expect(env).toEqual({ status: 200, headers: expect.objectContaining({ 'x-h': '1' }), body: 'OK' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('widget:create passes providers to buildPrompt via runCodex', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    await secrets.save({
      id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'SECRET'
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);
    await ipc.invoke('widget:create', 'show weather');
    await new Promise((r) => setTimeout(r, 10));

    const callArg = runCodex.mock.calls[0][0];
    expect(callArg.prompt).toContain('Available providers:');
    expect(callArg.prompt).toContain('OpenWeather');
    expect(callArg.prompt).not.toContain('SECRET');
    expect(callArg.prompt).toMatch(/The user's request:\s*show weather$/);
  });

  it('app:widgetPreloadUrl returns a file:// URL to the bundled widget preload', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const url = await ipc.invoke('app:widgetPreloadUrl');
    expect(typeof url).toBe('string');
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/widget.js')).toBe(true);
  });

  // ----- Onboarding -----
  it('onboarding:get returns { dismissed: false } by default', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    expect(await ipc.invoke('onboarding:get')).toEqual({ dismissed: false });
  });

  it('onboarding:dismiss persists, and subsequent get returns dismissed:true', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const onboarding = createOnboardingStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, onboarding, runCodex as any, () => sender as any);

    const result = await ipc.invoke('onboarding:dismiss');
    expect(result).toEqual({ ok: true });

    const state = await ipc.invoke('onboarding:get');
    expect(state.dismissed).toBe(true);
    expect(typeof state.completedAt).toBe('string');
  });
});
