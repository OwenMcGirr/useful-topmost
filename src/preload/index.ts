import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
}

const api = {
  createWidget: (prompt: string) => ipcRenderer.invoke('widget:create', prompt) as Promise<{ uuid: string }>,
  deleteWidget: (uuid: string) => ipcRenderer.invoke('widget:delete', uuid) as Promise<{ ok: true }>,
  listWidgets: () => ipcRenderer.invoke('widget:list') as Promise<Widget[]>,
  getWidgetMeta: (uuid: string) => ipcRenderer.invoke('widget:getMeta', uuid) as Promise<{ prompt: string; created_at: string }>,
  htmlUrl: (uuid: string) => ipcRenderer.invoke('widget:htmlUrl', uuid) as Promise<string>,
  codexAvailable: () => ipcRenderer.invoke('app:codexAvailable') as Promise<boolean>,
  onWidgetReady: (cb: (uuid: string) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { uuid: string }) => cb(payload.uuid);
    ipcRenderer.on('widget:ready', handler);
    return () => ipcRenderer.removeListener('widget:ready', handler);
  },
  onWidgetError: (cb: (uuid: string, error: string) => void) => {
    const handler = (_e: IpcRendererEvent, payload: { uuid: string; error: string }) => cb(payload.uuid, payload.error);
    ipcRenderer.on('widget:error', handler);
    return () => ipcRenderer.removeListener('widget:error', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
