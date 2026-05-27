import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IpcMain, WebContents } from 'electron';
import type { WidgetStore } from './widget-store';
import type { SecretsStore, Provider } from './secrets-store';
import type { OnboardingStore } from './onboarding-store';
import type { runCodex as RunCodexFn } from './codex-runner';
import { PROVIDER_LOOKUP_OUTPUT_FILE, buildChatPrompt, buildPrompt, buildProviderLookupPrompt } from './codex-prompt';
import { appFetch, injectAuth } from './proxy';
import { runLocalExec, widgetCwdFromSenderUrl } from './local-exec';

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

export interface ProviderLookupResultOk {
  ok: true;
  provider: {
    name: string;
    hostnames: string[];
    auth:
      | { type: 'query'; param: string }
      | { type: 'header'; name: string; scheme: 'none' | 'bearer' | 'basic' | 'token' };
    source: string;
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

  return {
    ok: true,
    provider: {
      name: parsed.name.trim(),
      hostnames: parsed.hostnames.map((h: string) => h.trim()),
      auth: parsed.auth.type === 'query'
        ? { type: 'query', param: parsed.auth.param.trim() }
        : { type: 'header', name: parsed.auth.name.trim(), scheme: parsed.auth.scheme },
      source: parsed.source
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

export function registerIpc(
  ipcMain: IpcMain,
  widgets: WidgetStore,
  secrets: SecretsStore,
  onboarding: OnboardingStore,
  runCodex: typeof RunCodexFn,
  getSender: GetSender
): void {
  const inflight = new Map<string, AbortController>();

  const trackRun = (uuid: string): AbortController => {
    const controller = new AbortController();
    inflight.set(uuid, controller);
    return controller;
  };

  const releaseRun = (uuid: string, controller: AbortController): void => {
    if (inflight.get(uuid) === controller) inflight.delete(uuid);
  };

  ipcMain.handle('widget:create', async (_event, prompt: string) => {
    const uuid = await widgets.create(prompt);
    const controller = trackRun(uuid);
    void (async () => {
      const sender = getSender();
      const providers = await secrets.list();
      const result = await runCodex({
        prompt: buildPrompt(prompt, providers),
        cwd: widgets.dir(uuid),
        logPath: widgets.logPath(uuid),
        signal: controller.signal
      });
      releaseRun(uuid, controller);
      if (result.ok) {
        sender.send('widget:ready', { uuid });
      } else {
        sender.send('widget:error', { uuid, error: result.error ?? 'unknown' });
      }
    })();
    return { uuid };
  });

  ipcMain.handle('widget:chatStart', async (_event, message: string) => {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) throw new Error('message is required');

    const uuid = await widgets.create(trimmed);
    await widgets.appendChatMessage(uuid, chatMessage('user', trimmed));
    const status = chatMessage('status', 'Building...', 'building');
    await widgets.appendChatMessage(uuid, status);

    const controller = trackRun(uuid);
    void (async () => {
      const sender = getSender();
      const providers = await secrets.list();
      const meta = await widgets.getMeta(uuid);
      const result = await runCodex({
        prompt: buildChatPrompt({ messages: meta.chat ?? [], providers }),
        cwd: widgets.dir(uuid),
        logPath: widgets.logPath(uuid),
        signal: controller.signal
      });
      releaseRun(uuid, controller);
      if (result.ok) {
        await widgets.replaceChatMessage(uuid, status.id, {
          ...status,
          text: 'Updated',
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
        const providers = await secrets.list();
        const meta = await widgets.getMeta(uuid);
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
          await widgets.replaceChatMessage(uuid, status.id, {
            ...status,
            text: 'Updated',
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
      await fs.rm(scratch, { recursive: true, force: true });
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

  ipcMain.handle('app:fetch', async (_event, url: string, init?: RequestInit) =>
    appFetch(secrets, url, init));

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

  ipcMain.handle('app:widgetPreloadUrl', async () => {
    const widgetPreload = path.join(__dirname, '../preload/widget.js');
    return `file://${widgetPreload.replace(/\\/g, '/')}`;
  });

  ipcMain.handle('onboarding:get', async () => onboarding.get());

  ipcMain.handle('onboarding:dismiss', async () => {
    await onboarding.dismiss();
    return { ok: true };
  });
}
