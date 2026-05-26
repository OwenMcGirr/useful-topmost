import path from 'node:path';
import type { IpcMain, WebContents } from 'electron';
import type { WidgetStore } from './widget-store';
import type { SecretsStore, Provider } from './secrets-store';
import type { OnboardingStore } from './onboarding-store';
import type { runCodex as RunCodexFn } from './codex-runner';
import { buildPrompt } from './codex-prompt';
import { appFetch } from './proxy';
import { runLocalExec, widgetCwdFromSenderUrl } from './local-exec';

export type GetSender = () => Pick<WebContents, 'send'>;

interface SaveResultOk { ok: true }
interface SaveResultErr { ok: false; error: string }
type SaveResult = SaveResultOk | SaveResultErr;

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

export function registerIpc(
  ipcMain: IpcMain,
  widgets: WidgetStore,
  secrets: SecretsStore,
  onboarding: OnboardingStore,
  runCodex: typeof RunCodexFn,
  getSender: GetSender
): void {
  ipcMain.handle('widget:create', async (_event, prompt: string) => {
    const uuid = await widgets.create(prompt);
    void (async () => {
      const sender = getSender();
      const providers = await secrets.list();
      const result = await runCodex({
        prompt: buildPrompt(prompt, providers),
        cwd: widgets.dir(uuid),
        logPath: widgets.logPath(uuid)
      });
      if (result.ok) {
        sender.send('widget:ready', { uuid });
      } else {
        sender.send('widget:error', { uuid, error: result.error ?? 'unknown' });
      }
    })();
    return { uuid };
  });

  ipcMain.handle('widget:delete', async (_event, uuid: string) => {
    await widgets.delete(uuid);
    return { ok: true };
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
