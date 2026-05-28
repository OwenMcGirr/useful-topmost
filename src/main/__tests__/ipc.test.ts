import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWidgetStore } from '../widget-store';
import { createSecretsStore } from '../secrets-store';
import { createOnboardingStore } from '../onboarding-store';
import { createPrefsStore } from '../prefs-store';
import { parseProviderLookupResponse, registerIpc } from '../ipc';

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'boom' } });
  });

  it('widget:create polls plan.json and emits widget:plan with parsed providers (filters bad entries)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'plan.json'), JSON.stringify({
        providers_needed: [
          { name: 'Cloudflare API', hostname: 'api.cloudflare.com' },
          { name: '   ', hostname: 'api.bad.com' },
          { name: 'No host', hostname: '' },
          { name: 'Stripe', hostname: 'api.stripe.com' }
        ]
      }));
      // Sleep a tick so the plan poller has a chance to read before exit.
      await new Promise((r) => setTimeout(r, 600));
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'show cloudflare stats');
    await new Promise((r) => setTimeout(r, 800));

    const planEvents = sender.sent.filter((m) => m.channel === 'widget:plan' && m.payload.uuid === uuid);
    expect(planEvents).toHaveLength(1);
    expect(planEvents[0].payload.providers).toEqual([
      { name: 'Cloudflare API', hostname: 'api.cloudflare.com' },
      { name: 'Stripe', hostname: 'api.stripe.com' }
    ]);
  });

  it('widget:create does not emit widget:plan when plan.json is malformed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'plan.json'), 'not json');
      await new Promise((r) => setTimeout(r, 600));
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 800));

    expect(sender.sent.filter((m) => m.channel === 'widget:plan' && m.payload.uuid === uuid)).toHaveLength(0);
  });

  it('widget:chatSend does not emit widget:plan (revisions skip plan polling)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      // Even if Codex did write a plan.json during a revision, no event should fire.
      await fs.writeFile(path.join(cwd, 'plan.json'), JSON.stringify({
        providers_needed: [{ name: 'Stripe', hostname: 'api.stripe.com' }]
      }));
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const uuid = await store.create('p');
    await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html>v1</html>');
    await ipc.invoke('widget:chatSend', uuid, 'tweak the title');
    await new Promise((r) => setTimeout(r, 200));

    expect(sender.sent.filter((m) => m.channel === 'widget:plan')).toHaveLength(0);
  });

  it('widget:create persists summary.json sidecar to meta.summary on success (with name)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      await fs.writeFile(path.join(cwd, 'summary.json'), JSON.stringify({ name: 'Local Weather', sources: ['Open-Meteo'] }));
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'show weather');
    await new Promise((r) => setTimeout(r, 20));

    expect((await store.getMeta(uuid)).summary).toEqual({ name: 'Local Weather', sources: ['Open-Meteo'] });
  });

  it('widget:create accepts legacy summary.json without name; whitespace-only name is dropped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      await fs.writeFile(path.join(cwd, 'summary.json'), JSON.stringify({ name: '   ', sources: ['Open-Meteo'] }));
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'show weather');
    await new Promise((r) => setTimeout(r, 20));

    expect((await store.getMeta(uuid)).summary).toEqual({ sources: ['Open-Meteo'] });
  });

  it('widget:create does not fail when summary.json is missing; meta.summary stays undefined', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      // no summary.json
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 20));

    expect(sender.sent).toContainEqual({ channel: 'widget:ready', payload: { uuid } });
    expect((await store.getMeta(uuid)).summary).toBeUndefined();
  });

  it('widget:create silently ignores a malformed summary.json', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async ({ cwd }: any) => {
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      await fs.writeFile(path.join(cwd, 'summary.json'), 'not json');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 20));

    expect(sender.sent).toContainEqual({ channel: 'widget:ready', payload: { uuid } });
    expect((await store.getMeta(uuid)).summary).toBeUndefined();
  });

  it('prefs:get returns geekMode:false by default; prefs:setGeekMode persists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    expect(await ipc.invoke('prefs:get')).toEqual({ geekMode: false });

    const ok = await ipc.invoke('prefs:setGeekMode', true);
    expect(ok).toEqual({ ok: true });
    expect(await ipc.invoke('prefs:get')).toEqual({ geekMode: true });

    const bad = await ipc.invoke('prefs:setGeekMode', 'yes');
    expect(bad.ok).toBe(false);
    expect((await ipc.invoke('prefs:get')).geekMode).toBe(true);
  });

  it('widget:setRefreshTtl accepts a finite non-negative number; clears with null; rejects negatives and NaN', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));
    const uuid = await store.create('p');

    expect(await ipc.invoke('widget:setRefreshTtl', uuid, 3_600_000)).toEqual({ ok: true });
    expect((await store.getMeta(uuid)).refreshTtlMs).toBe(3_600_000);

    expect(await ipc.invoke('widget:setRefreshTtl', uuid, null)).toEqual({ ok: true });
    expect((await store.getMeta(uuid)).refreshTtlMs).toBeUndefined();

    const neg = await ipc.invoke('widget:setRefreshTtl', uuid, -100);
    expect(neg.ok).toBe(false);
    const nan = await ipc.invoke('widget:setRefreshTtl', uuid, Number.NaN);
    expect(nan.ok).toBe(false);
    const str = await ipc.invoke('widget:setRefreshTtl', uuid, '60000');
    expect(str.ok).toBe(false);
  });

  it('widget:create with refreshTtlMs persists it and includes the cadence directive in the prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    let capturedPrompt = '';
    const runCodex = vi.fn(async ({ cwd, prompt }: any) => {
      capturedPrompt = prompt;
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'show weather', undefined, 86_400_000);
    await new Promise((r) => setTimeout(r, 20));

    expect((await store.getMeta(uuid)).refreshTtlMs).toBe(86_400_000);
    expect(capturedPrompt).toContain('Refresh cadence: Daily (use ttlMs = 86400000');
  });

  it('widget:chatSend reads persisted refreshTtlMs and includes it in the prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    let capturedPrompt = '';
    const runCodex = vi.fn(async ({ cwd, prompt }: any) => {
      capturedPrompt = prompt;
      await fs.writeFile(path.join(cwd, 'index.html'), '<html>v2</html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const uuid = await store.create('p');
    await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html>v1</html>');
    await store.setRefreshTtl(uuid, 300_000);

    await ipc.invoke('widget:chatSend', uuid, 'tweak the title');
    await new Promise((r) => setTimeout(r, 20));

    expect(capturedPrompt).toContain('Refresh cadence: 5 min (use ttlMs = 300000');
  });

  it('widget:setProviders persists known ids and rejects unknown ones', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn(async () => ({ ok: true }));

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    await ipc.invoke('secrets:save', {
      id: 'p1', name: 'P1', hostnames: ['p1.example'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    });
    const uuid = await store.create('p');

    const ok = await ipc.invoke('widget:setProviders', uuid, ['p1']);
    expect(ok).toEqual({ ok: true });
    expect((await store.getMeta(uuid)).selectedProviderIds).toEqual(['p1']);

    const bad = await ipc.invoke('widget:setProviders', uuid, ['does-not-exist']);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/does-not-exist/);

    const cleared = await ipc.invoke('widget:setProviders', uuid, null);
    expect(cleared).toEqual({ ok: true });
    expect((await store.getMeta(uuid)).selectedProviderIds).toBeUndefined();
  });

  it('widget:create with selectedProviderIds filters providers passed to Codex', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    let capturedPrompt = '';
    const runCodex = vi.fn(async ({ cwd, prompt }: any) => {
      capturedPrompt = prompt;
      await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    await ipc.invoke('secrets:save', {
      id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'KEY'
    });
    await ipc.invoke('secrets:save', {
      id: 'p2', name: 'OtherAPI', hostnames: ['api.other.test'],
      auth: { type: 'query', param: 'key' }, value: 'KEY2'
    });

    const { uuid } = await ipc.invoke('widget:create', 'p', ['p1']);
    await new Promise((r) => setTimeout(r, 20));

    expect(capturedPrompt).toContain('OpenWeather');
    expect(capturedPrompt).not.toContain('OtherAPI');
    expect((await store.getMeta(uuid)).selectedProviderIds).toEqual(['p1']);
  });

  it('app:fetch records a fetch-log entry for the calling widget; app:fetchLog:get returns them newest-first…wait, raw order', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('hi', { status: 200 })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      const uuid = await store.create('p');
      await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
      const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
      const event = { senderFrame: { url: senderUrl } } as any;

      await ipc.invokeWithEvent('app:fetch', event, 'https://example.com/a');
      await ipc.invokeWithEvent('app:fetch', event, 'https://example.com/b', { method: 'POST' });

      const log = await ipc.invoke('app:fetchLog:get', uuid);
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({ method: 'GET', url: 'https://example.com/a', status: 200, responseBytes: 2 });
      expect(log[1]).toMatchObject({ method: 'POST', url: 'https://example.com/b', status: 200 });
      expect(typeof log[0].durationMs).toBe('number');
      expect(typeof log[0].at).toBe('string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('app:fetch records the response body prefix as errorBody on non-2xx', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      const uuid = await store.create('p');
      await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
      const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
      const event = { senderFrame: { url: senderUrl } } as any;

      await ipc.invokeWithEvent('app:fetch', event, 'https://example.com/forbidden');

      const log = await ipc.invoke('app:fetchLog:get', uuid);
      expect(log).toHaveLength(1);
      expect(log[0].status).toBe(401);
      expect(log[0].errorBody).toBe('{"error":"unauthorized"}');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('app:fetchLog caps at 20 entries (oldest evicted)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      const uuid = await store.create('p');
      await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
      const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
      const event = { senderFrame: { url: senderUrl } } as any;

      for (let i = 0; i < 25; i += 1) {
        await ipc.invokeWithEvent('app:fetch', event, `https://example.com/${i}`);
      }

      const log = await ipc.invoke('app:fetchLog:get', uuid);
      expect(log).toHaveLength(20);
      // The first 5 were dropped; remaining starts at index 5 (URL/5).
      expect(log[0].url).toBe('https://example.com/5');
      expect(log[19].url).toBe('https://example.com/24');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('app:fetchLog:get returns [] for unknown uuid and non-widget senders write nothing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      expect(await ipc.invoke('app:fetchLog:get', 'never-seen')).toEqual([]);
      const nonWidgetEvent = { senderFrame: { url: 'http://localhost/' } } as any;
      await ipc.invokeWithEvent('app:fetch', nonWidgetEvent, 'https://example.com/');
      expect(await ipc.invoke('app:fetchLog:get', 'never-seen')).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('widget:delete clears the fetch log for that widget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('x', { status: 200 })) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      const uuid = await store.create('p');
      await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
      const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
      const event = { senderFrame: { url: senderUrl } } as any;
      await ipc.invokeWithEvent('app:fetch', event, 'https://example.com/');
      expect(await ipc.invoke('app:fetchLog:get', uuid)).toHaveLength(1);

      await ipc.invoke('widget:delete', uuid);
      expect(await ipc.invoke('app:fetchLog:get', uuid)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('app:fetch passes the widget\'s selectedProviderIds through to appFetch (no auth when excluded)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    let observedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      observedUrl = typeof url === 'string' ? url : url.url;
      return new Response('', { status: 200 });
    }) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      await ipc.invoke('secrets:save', {
        id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'],
        auth: { type: 'query', param: 'appid' }, value: 'KEY'
      });
      const uuid = await store.create('p');
      // ensure the widget index.html exists at the path widgetCwdFromSenderUrl expects
      await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
      await store.setProviders(uuid, []); // empty allowlist — no providers allowed

      const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
      const event = { senderFrame: { url: senderUrl } } as any;
      await ipc.invokeWithEvent('app:fetch', event, 'https://api.openweathermap.org/data?q=London');

      expect(observedUrl).toBe('https://api.openweathermap.org/data?q=London');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('app:cache:set persists; app:cache:get returns the value before TTL; null after', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const uuid = await store.create('p');
    await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
    const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
    const event = { senderFrame: { url: senderUrl } } as any;

    const setResult = await ipc.invokeWithEvent('app:cache:set', event, 'weather', { temp: 17 }, 60_000);
    expect(setResult).toEqual({ ok: true });

    const got = await ipc.invokeWithEvent('app:cache:get', event, 'weather');
    expect(got).not.toBeNull();
    expect(got.value).toEqual({ temp: 17 });

    // Overwrite with already-expired entry, then read.
    await fs.writeFile(path.join(store.dir(uuid), 'cache.json'), JSON.stringify({
      weather: { value: { temp: 17 }, expiresAt: Date.now() - 1000 }
    }));
    const expired = await ipc.invokeWithEvent('app:cache:get', event, 'weather');
    expect(expired).toBeNull();
  });

  it('app:cache:get returns null for non-widget senders; app:cache:set rejects them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const nonWidgetEvent = { senderFrame: { url: 'http://localhost/' } } as any;

    expect(await ipc.invokeWithEvent('app:cache:get', nonWidgetEvent, 'k')).toBeNull();

    const setResult = await ipc.invokeWithEvent('app:cache:set', nonWidgetEvent, 'k', 1, 60_000);
    expect(setResult.ok).toBe(false);
  });

  it('app:cache:get returns null for unknown keys from a widget sender', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const uuid = await store.create('p');
    await fs.writeFile(path.join(store.dir(uuid), 'index.html'), '<html></html>');
    const senderUrl = pathToFileURL(path.join(store.dir(uuid), 'index.html')).href;
    const event = { senderFrame: { url: senderUrl } } as any;

    expect(await ipc.invokeWithEvent('app:cache:get', event, 'missing')).toBeNull();
  });

  it('widget:cancel aborts an in-flight codex run for the widget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    let capturedSignal: AbortSignal | undefined;
    const runCodex = vi.fn(async ({ signal }: any) => {
      capturedSignal = signal;
      return new Promise<{ ok: boolean; error?: string }>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'canceled' }));
      });
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const { uuid } = await ipc.invoke('widget:create', 'p');
    await new Promise((r) => setTimeout(r, 10));

    const cancelResult = await ipc.invoke('widget:cancel', uuid);
    expect(cancelResult).toEqual({ ok: true });
    expect(capturedSignal?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(sender.sent).toContainEqual({ channel: 'widget:error', payload: { uuid, error: 'canceled' } });
  });

  it('widget:cancel returns ok:false when no run is in flight for that uuid', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const result = await ipc.invoke('widget:cancel', 'nope');
    expect(result.ok).toBe(false);
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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));
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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));
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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    await ipc.invoke('secrets:save', {
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    });
    await ipc.invoke('secrets:delete', 'p1');

    expect(await ipc.invoke('secrets:list')).toEqual([]);
  });

  it('secrets:lookupProvider runs codex with the lookup prompt and parses the JSON file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    const runCodex = vi.fn(async ({ cwd, prompt, outputFile, captureLastMessage, signal, logPath }: any) => {
      expect(outputFile).toBe('provider.json');
      expect(captureLastMessage).toBe(true);
      expect(typeof logPath).toBe('string');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(prompt).toContain('browser_use');
      expect(prompt).toContain('Stripe');
      await fs.writeFile(path.join(cwd, outputFile), JSON.stringify({
        ok: true,
        name: 'Stripe',
        hostnames: ['api.stripe.com'],
        auth: { type: 'header', name: 'Authorization', scheme: 'bearer' },
        source: 'https://stripe.com/docs/api/authentication'
      }));
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const result = await ipc.invoke('secrets:lookupProvider', 'Stripe');
    expect(result).toEqual({
      ok: true,
      provider: {
        name: 'Stripe',
        hostnames: ['api.stripe.com'],
        auth: { type: 'header', name: 'Authorization', scheme: 'bearer' },
        source: 'https://stripe.com/docs/api/authentication'
      }
    });
    expect(runCodex).toHaveBeenCalled();
  });

  it('secrets:lookupProvider surfaces a codex-reported error', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    const runCodex = vi.fn(async ({ cwd, outputFile }: any) => {
      await fs.writeFile(path.join(cwd, outputFile), JSON.stringify({ ok: false, error: 'no official docs' }));
      return { ok: true };
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const result = await ipc.invoke('secrets:lookupProvider', 'made-up API');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no official docs/);
  });

  it('secrets:cancelLookup aborts the in-flight lookup signal', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();

    let capturedSignal: AbortSignal | undefined;
    const runCodex = vi.fn(({ signal }: any) => {
      capturedSignal = signal;
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'canceled' }));
      });
    });

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const inflight = ipc.invoke('secrets:lookupProvider', 'Stripe');
    await new Promise((r) => setTimeout(r, 10));

    const cancelResult = await ipc.invoke('secrets:cancelLookup');
    expect(cancelResult).toEqual({ ok: true });
    expect(capturedSignal?.aborted).toBe(true);

    const result = await inflight;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/canceled/);
  });

  it('secrets:lookupProvider rejects an empty query without invoking codex', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    const result = await ipc.invoke('secrets:lookupProvider', '   ');
    expect(result.ok).toBe(false);
    expect(runCodex).not.toHaveBeenCalled();
  });

  it('parseProviderLookupResponse rejects payloads missing the source URL', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'X',
      hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }
    }));
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/source/);
  });

  it('parseProviderLookupResponse rejects an unknown header scheme', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'X',
      hostnames: ['x.com'],
      auth: { type: 'header', name: 'Authorization', scheme: 'weird' },
      source: 'https://example.com/docs'
    }));
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/scheme/);
  });

  it('parseProviderLookupResponse rejects hostnames that include a path', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'X',
      hostnames: ['api.example.com/v1'],
      auth: { type: 'query', param: 'k' },
      source: 'https://example.com/docs'
    }));
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/hostnames/);
  });

  it('parseProviderLookupResponse passes through a clean query-auth response', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' },
      source: 'https://openweathermap.org/appid'
    }));
    expect(result.ok).toBe(true);
    expect((result as any).provider.auth).toEqual({ type: 'query', param: 'appid' });
    expect((result as any).provider.instructions).toBeUndefined();
  });

  it('parseProviderLookupResponse surfaces instructions and trims whitespace', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'Stripe',
      hostnames: ['api.stripe.com'],
      auth: { type: 'header', name: 'Authorization', scheme: 'basic' },
      source: 'https://docs.stripe.com/api/authentication',
      instructions: '  Sign up at https://dashboard.stripe.com/register. Your test secret key is at Developers → API keys.  '
    }));
    expect(result.ok).toBe(true);
    expect((result as any).provider.instructions).toBe('Sign up at https://dashboard.stripe.com/register. Your test secret key is at Developers → API keys.');
  });

  it('parseProviderLookupResponse drops whitespace-only instructions', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'Stripe',
      hostnames: ['api.stripe.com'],
      auth: { type: 'header', name: 'Authorization', scheme: 'basic' },
      source: 'https://docs.stripe.com/api/authentication',
      instructions: '   '
    }));
    expect(result.ok).toBe(true);
    expect((result as any).provider.instructions).toBeUndefined();
  });

  it('parseProviderLookupResponse rejects non-string instructions', () => {
    const result = parseProviderLookupResponse(JSON.stringify({
      ok: true,
      name: 'Stripe',
      hostnames: ['api.stripe.com'],
      auth: { type: 'header', name: 'Authorization', scheme: 'basic' },
      source: 'https://docs.stripe.com/api/authentication',
      instructions: 42
    }));
    expect(result.ok).toBe(false);
    expect((result as any).error).toMatch(/instructions/);
  });

  it('secrets:test issues a GET to the first hostname with auth injected', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    let observedUrl = '';
    let observedAuthHeader = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      observedUrl = typeof url === 'string' ? url : url.url;
      observedAuthHeader = (init?.headers ?? {}).Authorization ?? '';
      return new Response('', { status: 200 });
    }) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      await ipc.invoke('secrets:save', {
        id: 'p1', name: 'X', hostnames: ['api.example.com'],
        auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
        value: 'TOKEN'
      });
      const result = await ipc.invoke('secrets:test', 'p1');

      expect(result).toEqual({ ok: true, status: 200 });
      expect(observedUrl).toBe('https://api.example.com/');
      expect(observedAuthHeader).toBe('Bearer TOKEN');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('secrets:test returns ok:false with an error when fetch throws', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-'));
    const store = createWidgetStore(root);
    const secrets = createSecretsStore(root);
    const ipc = fakeIpcMain();
    const sender = fakeSender();
    const runCodex = vi.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as any;

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

    try {
      await ipc.invoke('secrets:save', {
        id: 'p1', name: 'X', hostnames: ['nowhere.invalid'],
        auth: { type: 'query', param: 'k' }, value: 'V'
      });
      const result = await ipc.invoke('secrets:test', 'p1');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ENOTFOUND/);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));
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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, createOnboardingStore(root), runCodex as any, () => sender as any, createPrefsStore(root));

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

    registerIpc(ipc as any, store, secrets, onboarding, runCodex as any, () => sender as any, createPrefsStore(root));

    const result = await ipc.invoke('onboarding:dismiss');
    expect(result).toEqual({ ok: true });

    const state = await ipc.invoke('onboarding:get');
    expect(state.dismissed).toBe(true);
    expect(typeof state.completedAt).toBe('string');
  });
});
