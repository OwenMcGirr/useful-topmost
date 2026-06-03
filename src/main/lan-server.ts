import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { WidgetStore } from './widget-store';
import type { SecretsStore } from './secrets-store';
import { appFetch as defaultAppFetch } from './proxy';
import type { FetchEnvelope } from './proxy';
import { getCacheEntry, writeCacheEntry } from './widget-cache-store';

export interface LanServerConfig {
  enabled: boolean;
  port: number;
}

export interface LanServerState {
  running: boolean;
  port: number;
  urls: string[];
  error?: string;
}

export interface LanServerController {
  getState(): LanServerState;
  applyConfig(config: LanServerConfig): Promise<LanServerState>;
  stop(): Promise<void>;
}

interface Deps {
  widgets: WidgetStore;
  secrets: SecretsStore;
  appFetch?: typeof defaultAppFetch;
}

const CLIENT_JS = `
const root = document.getElementById('root');
let grid = null;
const DEFAULT_REFRESH_TTL_MS = 3600000;
const LIVE_RELOAD_INTERVAL_MS = 30000;

function sizeClass(size) {
  if (size === 'wide') return 'tile tile-wide';
  if (size === 'large') return 'tile tile-large';
  return 'tile';
}

function widgetTitle(widget) {
  return String(widget.prompt || 'Widget');
}

function widgetState(widget) {
  return widget.state === 'building' ? 'building' : 'live';
}

function refreshIntervalMs(widget) {
  if (widget.refreshTtlMs === 0) return LIVE_RELOAD_INTERVAL_MS;
  if (Number.isFinite(widget.refreshTtlMs) && widget.refreshTtlMs > 0) return widget.refreshTtlMs;
  return DEFAULT_REFRESH_TTL_MS;
}

function widgetSrc(widget, rev) {
  const base = '/widgets/' + encodeURIComponent(widget.uuid) + '/';
  return rev ? base + '?rev=' + encodeURIComponent(String(rev)) : base;
}

function widgetSubtitle(widget) {
  const prompt = String(widget.prompt || '').trim();
  return prompt || 'Preparing your widget.';
}

function ensureGrid() {
  if (!root) return null;
  if (grid && grid.isConnected) return grid;
  root.innerHTML = '';
  grid = document.createElement('main');
  grid.className = 'grid';
  root.appendChild(grid);
  return grid;
}

function showMessage(message) {
  if (!root) return;
  grid = null;
  const current = root.querySelector('.empty');
  if (current && current.textContent === message) return;
  root.innerHTML = '';
  const main = document.createElement('main');
  main.className = 'empty';
  main.textContent = message;
  root.appendChild(main);
}

function createTile(widget) {
  const section = document.createElement('section');
  section.dataset.uuid = widget.uuid;

  updateTile(section, widget);
  return section;
}

function updateTile(section, widget) {
  section.className = sizeClass(widget.size);
  const state = widgetState(widget);
  section.dataset.state = state;

  if (state === 'building') {
    delete section.dataset.lastReloadAt;
    const iframe = section.querySelector('iframe');
    if (iframe) iframe.remove();

    let placeholder = section.querySelector('.placeholder-building');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'placeholder placeholder-building';
      placeholder.setAttribute('role', 'status');
      placeholder.setAttribute('aria-live', 'polite');

      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      placeholder.appendChild(spinner);

      const copy = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'placeholder-title';
      title.textContent = 'Building widget…';
      const subtitle = document.createElement('div');
      subtitle.className = 'placeholder-subtitle';
      copy.appendChild(title);
      copy.appendChild(subtitle);
      placeholder.appendChild(copy);
      section.appendChild(placeholder);
    }

    const subtitle = placeholder.querySelector('.placeholder-subtitle');
    if (subtitle) subtitle.textContent = widgetSubtitle(widget);
    return;
  }

  const placeholder = section.querySelector('.placeholder-building');
  if (placeholder) placeholder.remove();

  let iframe = section.querySelector('iframe');
  const now = Date.now();
  const intervalMs = refreshIntervalMs(widget);
  const lastReloadAt = Number(section.dataset.lastReloadAt || '0');
  if (!iframe) {
    iframe = document.createElement('iframe');
    section.appendChild(iframe);
    section.dataset.lastReloadAt = String(now);
    iframe.src = widgetSrc(widget);
  } else if (!iframe.getAttribute('src')) {
    iframe.src = widgetSrc(widget);
    section.dataset.lastReloadAt = String(now);
  } else if (now - lastReloadAt >= intervalMs) {
    iframe.src = widgetSrc(widget, now);
    section.dataset.lastReloadAt = String(now);
  }
  iframe.title = widgetTitle(widget);
}

function findTile(nextGrid, uuid) {
  return Array.from(nextGrid.querySelectorAll('section[data-uuid]'))
    .find((node) => node.dataset.uuid === uuid);
}

function render(widgets) {
  if (!root) return;
  if (!widgets.length) {
    showMessage('No widgets yet.');
    return;
  }

  const nextGrid = ensureGrid();
  if (!nextGrid) return;

  const seen = new Set();
  let cursor = nextGrid.firstElementChild;
  for (const widget of widgets) {
    seen.add(widget.uuid);
    let section = findTile(nextGrid, widget.uuid);
    if (!section) section = createTile(widget);
    else updateTile(section, widget);

    if (section !== cursor) nextGrid.insertBefore(section, cursor);
    cursor = section.nextElementSibling;
  }

  for (const section of Array.from(nextGrid.querySelectorAll('section[data-uuid]'))) {
    if (!seen.has(section.dataset.uuid)) section.remove();
  }
}

async function load() {
  try {
    const response = await fetch('/api/widgets', { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load widgets.');
    render(await response.json());
  } catch {
    showMessage('Could not load widgets.');
  }
}

load();
setInterval(load, 10000);
`;

