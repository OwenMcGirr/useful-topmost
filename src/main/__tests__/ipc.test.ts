import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWidgetStore } from '../widget-store';
import { createSecretsStore } from '../secrets-store';
import { createOnboardingStore } from '../onboarding-store';
import { registerIpc } from '../ipc';

function fakeIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: (channel: string, fn: any) => handlers.set(channel, fn),
    handlers,
    invoke: (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args),
    invokeWithEvent: (channel: string, event: any, ...args: any[]) => handlers.get(channel)!(event, ...args)
  };
}

function fakeSender() {
  const sent: any[] = [];
  return {
    send: (channel: string, payload: any) => sent.push({ channel, payload }),
    sent
  };
}

async function waitForSent(sender: ReturnType<typeof fakeSender>, expected: any) {
  for (let i = 0; i < 20; i += 1) {
    if (sender.sent.some((message) => JSON.stringify(message) === JSON.stringify(expected))) return;
    await new Promise((r) => setTimeout(r, 5));
  }
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

  it('widget:chatStart creates a widget, records chat, runs codex, and sends ready', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd, prompt }: any) => {
      expect(prompt).toContain('Conversation history:');
      expect(prompt).toContain('make a timer');
      await fs.writeFile(path.join(cwd, 'index.html'), '<html>timer</html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const { uuid } = await ipc.invoke('widget:chatStart', 'make a timer');
    await new Promise((r) => setTimeout(r, 10));

    const meta = await store.getMeta(uuid);
    expect(meta.chat?.map((m) => m.text)).toEqual(['make a timer', 'Updated']);
    expect(sender.sent).toContainEqual({ channel: 'widget:ready', payload: { uuid } });
  });

  it('widget:chatStart records failure and sends widget:error', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async () => ({ ok: false, error: 'bad prompt' }));

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const { uuid } = await ipc.invoke('widget:chatStart', 'make a timer');
    await new Promise((r) => setTimeout(r, 10));

    const meta = await store.getMeta(uuid);
    expect(meta.chat?.at(-1)?.text).toBe('Failed: bad prompt');
    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'bad prompt' } });
  });

  it('widget:chatSend uses current HTML and chat history, then replaces live HTML on success', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const uuid = await store.create('make a clock');
    await store.replaceWidgetHtml(uuid, '<html>old</html>');
    await store.appendChatMessage(uuid, { id: 'm1', role: 'user', text: 'make a clock', created_at: 't1' });
    const runCodex = vi.fn(async ({ cwd, prompt }: any) => {
      expect(prompt).toContain('<html>old</html>');
      expect(prompt).toContain('make it blue');
      await fs.writeFile(path.join(cwd, 'index.html'), '<html>new</html>');
      return { ok: true, path: path.join(cwd, 'index.html') };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    expect(await ipc.invoke('widget:chatSend', uuid, 'make it blue')).toEqual({ ok: true });
    await waitForSent(sender, { channel: 'widget:ready', payload: { uuid } });

    expect(await store.readWidgetHtml(uuid)).toBe('<html>new</html>');
    expect((await store.getMeta(uuid)).prompt).toBe('make it blue');
    expect(sender.sent).toContainEqual({ channel: 'widget:ready', payload: { uuid } });
  });

  it('widget:chatSend preserves live HTML on failure and returns persisted chat', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const uuid = await store.create('make a clock');
    await store.replaceWidgetHtml(uuid, '<html>old</html>');
    const runCodex = vi.fn(async () => ({ ok: false, error: 'nope' }));

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    expect(await ipc.invoke('widget:chatSend', uuid, 'break it')).toEqual({ ok: true });
    await waitForSent(sender, { channel: 'widget:error', payload: { uuid, error: 'nope' } });

    expect(await store.readWidgetHtml(uuid)).toBe('<html>old</html>');
    const chat = await ipc.invoke('widget:chatList', uuid);
    expect(chat.map((m: any) => m.text)).toEqual(['break it', 'Failed: nope']);
    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'nope' } });
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

  it('widget:list includes pinned state from the store', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const uuid = await store.create('first');
    await store.setPinned(uuid, true);

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const list = await ipc.invoke('widget:list');
    expect(list).toEqual([expect.objectContaining({ uuid, pinned: true })]);
  });

  it('widget:setPinned persists Boolean-coerced pinned state', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const uuid = await store.create('first');

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    expect(await ipc.invoke('widget:setPinned', uuid, 'yes')).toEqual({ ok: true });
    expect((await store.getMeta(uuid)).pinned).toBe(true);

    await ipc.invoke('widget:setPinned', uuid, 0);
    expect((await store.getMeta(uuid)).pinned).toBe(false);
  });

  it('widget:list does not include staging directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const uuid = await store.create('first');
    await fs.mkdir(path.join(store.widgetsRoot(), '.staging', 'draft'), { recursive: true });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const list = await ipc.invoke('widget:list');
    expect(list.map((w: any) => w.uuid)).toEqual([uuid]);
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

  it('app:exec runs from the sender widget folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const uuid = await store.create('run gh');
    const htmlPath = store.htmlPath(uuid);

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invokeWithEvent(
      'app:exec',
      { senderFrame: { url: pathToFileURL(htmlPath).toString() } },
      process.execPath,
      ['-e', 'process.stdout.write(process.cwd())']
    );

    expect(result).toEqual({
      ok: true,
      stdout: store.dir(uuid),
      exitCode: 0,
      truncated: false
    });
  });

  it('app:exec rejects sender URLs outside the widgets root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const outsideHtml = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'outside-widget-')), 'index.html');

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invokeWithEvent(
      'app:exec',
      { senderFrame: { url: pathToFileURL(outsideHtml).toString() } },
      process.execPath,
      ['-e', 'process.stdout.write("blocked")']
    );

    expect(result).toEqual({
      ok: false,
      stdout: '',
      exitCode: null,
      truncated: false,
      error: 'local exec is only available to widget files'
    });
  });

  it('app:exec rejects non-file sender URLs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invokeWithEvent(
      'app:exec',
      { senderFrame: { url: 'https://example.com/index.html' } },
      process.execPath,
      ['-e', 'process.stdout.write("blocked")']
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('local exec is only available to widget files');
  });

  it('app:exec rejects malformed widget paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();
    const malformed = path.join(store.widgetsRoot(), 'abc', 'nested', 'index.html');

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any);

    const result = await ipc.invokeWithEvent(
      'app:exec',
      { senderFrame: { url: pathToFileURL(malformed).toString() } },
      process.execPath,
      ['-e', 'process.stdout.write("blocked")']
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('local exec is only available to widget files');
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
