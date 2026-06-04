import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IpcMain, WebContents } from 'electron';
import { effectiveRefreshMode, type WidgetRefreshMode, type WidgetStore, type WidgetSummary } from './widget-store';
import type { SecretsStore, Provider } from './secrets-store';
import type { OnboardingStore } from './onboarding-store';
import { normalizeWebhookPublicBaseUrl, type PrefsStore, type UpdateChannel } from './prefs-store';
import type { LanServerController } from './lan-server';
import type { StartupController, StartupState } from './startup';
import type { runCodex as RunCodexFn } from './codex-runner';
import { DEFAULT_REFRESH_TTL_MS, PROVIDER_LOOKUP_OUTPUT_FILE, WIDGET_PLAN_OUTPUT_FILE, WIDGET_SUMMARY_OUTPUT_FILE, buildChatPrompt, buildPrompt, buildProviderLookupPrompt } from './codex-prompt';
import { appFetch, filterProviders, injectAuth } from './proxy';
import { runLocalExec, widgetCwdFromSenderUrl } from './local-exec';
import { getCacheEntry, getCacheEntryUnexpired, writeCacheEntry } from './widget-cache-store';

export type GetSender = () => Pick<WebContents, 'send'>;

interface SaveResultOk { ok: true }
interface SaveResultErr { ok: false; error: string }
type SaveResult = SaveResultOk | SaveResultErr;

interface ChatResultOk { ok: true }
interface ChatResultErr { ok: false; error: string }
type ChatResult = ChatResultOk | ChatResultErr;

function validateProvider(p: any): SaveResultErr | null {
  if (!p || typeof p !== 'object') return { ok: false, error: 'provider must be an object' };
  if (typeof p.id !== 'string' || !p.id) return { ok: false, error: 'id is required' };
  if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'name is required' };
  if (!Array.isArray(p.hostnames) || p.hostnames.length === 0 ||
      !p.hostnames.every((h: any) => typeof h === 'string' && h.trim())) {
    return { ok: false, error: 'hostnames must be a non-empty array of strings' };
  }
  if (!p.auth || typeof p.auth !== 'object') return { ok: false, error: 'auth is required' };
  if (p.auth.type === 'query') {
    if (typeof p.auth.param !== 'string' || !p.auth.param) {
      return { ok: false, error: 'auth.param is required for query strategy' };
    }
  } else if (p.auth.type === 'header') {
    if (typeof p.auth.name !== 'string' || !p.auth.name) {
      return { ok: false, error: 'auth.name is required for header strategy' };
    }
    if (p.auth.prefix !== undefined && typeof p.auth.prefix !== 'string') {
      return { ok: false, error: 'auth.prefix must be a string when present' };
    }
  } else {
    return { ok: false, error: 'auth.type must be "query" or "header"' };
  }
  if (typeof p.value !== 'string') return { ok: false, error: 'value must be a string' };
  return null;
}

function validRequestedTtl(ttlMs: unknown): number | undefined {
  return typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : undefined;
}

function validRefreshMode(value: unknown): value is WidgetRefreshMode {
  return value === 'timed' || value === 'live' || value === 'event';
}