const INDEX_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Useful Topmost</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #0d1117; color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 400px)); grid-auto-rows: 260px; gap: 16px; padding: 20px; justify-content: center; align-content: start; }
    .tile { background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; min-width: 0; }
    .tile-wide { grid-column: span 2; }
    .tile-large { grid-column: span 2; grid-row: span 2; }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #161b22; }
    .placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px; color: #8b949e; text-align: left; }
    .placeholder-title { color: #e6edf3; font-size: 14px; font-weight: 600; }
    .placeholder-subtitle { margin-top: 4px; max-width: 280px; color: #8b949e; font-size: 12px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .spinner { width: 16px; height: 16px; border: 2px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; flex: 0 0 auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty { min-height: 100vh; display: flex; align-items: center; justify-content: center; color: #8b949e; font-size: 14px; }
    @media (max-width: 760px) {
      .grid { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 260px; padding: 12px; }
      .tile-wide, .tile-large { grid-column: span 1; grid-row: span 1; }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="/lan-client.js"></script>
</body>
</html>`;

const WIDGET_SHIM_JS = `
(function () {
  const uuid = window.__LAN_WIDGET_UUID__;

  function flattenHeaders(headers) {
    if (!headers) return undefined;
    if (headers instanceof Headers) {
      const out = {};
      headers.forEach((value, key) => { out[key] = value; });
      return out;
    }
    if (Array.isArray(headers)) {
      const out = {};
      for (const pair of headers) {
        if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
      }
      return out;
    }
    return { ...headers };
  }

  function makeHeadersLike(raw) {
    const lower = {};
    for (const key of Object.keys(raw || {})) lower[key.toLowerCase()] = raw[key];
    return {
      get(name) {
        const value = lower[String(name).toLowerCase()];
        return value === undefined ? null : value;
      },
      has(name) {
        return String(name).toLowerCase() in lower;
      },
      forEach(cb) {
        for (const key of Object.keys(lower)) cb(lower[key], key);
      }
    };
  }

  function makeResponseLike(env, url) {
    return {
      ok: env.status >= 200 && env.status < 300,
      status: env.status,
      statusText: '',
      url,
      redirected: false,
      type: 'basic',
      headers: makeHeadersLike(env.headers),
      async json() { return JSON.parse(env.body); },
      async text() { return env.body; },
      clone() { return makeResponseLike(env, url); }
    };
  }

  window.appFetch = async function appFetch(url, init) {
    const safeInit = init ? {
      method: init.method,
      headers: flattenHeaders(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined
    } : undefined;
    const response = await fetch('/api/widgets/' + encodeURIComponent(uuid) + '/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, init: safeInit })
    });
    if (!response.ok) throw new TypeError('NetworkError when attempting to fetch resource.');
    const env = await response.json();
    if (env.status === 0) throw new TypeError('NetworkError when attempting to fetch resource.');
    return makeResponseLike(env, url);
  };

  window.cache = {
    async get(key, ttlOrFetcher, maybeFetcher) {
      const requestedTtlMs = typeof ttlOrFetcher === 'number' ? ttlOrFetcher : undefined;
      const fetcher = typeof ttlOrFetcher === 'function' ? ttlOrFetcher : maybeFetcher;
      if (typeof fetcher !== 'function') {
        throw new TypeError('window.cache.get requires a fetcher');
      }

      if (typeof key === 'string' && key.length > 0) {
        const query = requestedTtlMs === undefined ? '' : '?ttlMs=' + encodeURIComponent(String(requestedTtlMs));
        const cached = await fetch('/api/widgets/' + encodeURIComponent(uuid) + '/cache/' + encodeURIComponent(key) + query, { cache: 'no-store' });
        if (cached.ok) {
          const payload = await cached.json();
          if (payload.hit) return payload.value;
        }
      }
      const fresh = await fetcher();
      if (typeof key === 'string' && key.length > 0) {
        await fetch('/api/widgets/' + encodeURIComponent(uuid) + '/cache/' + encodeURIComponent(key), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: fresh, ttlMs: requestedTtlMs })
        }).catch(() => undefined);
      }
      return fresh;
    }
  };

  window.local = undefined;
}());
`;

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'Not found.' });
}

function badRequest(res: ServerResponse, error: string): void {
  json(res, 400, { error });
}

const DEFAULT_REFRESH_TTL_MS = 3_600_000;

function validRequestedTtl(ttlMs: unknown): number | undefined {
  return typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : undefined;
}

function effectiveRefreshTtlMs(metaRefreshTtlMs: number | undefined, requestedTtlMs: unknown): number {
  return metaRefreshTtlMs ?? validRequestedTtl(requestedTtlMs) ?? DEFAULT_REFRESH_TTL_MS;
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validMethod(value: unknown): value is string {
  return value === undefined || (typeof value === 'string' && /^[A-Za-z]+$/.test(value));
}

function injectWidgetShim(html: string, uuid: string): string {
  const script = `<script>window.__LAN_WIDGET_UUID__ = ${JSON.stringify(uuid)};</script><script src="/lan-widget-shim.js"></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${script}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return `${script}${html}`;
}

