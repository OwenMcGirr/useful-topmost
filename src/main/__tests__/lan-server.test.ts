import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWidgetStore } from '../widget-store';
import { createSecretsStore } from '../secrets-store';
import { createLanServerController } from '../lan-server';

async function freshRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'lan-server-'));
}

async function createWidget(root: string, html = '<html><head><title>x</title></head><body>hello</body></html>') {
  const widgets = createWidgetStore(root);
  const uuid = await widgets.create('weather');
  await widgets.replaceWidgetHtml(uuid, html);
  return { widgets, uuid };
}

async function readText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

describe('lan-server', () => {
  it('does not listen when disabled', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });

    await expect(controller.applyConfig({ enabled: false, port: 32177 }))
      .resolves.toEqual({ running: false, port: 32177, urls: [] });
  });

  it('starts and returns a local URL when enabled', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });

    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      expect(state.running).toBe(true);
      expect(state.port).toBeGreaterThan(0);
      expect(state.urls.length).toBeGreaterThan(0);
    } finally {
      await controller.stop();
    }
  });

  it('serves read-only widget metadata without provider IDs or secrets', async () => {
    const root = await freshRoot();
    const { widgets, uuid } = await createWidget(root);
    await widgets.setPinned(uuid, true);
    await widgets.setSize(uuid, 'wide');
    await widgets.setProviders(uuid, ['secret-provider']);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/api/widgets`);
      const body = await response.json() as any[];
      expect(body).toEqual([expect.objectContaining({
        uuid,
        prompt: 'weather',
        pinned: true,
        size: 'wide'
      })]);
      expect(body[0].selectedProviderIds).toBeUndefined();
      expect(body[0].htmlPath).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('secret-provider');
    } finally {
      await controller.stop();
    }
  });

  it('serves widget HTML with the LAN shim injected', async () => {
    const root = await freshRoot();
    const { widgets, uuid } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const result = await readText(`http://127.0.0.1:${state.port}/widgets/${uuid}/`);
      expect(result.status).toBe(200);
      expect(result.body).toContain(`window.__LAN_WIDGET_UUID__ = "${uuid}"`);
      expect(result.body).toContain('<script src="/lan-widget-shim.js"></script>');
    } finally {
      await controller.stop();
    }
  });

  it('returns 404 for unknown widgets and traversal attempts', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      expect((await readText(`http://127.0.0.1:${state.port}/widgets/nope/`)).status).toBe(404);
      expect((await readText(`http://127.0.0.1:${state.port}/widgets/..%5c/`)).status).toBe(404);
    } finally {
      await controller.stop();
    }
  });

  it('proxies appFetch with the widget selected provider IDs', async () => {
    const root = await freshRoot();
    const { widgets, uuid } = await createWidget(root);
    await widgets.setProviders(uuid, ['p1']);
    const appFetch = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }));
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root), appFetch: appFetch as any });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/api/widgets/${uuid}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/data', init: { method: 'POST', body: 'x' } })
      });
      expect(await response.json()).toEqual({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' });
      expect(appFetch).toHaveBeenCalledWith(expect.anything(), 'https://example.com/data', {
        method: 'POST',
        headers: undefined,
        body: 'x'
      }, ['p1']);
    } finally {
      await controller.stop();
    }
  });

  it('rejects invalid fetch URLs', async () => {
    const root = await freshRoot();
    const { widgets, uuid } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/api/widgets/${uuid}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/passwd' })
      });
      expect(response.status).toBe(400);
    } finally {
      await controller.stop();
    }
  });

  it('supports widget cache get and put routes', async () => {
    const root = await freshRoot();
    const { widgets, uuid } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const cacheUrl = `http://127.0.0.1:${state.port}/api/widgets/${uuid}/cache/weather`;
      expect(await (await fetch(cacheUrl)).json()).toEqual({ hit: false });

      const put = await fetch(cacheUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { temp: 17 }, ttlMs: 60_000 })
      });
      expect(await put.json()).toEqual({ ok: true });
      expect(await (await fetch(cacheUrl)).json()).toEqual({ hit: true, value: { temp: 17 } });
    } finally {
      await controller.stop();
    }
  });

  it('does not expose local exec in the widget shim', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const shim = await readText(`http://127.0.0.1:${state.port}/lan-widget-shim.js`);
      expect(shim.body).toContain('window.local = undefined');
      expect(shim.body).not.toContain('exec:');
    } finally {
      await controller.stop();
    }
  });

  it('serves a LAN client that preserves existing widget iframes while polling', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const controller = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const state = await controller.applyConfig({ enabled: true, port: 0 });
    try {
      const client = await readText(`http://127.0.0.1:${state.port}/lan-client.js`);
      expect(client.body).toContain('function updateTile');
      expect(client.body).toContain('if (section !== cursor) nextGrid.insertBefore(section, cursor)');
      expect(client.body).toContain('cursor = section.nextElementSibling');
      expect(client.body).not.toContain("root.innerHTML = '<main class=\"grid\">'");
      expect(client.body).not.toContain('nextGrid.appendChild(section)');
      expect(client.body).not.toContain('<iframe title="');
    } finally {
      await controller.stop();
    }
  });

  it('reports EADDRINUSE when the configured port is already taken', async () => {
    const root = await freshRoot();
    const { widgets } = await createWidget(root);
    const first = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    const firstState = await first.applyConfig({ enabled: true, port: 0 });
    const second = createLanServerController({ widgets, secrets: createSecretsStore(root) });
    try {
      await expect(second.applyConfig({ enabled: true, port: firstState.port }))
        .resolves.toEqual({ running: false, port: firstState.port, urls: [], error: 'Port is already in use.' });
    } finally {
      await second.stop();
      await first.stop();
    }
  });
});
