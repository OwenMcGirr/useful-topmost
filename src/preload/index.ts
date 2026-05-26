import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { PublicProvider, Provider } from '../main/secrets-store';
import type { OnboardingState } from '../main/onboarding-store';

export interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
}

export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
}

interface SaveResult { ok: boolean; error?: string }

const api = {
  createWidget: (prompt: string) => ipcRenderer.invoke('widget:create', prompt) as Promise<{ uuid: string }>,
  deleteWidget: (uuid: string) => ipcRenderer.invoke('widget:delete', uuid) as Promise<{ ok: true }>,
  listWidgets: () => ipcRenderer.invoke('widget:list') as Promise<Widget[]>,
  getWidgetMeta: (uuid: string) => ipcRenderer.invoke('widget:getMeta', uuid) as Promise<{ prompt: string; created_at: string }>,
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
  secrets: {
    list: () => ipcRenderer.invoke('secrets:list') as Promise<PublicProvider[]>,
    save: (p: Provider | (Omit<Provider, 'value'> & { value?: string })) =>
      ipcRenderer.invoke('secrets:save', p) as Promise<SaveResult>,
    delete: (id: string) => ipcRenderer.invoke('secrets:delete', id) as Promise<{ ok: true }>
  },
  onboarding: {
    get: () => ipcRenderer.invoke('onboarding:get') as Promise<OnboardingState>,
    dismiss: () => ipcRenderer.invoke('onboarding:dismiss') as Promise<{ ok: true }>
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
