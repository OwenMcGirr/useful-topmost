import type { IpcMain, WebContents } from 'electron';
import type { WidgetStore } from './widget-store';
import type { runCodex as RunCodexFn } from './codex-runner';
import { buildPrompt } from './codex-prompt';

export type GetSender = () => Pick<WebContents, 'send'>;

export function registerIpc(
  ipcMain: IpcMain,
  store: WidgetStore,
  runCodex: typeof RunCodexFn,
  getSender: GetSender
): void {
  ipcMain.handle('widget:create', async (_event, prompt: string) => {
    const uuid = await store.create(prompt);
    // Kick off Codex asynchronously; reply event will arrive later.
    void (async () => {
      const sender = getSender();
      const result = await runCodex({
        prompt: buildPrompt(prompt),
        cwd: store.dir(uuid),
        logPath: store.logPath(uuid)
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
    await store.delete(uuid);
    return { ok: true };
  });

  ipcMain.handle('widget:list', async () => {
    return store.list();
  });

  ipcMain.handle('widget:getMeta', async (_event, uuid: string) => {
    return store.getMeta(uuid);
  });

  ipcMain.handle('widget:htmlUrl', async (_event, uuid: string) => {
    return `file://${store.htmlPath(uuid).replace(/\\/g, '/')}`;
  });
}
