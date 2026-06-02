import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { PublicProvider, Provider } from '../main/secrets-store';
import type { OnboardingState } from '../main/onboarding-store';
import type { UpdateState } from '../main/updater';
import type { WidgetSize, WidgetSummary } from '../main/widget-store';
import type { LanServerState } from '../main/lan-server';
import type { StartupState } from '../main/startup';

export interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
  pinned?: boolean;
  size?: WidgetSize;
  selectedProviderIds?: string[];
  summary?: WidgetSummary;
  refreshTtlMs?: number;
}

export type WidgetChatRole = 'user' | 'status';

export interface WidgetChatMessage {
  id: string;
  role: WidgetChatRole;
  text: string;
  created_at: string;
  status?: 'building' | 'updated' | 'failed';
}

interface SaveResult { ok: boolean; error?: string }
interface ChatResult { ok: boolean; error?: string }

export interface WidgetFetchLogEntry {
  at: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  responseBytes: number;
  errorBody?: string;
}

export type LookupProviderResult =
  | {
      ok: true;
      provider: {
        name: string;
        hostnames: string[];
        auth:
          | { type: 'query'; param: string }
          | { type: 'header'; name: string; scheme: 'none' | 'bearer' | 'basic' | 'token' };
        source: string;
        instructions?: string;
      };
    }
  | { ok: false; error: string };

const api = {
  createWidget: (prompt: string, selectedProviderIds?: string[], refreshTtlMs?: number) =>
    ipcRenderer.invoke('widget:create', prompt, selectedProviderIds, refreshTtlMs) as Promise<{ uuid: string }>,
  chatStartWidget: (message: string, selectedProviderIds?: string[], refreshTtlMs?: number) =>
    ipcRenderer.invoke('widget:chatStart', message, selectedProviderIds, refreshTtlMs) as Promise<{ uuid: string }>,
  chatSendWidget: (uuid: string, message: string) =>
    ipcRenderer.invoke('widget:chatSend', uuid, message) as Promise<ChatResult>,
  listWidgetChat: (uuid: string) =>
    ipcRenderer.invoke('widget:chatList', uuid) as Promise<WidgetChatMessage[]>,
  deleteWidget: (uuid: string) => ipcRenderer.invoke('widget:delete', uuid) as Promise<{ ok: true }>,
  cancelWidget: (uuid: string) =>
    ipcRenderer.invoke('widget:cancel', uuid) as Promise<{ ok: true } | { ok: false; error: string }>,
  setWidgetPinned: (uuid: string, pinned: boolean) =>
    ipcRenderer.invoke('widget:setPinned', uuid, pinned) as Promise<{ ok: true }>,
  setWidgetSize: (uuid: string, size: WidgetSize) =>
    ipcRenderer.invoke('widget:setSize', uuid, size) as Promise<{ ok: true } | { ok: false; error: string }>,
  setWidgetProviders: (uuid: string, providerIds: string[] | null) =>
    ipcRenderer.invoke('widget:setProviders', uuid, providerIds) as Promise<{ ok: true } | { ok: false; error: string }>,
  setWidgetRefreshTtl: (uuid: string, ttlMs: number | null) =>
    ipcRenderer.invoke('widget:setRefreshTtl', uuid, ttlMs) as Promise<{ ok: true } | { ok: false; error: string }>,
  listWidgets: () => ipcRenderer.invoke('widget:list') as Promise<Widget[]>,
  getWidgetMeta: (uuid: string) => ipcRenderer.invoke('widget:getMeta', uuid) as Promise<{ prompt: string; created_at: string }>,
  getWidgetFetchLog: (uuid: string) =>
    ipcRenderer.invoke('app:fetchLog:get', uuid) as Promise<WidgetFetchLogEntry[]>,
  htmlUrl: (uuid: string) => ipcRenderer.invoke('widget:htmlUrl', uuid) as Promise<string>,
  codexAvailable: () => ipcRenderer.invoke('app:codexAvailable') as Promise<boolean>,
  codexStatus: () => ipcRenderer.invoke('app:codexStatus') as Promise<CodexStatus>,
  widgetPreloadUrl: () => ipcRenderer.invoke('app:widgetPreloadUrl') as Promise<string>,
  onWidgetReady: (cb: (uuid: string) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { uuid: string }) => cb(payload.uuid);
    ipcRenderer.on('widget:ready', handler);
    return () => ipcRenderer.removeListener('widget:ready', handler);
  },
  onWidgetError: (cb: (uuid: string, error: string) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { uuid: string; error: string }) => cb(payload.uuid, payload.error);
    ipcRenderer.on('widget:error', handler);
    return () => ipcRenderer.removeListener('widget:error', handler);
  },
  onWidgetPlan: (cb: (uuid: string, providers: Array<{ name: string; hostname: string }>) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { uuid: string; providers: Array<{ name: string; hostname: string }> }) =>
      cb(payload.uuid, payload.providers);
    ipcRenderer.on('widget:plan', handler);
    return () => ipcRenderer.removeListener('widget:plan', handler);
  },
  secrets: {
    list: () => ipcRenderer.invoke('secrets:list') as Promise<PublicProvider[]>,
    save: (p: Provider | (Omit<Provider, 'value'> & { value?: string })) =>
      ipcRenderer.invoke('secrets:save', p) as Promise<SaveResult>,
    delete: (id: string) => ipcRenderer.invoke('secrets:delete', id) as Promise<{ ok: true }>,
    test: (id: string) =>
      ipcRenderer.invoke('secrets:test', id) as Promise<{ ok: true; status: number } | { ok: false; error: string }>,
    lookupProvider: (query: string) =>
      ipcRenderer.invoke('secrets:lookupProvider', query) as Promise<LookupProviderResult>,
    cancelLookup: () =>
      ipcRenderer.invoke('secrets:cancelLookup') as Promise<{ ok: true } | { ok: false; error: string }>
  },
  onboarding: {
    get: () => ipcRenderer.invoke('onboarding:get') as Promise<OnboardingState>,
    dismiss: () => ipcRenderer.invoke('onboarding:dismiss') as Promise<{ ok: true }>
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get') as Promise<{ geekMode: boolean; lanServer: { enabled: boolean; port: number } }>,
    setGeekMode: (value: boolean) =>
      ipcRenderer.invoke('prefs:setGeekMode', value) as Promise<{ ok: true } | { ok: false; error: string }>,
    setLanServer: (value: { enabled: boolean; port: number }) =>
      ipcRenderer.invoke('prefs:setLanServer', value) as Promise<{ ok: true } | { ok: false; error: string }>
  },
  lan: {
    getState: () => ipcRenderer.invoke('lan:getState') as Promise<LanServerState>
  },
  startup: {
    get: () => ipcRenderer.invoke('startup:get') as Promise<StartupState>,
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('startup:setEnabled', enabled) as Promise<
        { ok: true; state: StartupState } | { ok: false; error: string; state?: StartupState }
      >
  },
  updates: {
    getState: () => ipcRenderer.invoke('update:getState') as Promise<UpdateState>,
    checkNow: () => ipcRenderer.invoke('update:checkNow') as Promise<UpdateState>,
    restart: () => ipcRenderer.invoke('update:restart') as Promise<void>,
    onState: (cb: (state: UpdateState) => void) => {
      const handler = (_e: IpcRendererEvent, state: UpdateState) => cb(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
export type { StartupState, UpdateState, WidgetSize };