function uniqueUrls(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface WidgetWebhookInfo {
  enabled: boolean;
  path: string;
  urlCandidates: string[];
  localUrlCandidates: string[];
  publicUrl?: string;
  publicBaseUrl?: string;
  cacheKey: 'webhook';
  lastReceivedAt?: string;
}

export interface ProviderLookupResultOk {
  ok: true;
  provider: {
    name: string;
    hostnames: string[];
    auth:
      | { type: 'query'; param: string }
      | { type: 'header'; name: string; scheme: 'none' | 'bearer' | 'basic' | 'token' };
    source: string;
    /** Optional 1-3 sentence guide from Codex on where to sign up and where to find the key. */
    instructions?: string;
  };
}
export interface ProviderLookupResultErr { ok: false; error: string }
export type ProviderLookupResult = ProviderLookupResultOk | ProviderLookupResultErr;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseProviderLookupResponse(raw: string): ProviderLookupResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'codex response was not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'codex response was not a JSON object' };
  }
  if (parsed.ok === false) {
    const errorText = typeof parsed.error === 'string' && parsed.error ? parsed.error : 'codex reported failure with no reason';
    return { ok: false, error: errorText };
  }
  if (parsed.ok !== true) {
    return { ok: false, error: 'codex response missing ok flag' };
  }
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return { ok: false, error: 'codex response missing name' };
  }
  if (!Array.isArray(parsed.hostnames) || parsed.hostnames.length === 0 ||
      !parsed.hostnames.every((h: any) => typeof h === 'string' && h.trim() && !/[/\s]/.test(h))) {
    return { ok: false, error: 'codex response missing valid hostnames' };
  }
  if (!parsed.auth || typeof parsed.auth !== 'object') {
    return { ok: false, error: 'codex response missing auth' };
  }
  if (parsed.auth.type === 'query') {
    if (typeof parsed.auth.param !== 'string' || !parsed.auth.param.trim()) {
      return { ok: false, error: 'codex response query auth missing param' };
    }
  } else if (parsed.auth.type === 'header') {
    if (typeof parsed.auth.name !== 'string' || !parsed.auth.name.trim()) {
      return { ok: false, error: 'codex response header auth missing name' };
    }
    if (!['none', 'bearer', 'basic', 'token'].includes(parsed.auth.scheme)) {
      return { ok: false, error: 'codex response header auth scheme must be none|bearer|basic|token' };
    }
  } else {
    return { ok: false, error: 'codex response auth.type must be "query" or "header"' };
  }
  if (!isHttpUrl(parsed.source)) {
    return { ok: false, error: 'codex response missing valid source URL' };
  }
  let instructions: string | undefined;
  if (parsed.instructions !== undefined && parsed.instructions !== null) {
    if (typeof parsed.instructions !== 'string') {
      return { ok: false, error: 'codex response instructions must be a string when present' };
    }
    const trimmed = parsed.instructions.trim();
    if (trimmed) instructions = trimmed;
  }

  return {
    ok: true,
    provider: {
      name: parsed.name.trim(),
      hostnames: parsed.hostnames.map((h: string) => h.trim()),
      auth: parsed.auth.type === 'query'
        ? { type: 'query', param: parsed.auth.param.trim() }
        : { type: 'header', name: parsed.auth.name.trim(), scheme: parsed.auth.scheme },
      source: parsed.source,
      ...(instructions !== undefined ? { instructions } : {})
    }
  };
}

function chatMessage(role: 'user' | 'status', text: string, status?: 'building' | 'updated' | 'failed') {
  return {
    id: randomUUID(),
    role,
    text,
    created_at: new Date().toISOString(),
    ...(status ? { status } : {})
  };
}