function localUrls(port: number): string[] {
  const urls: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return urls.length > 0 ? urls : [`http://localhost:${port}/`];
}

function serverPort(server: Server, fallback: number): number {
  const address = server.address() as AddressInfo | null;
  return address?.port ?? fallback;
}

async function widgetExists(widgets: WidgetStore, uuid: string): Promise<boolean> {
  if (!uuid || uuid.includes('/') || uuid.includes('\\')) return false;
  const list = await widgets.list();
  return list.some((widget) => widget.uuid === uuid);
}

export function createLanServerController({ widgets, secrets, appFetch = defaultAppFetch }: Deps): LanServerController {
  let server: Server | null = null;
  let state: LanServerState = { running: false, port: 32177, urls: [] };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const parsedUrl = new URL(req.url ?? '/', 'http://lan.local');
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/') {
      text(res, 200, INDEX_HTML, 'text/html; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && pathname === '/lan-client.js') {
      text(res, 200, CLIENT_JS, 'text/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && pathname === '/lan-widget-shim.js') {
      text(res, 200, WIDGET_SHIM_JS, 'text/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && pathname === '/api/widgets') {
      const list = await widgets.list();
      const rows = await Promise.all([...list]
        .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true))
        .map(async (widget) => ({
          uuid: widget.uuid,
          prompt: widget.prompt,
          created_at: widget.created_at,
          pinned: widget.pinned === true,
          size: widget.size,
          summary: widget.summary,
          refreshTtlMs: widget.refreshTtlMs,
          state: await widgets.readWidgetHtml(widget.uuid) === null ? 'building' : 'live'
        })));
      json(res, 200, rows);
      return;
    }

    const widgetMatch = pathname.match(/^\/widgets\/([^/]+)\/?$/);
    if (req.method === 'GET' && widgetMatch) {
      const uuid = decodeURIComponent(widgetMatch[1]);
      if (!await widgetExists(widgets, uuid)) {
        notFound(res);
        return;
      }
      const html = await widgets.readWidgetHtml(uuid);
      if (html === null) {
        notFound(res);
        return;
      }
      text(res, 200, injectWidgetShim(html, uuid), 'text/html; charset=utf-8');
      return;
    }

    const fetchMatch = pathname.match(/^\/api\/widgets\/([^/]+)\/fetch$/);
    if (req.method === 'POST' && fetchMatch) {
      const uuid = decodeURIComponent(fetchMatch[1]);
      if (!await widgetExists(widgets, uuid)) {
        notFound(res);
        return;
      }
      let payload: any;
      try {
        payload = await readJson(req);
      } catch (e: any) {
        badRequest(res, e?.message ?? 'Request body must be valid JSON.');
        return;
      }
      if (!isHttpUrl(payload?.url)) {
        badRequest(res, 'URL must be http or https.');
        return;
      }
      const init = payload.init ?? {};
      if (init !== undefined && (typeof init !== 'object' || init === null || Array.isArray(init))) {
        badRequest(res, 'init must be an object.');
        return;
      }
      if (!validMethod(init.method)) {
        badRequest(res, 'method must contain letters only.');
        return;
      }
      if (init.body !== undefined && typeof init.body !== 'string') {
        badRequest(res, 'body must be a string.');
        return;
      }
      const meta = await widgets.getMeta(uuid);
      const envelope: FetchEnvelope = await appFetch(secrets, payload.url, {
        method: init.method,
        headers: init.headers,
        body: init.body
      }, meta.selectedProviderIds);
      json(res, 200, envelope);
      return;
    }

    const cacheMatch = pathname.match(/^\/api\/widgets\/([^/]+)\/cache\/([^/]+)$/);
    if (cacheMatch) {
      const uuid = decodeURIComponent(cacheMatch[1]);
      const key = decodeURIComponent(cacheMatch[2]);
      if (!await widgetExists(widgets, uuid)) {
        notFound(res);
        return;
      }
      if (req.method === 'GET') {
        const meta = await widgets.getMeta(uuid);
        const requestedTtlMs = parsedUrl.searchParams.has('ttlMs') ? Number(parsedUrl.searchParams.get('ttlMs')) : undefined;
        const ttlMs = effectiveRefreshTtlMs(meta.refreshTtlMs, requestedTtlMs);
        const entry = await getCacheEntry(widgets.dir(uuid), key, ttlMs);
        json(res, 200, entry ? { hit: true, value: entry.value } : { hit: false });
        return;
      }
      if (req.method === 'PUT') {
        let payload: any;
        try {
          payload = await readJson(req);
        } catch (e: any) {
          badRequest(res, e?.message ?? 'Request body must be valid JSON.');
          return;
        }
        const meta = await widgets.getMeta(uuid);
        const ttlMs = effectiveRefreshTtlMs(meta.refreshTtlMs, payload?.ttlMs);
        if (ttlMs <= 0) {
          json(res, 200, { ok: true });
          return;
        }
        await writeCacheEntry(widgets.dir(uuid), key, payload.value, ttlMs);
        json(res, 200, { ok: true });
        return;
      }
    }

    notFound(res);
  };

  const stop = () => new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    const current = server;
    server = null;
    current.close(() => resolve());
  });

  return {
    getState: () => state,

    async applyConfig(config) {
      await stop();
      state = { running: false, port: config.port, urls: [] };
      if (!config.enabled) return state;

      server = createServer((req, res) => {
        void route(req, res).catch(() => {
          if (!res.headersSent) json(res, 500, { error: 'Internal server error.' });
          else res.end();
        });
      });

      await new Promise<void>((resolve) => {
        server!.once('error', (e: NodeJS.ErrnoException) => {
          const error = e.code === 'EADDRINUSE' ? 'Port is already in use.' : (e.message || 'Could not start local network server.');
          state = { running: false, port: config.port, urls: [], error };
          server = null;
          resolve();
        });
        server!.listen(config.port, '0.0.0.0', () => {
          const port = serverPort(server!, config.port);
          state = { running: true, port, urls: localUrls(port) };
          resolve();
        });
      });

      return state;
    },

    async stop() {
      await stop();
      state = { running: false, port: state.port, urls: [] };
    }
  };
}

export const lanServerInternals = {
  injectWidgetShim
};