function normalizeConclusion(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

async function readWidgetSummary(dir: string): Promise<WidgetSummary | undefined> {
  try {
    const raw = await fs.readFile(path.join(dir, WIDGET_SUMMARY_OUTPUT_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const sources = (parsed as any).sources;
    if (!Array.isArray(sources) || !sources.every((s: any) => typeof s === 'string')) return undefined;
    const rawName = (parsed as any).name;
    const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : undefined;
    const rawConclusion = (parsed as any).conclusion;
    const conclusion = typeof rawConclusion === 'string' && rawConclusion.trim().length > 0
      ? normalizeConclusion(rawConclusion)
      : undefined;
    return {
      sources,
      ...(name === undefined ? {} : { name }),
      ...(conclusion === undefined ? {} : { conclusion })
    };
  } catch {
    return undefined;
  }
}

function formatSourceList(sources: string[]): string {
  const cleaned = sources.map((source) => source.trim()).filter(Boolean).slice(0, 3);
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned[0]}, ${cleaned[1]}, and ${cleaned[2]}`;
}

export function completionSummaryText(summary: WidgetSummary | undefined): string {
  if (summary && 'conclusion' in summary && typeof summary.conclusion === 'string' && summary.conclusion.trim()) {
    return normalizeConclusion(summary.conclusion);
  }

  const first = summary?.name ? `${summary.name} is ready.` : 'Widget updated.';
  if (!summary) return `${first} No data sources were recorded.`;

  const sources = summary.sources.map((source) => source.trim()).filter(Boolean);
  if (sources.length === 0) {
    return `${first} Self-contained; no external data sources.`;
  }

  return `${first} Data from ${formatSourceList(sources)}.`;
}

export interface WidgetPlanProvider { name: string; hostname: string }

export async function readWidgetPlan(dir: string): Promise<WidgetPlanProvider[] | undefined> {
  try {
    const raw = await fs.readFile(path.join(dir, WIDGET_PLAN_OUTPUT_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const list = (parsed as any).providers_needed;
    if (!Array.isArray(list)) return undefined;
    const out: WidgetPlanProvider[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const hostname = typeof entry.hostname === 'string' ? entry.hostname.trim() : '';
      if (!name || !hostname) continue;
      out.push({ name, hostname });
    }
    return out;
  } catch {
    return undefined;
  }
}

function pollForPlan(opts: {
  dir: string;
  uuid: string;
  signal: AbortSignal;
  send: (providers: WidgetPlanProvider[]) => void;
}): void {
  let stopped = false;
  const stop = () => { stopped = true; };
  opts.signal.addEventListener('abort', stop);
  const tick = async () => {
    if (stopped) return;
    const providers = await readWidgetPlan(opts.dir);
    if (stopped) return;
    if (providers) {
      stopped = true;
      opts.send(providers);
      return;
    }
    setTimeout(() => { void tick(); }, 500);
  };
  void tick();
}

export function registerIpc(
  ipcMain: IpcMain,
  widgets: WidgetStore,
  secrets: SecretsStore,
  onboarding: OnboardingStore,
  runCodex: typeof RunCodexFn,
  getSender: GetSender,
  prefs: PrefsStore,
  lan?: LanServerController,
  startup?: StartupController,
  onUpdateChannelChanged?: (channel: UpdateChannel) => void
): void {
  const inflight = new Map<string, AbortController>();

  // Per-widget in-memory ring buffer of recent appFetch calls. Surfaced by the
  // geek-mode (i) popover to tell the user what actually went over the wire,
  // not what Codex thought it tried.
  interface FetchLogEntry {
    at: string;
    method: string;
    url: string;
    status: number;
    durationMs: number;
    responseBytes: number;
    errorBody?: string;
  }
  const FETCH_LOG_CAP = 20;
  const fetchLog = new Map<string, FetchLogEntry[]>();
  const recordFetchEntry = (uuid: string, entry: FetchLogEntry): void => {
    const list = fetchLog.get(uuid) ?? [];
    list.push(entry);
    if (list.length > FETCH_LOG_CAP) list.splice(0, list.length - FETCH_LOG_CAP);
    fetchLog.set(uuid, list);
  };

  const getWidgetWebhookInfo = async (uuid: string): Promise<WidgetWebhookInfo | { ok: false; error: string }> => {
    if (typeof uuid !== 'string' || !uuid) return { ok: false as const, error: 'uuid is required' };
    let meta;
    try {
      meta = await widgets.getMeta(uuid);
    } catch {
      return { ok: false as const, error: 'widget not found' };
    }
    if (effectiveRefreshMode(meta) !== 'event') {
      return { ok: false as const, error: 'widget is not event-driven' };
    }
    const webhook = meta.webhook ?? await widgets.ensureWebhook(uuid);
    const encodedUuid = encodeURIComponent(uuid);
    const encodedToken = encodeURIComponent(webhook.token);
    const webhookPath = `/api/widgets/${encodedUuid}/webhook/${encodedToken}`;
    const lanState = lan?.getState();
    const bases = lanState?.running
      ? [...lanState.urls, `http://localhost:${lanState.port}/`]
      : [`http://localhost:${lanState?.port ?? 32177}/`];
    const localUrlCandidates = uniqueUrls(bases.map((base) => `${base.replace(/\/+$/, '')}${webhookPath}`));
    const currentPrefs = await prefs.get();
    const publicBaseUrl = currentPrefs.webhookPublicBaseUrl;
    const publicUrl = publicBaseUrl ? `${publicBaseUrl}${webhookPath}` : undefined;
    return {
      enabled: true,
      path: webhookPath,
      urlCandidates: uniqueUrls([...(publicUrl ? [publicUrl] : []), ...localUrlCandidates]),
      localUrlCandidates,
      ...(publicBaseUrl && publicUrl ? { publicBaseUrl, publicUrl } : {}),
      cacheKey: 'webhook',
      lastReceivedAt: webhook.lastReceivedAt
    };
  };

  const testWidgetWebhook = async (uuid: string): Promise<{ ok: true; receivedAt: string } | { ok: false; error: string }> => {
    const info = await getWidgetWebhookInfo(uuid);
    if ('ok' in info && info.ok === false) return info;
    const lanState = lan?.getState();
    if (!lanState?.running) return { ok: false as const, error: 'Local network server is off' };
    const url = `http://localhost:${lanState.port}${info.path}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, source: 'Useful Topmost' })
      });
      const body = await response.json().catch(() => null) as { receivedAt?: unknown; error?: unknown } | null;
      if (!response.ok) {
        const error = typeof body?.error === 'string' && body.error ? body.error : 'Could not reach the local webhook endpoint';
        return { ok: false as const, error };
      }
      if (typeof body?.receivedAt !== 'string') {
        return { ok: false as const, error: 'Could not confirm the local webhook test' };
      }
      return { ok: true as const, receivedAt: body.receivedAt };
    } catch {
      return { ok: false as const, error: 'Could not reach the local webhook endpoint' };
    }
  };

  const trackRun = (uuid: string): AbortController => {
    const controller = new AbortController();
    inflight.set(uuid, controller);
    return controller;
  };

  const releaseRun = (uuid: string, controller: AbortController): void => {
    if (inflight.get(uuid) === controller) inflight.delete(uuid);
  };

  ipcMain.handle('widget:create', async (_event, prompt: string, selectedProviderIds?: string[], refreshTtlMs?: number) => {
    const uuid = await widgets.create(prompt);
    if (Array.isArray(selectedProviderIds)) {
      await widgets.setProviders(uuid, selectedProviderIds);
    }
    if (typeof refreshTtlMs === 'number' && Number.isFinite(refreshTtlMs) && refreshTtlMs >= 0) {
      await widgets.setRefreshTtl(uuid, refreshTtlMs);
    }
    const controller = trackRun(uuid);
    void (async () => {
      const sender = getSender();
      pollForPlan({
        dir: widgets.dir(uuid),
        uuid,
        signal: controller.signal,
        send: (providers) => sender.send('widget:plan', { uuid, providers })
      });
      const providers = filterProviders(await secrets.list(), selectedProviderIds);
      const result = await runCodex({
        prompt: buildPrompt(prompt, providers),
        cwd: widgets.dir(uuid),
        logPath: widgets.logPath(uuid),
        signal: controller.signal
      });
      releaseRun(uuid, controller);
      if (result.ok) {
        const summary = await readWidgetSummary(widgets.dir(uuid));
        if (summary) await widgets.setSummary(uuid, summary);
        sender.send('widget:ready', { uuid });
      } else {
        sender.send('widget:error', { uuid, error: result.error ?? 'unknown' });
      }
    })();
    return { uuid };
  });

  ipcMain.handle('widget:chatStart', async (_event, message: string, selectedProviderIds?: string[], refreshTtlMs?: number) => {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) throw new Error('message is required');

    const uuid = await widgets.create(trimmed);
    if (Array.isArray(selectedProviderIds)) {
      await widgets.setProviders(uuid, selectedProviderIds);
    }
    if (typeof refreshTtlMs === 'number' && Number.isFinite(refreshTtlMs) && refreshTtlMs >= 0) {
      await widgets.setRefreshTtl(uuid, refreshTtlMs);
    }
    await widgets.appendChatMessage(uuid, chatMessage('user', trimmed));
    const status = chatMessage('status', 'Building...', 'building');
    await widgets.appendChatMessage(uuid, status);

    const controller = trackRun(uuid);
    void (async () => {
      const sender = getSender();
      pollForPlan({
        dir: widgets.dir(uuid),
        uuid,
        signal: controller.signal,
        send: (providers) => sender.send('widget:plan', { uuid, providers })
      });
      const meta = await widgets.getMeta(uuid);
      const providers = filterProviders(await secrets.list(), meta.selectedProviderIds);
      const result = await runCodex({
        prompt: buildChatPrompt({ messages: meta.chat ?? [], providers }),
        cwd: widgets.dir(uuid),
        logPath: widgets.logPath(uuid),
        signal: controller.signal
      });
      releaseRun(uuid, controller);
      if (result.ok) {
        const summary = await readWidgetSummary(widgets.dir(uuid));
        if (summary) await widgets.setSummary(uuid, summary);
        await widgets.replaceChatMessage(uuid, status.id, {
          ...status,
          text: completionSummaryText(summary),
          status: 'updated',
          created_at: new Date().toISOString()
        });
        sender.send('widget:ready', { uuid });
      } else {
        const error = result.error ?? 'unknown';
        await widgets.replaceChatMessage(uuid, status.id, {
          ...status,
          text: `Failed: ${error}`,
          status: 'failed',
          created_at: new Date().toISOString()
        });
        sender.send('widget:error', { uuid, error });
      }
    })();

    return { uuid };
  });

  ipcMain.handle('widget:chatSend', async (_event, uuid: string, message: string): Promise<ChatResult> => {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) return { ok: false, error: 'message is required' };

    try {
      await widgets.getMeta(uuid);
    } catch {
      return { ok: false, error: 'widget not found' };
    }

    await widgets.appendChatMessage(uuid, chatMessage('user', trimmed));
    const status = chatMessage('status', 'Building...', 'building');
    await widgets.appendChatMessage(uuid, status);

    const controller = trackRun(uuid);
    void (async () => {
      const sender = getSender();
      const stagingDir = path.join(widgets.widgetsRoot(), '.staging', `${uuid}-${randomUUID()}`);
      try {
        await fs.mkdir(stagingDir, { recursive: true });
        const meta = await widgets.getMeta(uuid);
        const providers = filterProviders(await secrets.list(), meta.selectedProviderIds);
        const currentHtml = await widgets.readWidgetHtml(uuid);
        const result = await runCodex({
          prompt: buildChatPrompt({ messages: meta.chat ?? [], currentHtml, providers }),
          cwd: stagingDir,
          logPath: path.join(stagingDir, 'codex.log'),
          signal: controller.signal
        });

        if (result.ok) {
          const stagedHtml = await fs.readFile(path.join(stagingDir, 'index.html'), 'utf8');
          await widgets.replaceWidgetHtml(uuid, stagedHtml);
          await widgets.updatePrompt(uuid, trimmed);
          const summary = await readWidgetSummary(stagingDir);
          if (summary) await widgets.setSummary(uuid, summary);
          await widgets.replaceChatMessage(uuid, status.id, {
            ...status,
            text: completionSummaryText(summary),
            status: 'updated',
            created_at: new Date().toISOString()
          });
          sender.send('widget:ready', { uuid });
        } else {
          const error = result.error ?? 'unknown';
          await widgets.replaceChatMessage(uuid, status.id, {
            ...status,
            text: `Failed: ${error}`,
            status: 'failed',
            created_at: new Date().toISOString()
          });
          sender.send('widget:error', { uuid, error });
        }
      } catch (e: any) {
        const error = e?.message ?? 'unknown';
        await widgets.replaceChatMessage(uuid, status.id, {
          ...status,
          text: `Failed: ${error}`,
          status: 'failed',
          created_at: new Date().toISOString()
        });
        sender.send('widget:error', { uuid, error });
      } finally {
        releaseRun(uuid, controller);
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    })();

    return { ok: true };
  });

  ipcMain.handle('widget:cancel', async (_event, uuid: string) => {
    const controller = inflight.get(uuid);
    if (!controller) return { ok: false as const, error: 'no in-flight run for that widget' };
    controller.abort();
    return { ok: true as const };
  });

  ipcMain.handle('widget:chatList', async (_event, uuid: string) => {
    const meta = await widgets.getMeta(uuid);
    return meta.chat ?? [];
  });

  ipcMain.handle('widget:delete', async (_event, uuid: string) => {
    await widgets.delete(uuid);
    fetchLog.delete(uuid);
    return { ok: true };
  });

  ipcMain.handle('widget:setPinned', async (_event, uuid: string, pinned: boolean) => {
    await widgets.setPinned(uuid, Boolean(pinned));
    return { ok: true };
  });

  ipcMain.handle('widget:setSize', async (_event, uuid: string, size: string) => {
    if (size !== 'small' && size !== 'wide' && size !== 'large') {
      return { ok: false as const, error: 'size must be one of: small, wide, large' };
    }
    await widgets.setSize(uuid, size);
    return { ok: true as const };
  });

  ipcMain.handle('widget:setRefreshTtl', async (_event, uuid: string, ttlMs: unknown) => {
    if (ttlMs === null || ttlMs === undefined) {
      await widgets.setRefreshTtl(uuid, undefined);
      return { ok: true as const };
    }
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs < 0) {
      return { ok: false as const, error: 'ttlMs must be a non-negative finite number or null' };
    }
    await widgets.setRefreshTtl(uuid, ttlMs);
    return { ok: true as const };
  });

  ipcMain.handle('widget:setRefreshMode', async (_event, uuid: string, mode: unknown, ttlMs: unknown) => {
    if (!validRefreshMode(mode)) {
      return { ok: false as const, error: 'mode must be timed, live, or event' };
    }
    if (mode === 'timed') {
      const requestedTtlMs = validRequestedTtl(ttlMs);
      if (requestedTtlMs !== undefined && requestedTtlMs <= 0) {
        return { ok: false as const, error: 'ttlMs must be positive for timed refresh' };
      }
      let nextTtlMs = requestedTtlMs;
      if (nextTtlMs === undefined) {
        try {
          const meta = await widgets.getMeta(uuid);
          nextTtlMs = meta.refreshTtlMs && meta.refreshTtlMs > 0 ? meta.refreshTtlMs : DEFAULT_REFRESH_TTL_MS;
        } catch {
          return { ok: false as const, error: 'widget not found' };
        }
      }
      await widgets.setRefreshMode(uuid, 'timed', nextTtlMs);
      return { ok: true as const };
    }
    await widgets.setRefreshMode(uuid, mode);
    return { ok: true as const };
  });

  ipcMain.handle('widget:getWebhook', async (_event, uuid: string) => getWidgetWebhookInfo(uuid));

  ipcMain.handle('widget:testWebhook', async (_event, uuid: string) => testWidgetWebhook(uuid));

  ipcMain.handle('widget:rotateWebhookToken', async (_event, uuid: string) => {
    let meta;
    try {
      meta = await widgets.getMeta(uuid);
    } catch {
      return { ok: false as const, error: 'widget not found' };
    }
    if (effectiveRefreshMode(meta) !== 'event') {
      return { ok: false as const, error: 'widget is not event-driven' };
    }
    await widgets.rotateWebhookToken(uuid);
    return getWidgetWebhookInfo(uuid);
  });

  ipcMain.handle('widget:setProviders', async (_event, uuid: string, providerIds: unknown) => {
    if (providerIds === undefined || providerIds === null) {
      await widgets.setProviders(uuid, undefined);
      return { ok: true as const };
    }
    if (!Array.isArray(providerIds) || !providerIds.every((id) => typeof id === 'string')) {
      return { ok: false as const, error: 'providerIds must be an array of strings or null' };
    }
    const known = new Set((await secrets.list()).map((p) => p.id));
    for (const id of providerIds) {
      if (!known.has(id)) {
        return { ok: false as const, error: `unknown provider id: ${id}` };
      }
    }
    await widgets.setProviders(uuid, providerIds);
    return { ok: true as const };
  });

  ipcMain.handle('widget:list', async () => widgets.list());

  ipcMain.handle('widget:getMeta', async (_event, uuid: string) => widgets.getMeta(uuid));

  ipcMain.handle('widget:htmlUrl', async (_event, uuid: string) =>
    `file://${widgets.htmlPath(uuid).replace(/\\/g, '/')}`);

  ipcMain.handle('secrets:list', async () => secrets.list());

  ipcMain.handle('secrets:save', async (_event, p: Provider): Promise<SaveResult> => {
    const validationErr = validateProvider(p);
    if (validationErr) return validationErr;

    // Look up existing entry by id; empty value means "preserve" for updates,
    // and is rejected for creates.
    const existing = (await secrets.listForProxy()).find((x) => x.id === p.id);
    if (!p.value) {
      if (!existing) return { ok: false, error: 'value is required for a new provider' };
      p = { ...p, value: existing.value };
    }
    await secrets.save(p);
    return { ok: true };
  });

  ipcMain.handle('secrets:delete', async (_event, id: string) => {
    await secrets.delete(id);
    return { ok: true };
  });

  let activeLookup: AbortController | null = null;

  // Sweep stale .lookup/* scratch dirs left over when EBUSY (Windows keeps the
  // codex child's cwd handle open for a moment after exit) prevented inline
  // cleanup. Fire-and-forget at startup so it doesn't block IPC registration.
  void (async () => {
    const lookupRoot = path.join(widgets.widgetsRoot(), '.lookup');
    try {
      const entries = await fs.readdir(lookupRoot);
      await Promise.all(entries.map((entry) =>
        fs.rm(path.join(lookupRoot, entry), { recursive: true, force: true }).catch(() => undefined)
      ));
    } catch { /* lookupRoot doesn't exist yet */ }
  })();

  ipcMain.handle('secrets:lookupProvider', async (_event, query: string): Promise<ProviderLookupResult> => {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) return { ok: false, error: 'query is required' };

    if (activeLookup) activeLookup.abort();
    const controller = new AbortController();
    activeLookup = controller;

    const scratch = path.join(widgets.widgetsRoot(), '.lookup', randomUUID());
    await fs.mkdir(scratch, { recursive: true });
    try {
      const result = await runCodex({
        prompt: buildProviderLookupPrompt(trimmed),
        cwd: scratch,
        outputFile: PROVIDER_LOOKUP_OUTPUT_FILE,
        captureLastMessage: true,
        logPath: path.join(scratch, 'codex.log'),
        timeoutMs: 120_000,
        signal: controller.signal
      });
      if (!result.ok) {
        return { ok: false, error: result.error ?? 'codex run failed' };
      }
      const raw = await fs.readFile(path.join(scratch, PROVIDER_LOOKUP_OUTPUT_FILE), 'utf8');
      return parseProviderLookupResponse(raw);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'lookup failed' };
    } finally {
      if (activeLookup === controller) activeLookup = null;
      // Don't let cleanup failure overwrite the result. Codex holds the cwd
      // handle for a beat after exit on Windows, so this can hit EBUSY; the
      // startup sweep above picks up anything we leave behind.
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  ipcMain.handle('secrets:cancelLookup', async () => {
    if (activeLookup) {
      activeLookup.abort();
      activeLookup = null;
      return { ok: true as const };
    }
    return { ok: false as const, error: 'no active lookup' };
  });

  ipcMain.handle('secrets:test', async (_event, id: string) => {
    const providers = await secrets.listForProxy();
    const provider = providers.find((p) => p.id === id);
    if (!provider) return { ok: false as const, error: 'provider not found' };
    if (provider.hostnames.length === 0) return { ok: false as const, error: 'no hostnames configured' };

    const url = `https://${provider.hostnames[0]}/`;
    const { url: nextUrl, init: nextInit } = injectAuth(provider, url, { method: 'GET' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(nextUrl, { ...nextInit, signal: controller.signal });
      return { ok: true as const, status: response.status };
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? 'timed out after 10s' : (e?.message ?? 'network error');
      return { ok: false as const, error: message };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('app:fetch', async (event, url: string, init?: RequestInit) => {
    const cwd = widgetCwdFromSenderUrl(event.senderFrame?.url ?? '', widgets.widgetsRoot());
    let uuid: string | undefined;
    let selectedProviderIds: string[] | undefined;
    if (cwd) {
      uuid = path.basename(cwd);
      try {
        const meta = await widgets.getMeta(uuid);
        selectedProviderIds = meta.selectedProviderIds;
      } catch {
        // Widget meta unreadable — fall back to "all allowed" so failures
        // don't silently break appFetch.
      }
    }

    const method = (init && typeof (init as any).method === 'string' ? (init as any).method : 'GET').toUpperCase();
    const start = Date.now();
    const envelope = await appFetch(secrets, url, init, selectedProviderIds);
    if (uuid) {
      const errorBody = envelope.status !== 0 && envelope.status >= 400
        ? envelope.body.slice(0, 80)
        : undefined;
      recordFetchEntry(uuid, {
        at: new Date().toISOString(),
        method,
        url,
        status: envelope.status,
        durationMs: Date.now() - start,
        responseBytes: envelope.body.length,
        ...(errorBody ? { errorBody } : {})
      });
    }
    return envelope;
  });

  ipcMain.handle('app:fetchLog:get', async (_event, uuid: unknown) => {
    if (typeof uuid !== 'string' || !uuid) return [];
    return fetchLog.get(uuid) ?? [];
  });

  ipcMain.handle('app:exec', async (event, command: string, args: string[] = []) => {
    const cwd = widgetCwdFromSenderUrl(event.senderFrame?.url ?? '', widgets.widgetsRoot());
    if (!cwd) {
      return {
        ok: false,
        stdout: '',
        exitCode: null,
        truncated: false,
        error: 'local exec is only available to widget files'
      };
    }

    return runLocalExec({ command, args }, { cwd });
  });

  const cacheContext = async (senderUrl: string, requestedTtlMs: unknown) => {
    const cwd = widgetCwdFromSenderUrl(senderUrl, widgets.widgetsRoot());
    if (!cwd) return null;
    const uuid = path.basename(cwd);
    try {
      const meta = await widgets.getMeta(uuid);
      const ttlMs = meta.refreshTtlMs ?? validRequestedTtl(requestedTtlMs) ?? DEFAULT_REFRESH_TTL_MS;
      return { cwd, ttlMs, mode: effectiveRefreshMode(meta) };
    } catch {
      return null;
    }
  };

  ipcMain.handle('app:cache:get', async (event, key: unknown, requestedTtlMs?: unknown) => {
    const cwd = widgetCwdFromSenderUrl(event.senderFrame?.url ?? '', widgets.widgetsRoot());
    if (!cwd) return null;
    if (typeof key !== 'string' || !key) return null;
    const context = await cacheContext(event.senderFrame?.url ?? '', requestedTtlMs);
    if (!context) return null;
    if (context.mode === 'event') return getCacheEntryUnexpired(context.cwd, key);
    return getCacheEntry(context.cwd, key, context.ttlMs);
  });

  ipcMain.handle('app:cache:set', async (event, key: unknown, value: unknown, requestedTtlMs?: unknown) => {
    const context = await cacheContext(event.senderFrame?.url ?? '', requestedTtlMs);
    if (!context) return { ok: false as const, error: 'cache is only available to widget files' };
    if (typeof key !== 'string' || !key) return { ok: false as const, error: 'key must be a non-empty string' };
    const ttlMs = context.mode === 'event' ? DEFAULT_REFRESH_TTL_MS : context.ttlMs;
    if (ttlMs <= 0) {
      return { ok: true as const };
    }
    try {
      await writeCacheEntry(context.cwd, key, value, ttlMs);
      return { ok: true as const };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? 'cache write failed' };
    }
  });

  ipcMain.handle('app:widgetPreloadUrl', async () => {
    const widgetPreload = path.join(__dirname, '../preload/widget.js');
    return `file://${widgetPreload.replace(/\\/g, '/')}`;
  });

  ipcMain.handle('onboarding:get', async () => onboarding.get());

  ipcMain.handle('onboarding:dismiss', async () => {
    await onboarding.dismiss();
    return { ok: true };
  });

  ipcMain.handle('prefs:get', async () => prefs.get());

  ipcMain.handle('prefs:setGeekMode', async (_event, value: unknown) => {
    if (typeof value !== 'boolean') {
      return { ok: false as const, error: 'value must be a boolean' };
    }
    await prefs.setGeekMode(value);
    return { ok: true as const };
  });

  ipcMain.handle('prefs:setLanServer', async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') {
      return { ok: false as const, error: 'value must be an object' };
    }
    const next = value as { enabled?: unknown; port?: unknown };
    if (typeof next.enabled !== 'boolean') {
      return { ok: false as const, error: 'enabled must be a boolean' };
    }
    if (!Number.isInteger(next.port) || (next.port as number) < 1024 || (next.port as number) > 65535) {
      return { ok: false as const, error: 'port must be between 1024 and 65535' };
    }
    const lanServer = { enabled: next.enabled, port: next.port as number };
    await prefs.setLanServer(lanServer);
    if (lan) await lan.applyConfig(lanServer);
    return { ok: true as const };
  });

  ipcMain.handle('prefs:setUpdateChannel', async (_event, value: unknown) => {
    if (value !== 'stable' && value !== 'prerelease') {
      return { ok: false as const, error: 'updateChannel must be stable or prerelease' };
    }
    await prefs.setUpdateChannel(value);
    onUpdateChannelChanged?.(value);
    return { ok: true as const };
  });

  ipcMain.handle('prefs:setWebhookPublicBaseUrl', async (_event, value: unknown) => {
    if (value !== null && typeof value !== 'string') {
      return { ok: false as const, error: 'public webhook base URL must be an HTTPS origin' };
    }
    if (typeof value === 'string' && value.trim() !== '' && !normalizeWebhookPublicBaseUrl(value)) {
      return { ok: false as const, error: 'public webhook base URL must be an HTTPS origin' };
    }
    await prefs.setWebhookPublicBaseUrl(value);
    return { ok: true as const };
  });

  ipcMain.handle('lan:getState', async () =>
    lan?.getState() ?? { running: false, port: 32177, urls: [] });

  const unavailableStartupState = (): StartupState => ({
    enabled: false,
    supported: false,
    platform: process.platform,
    error: 'startup settings are unavailable'
  });

  ipcMain.handle('startup:get', async () =>
    startup ? startup.getState() : unavailableStartupState());

  ipcMain.handle('startup:setEnabled', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { ok: false as const, error: 'enabled must be a boolean' };
    }
    if (!startup) {
      return {
        ok: false as const,
        error: 'startup settings are unavailable',
        state: unavailableStartupState()
      };
    }
    const state = await startup.setEnabled(enabled);
    if (state.error) {
      return { ok: false as const, error: state.error, state };
    }
    return { ok: true as const, state };
  });
}
