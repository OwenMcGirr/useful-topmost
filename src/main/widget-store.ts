import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface WidgetMeta {
  prompt: string;
  created_at: string;
  codex_model?: string;
  chat?: WidgetChatMessage[];
  pinned?: boolean;
}

export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
  pinned?: boolean;
}

export type WidgetChatRole = 'user' | 'status';

export interface WidgetChatMessage {
  id: string;
  role: WidgetChatRole;
  text: string;
  created_at: string;
  status?: 'building' | 'updated' | 'failed';
}

interface DashboardFile {
  widgets: string[];
}

export interface WidgetStore {
  create(prompt: string): Promise<string>;
  list(): Promise<Widget[]>;
  delete(uuid: string): Promise<void>;
  getMeta(uuid: string): Promise<WidgetMeta>;
  appendChatMessage(uuid: string, message: WidgetChatMessage): Promise<void>;
  replaceChatMessage(uuid: string, messageId: string, message: WidgetChatMessage): Promise<void>;
  updatePrompt(uuid: string, prompt: string): Promise<void>;
  setPinned(uuid: string, pinned: boolean): Promise<void>;
  replaceWidgetHtml(uuid: string, html: string): Promise<void>;
  readWidgetHtml(uuid: string): Promise<string | null>;
  widgetsRoot(): string;
  htmlPath(uuid: string): string;
  logPath(uuid: string): string;
  dir(uuid: string): string;
}

export function createWidgetStore(root: string): WidgetStore {
  const dashboardPath = path.join(root, 'dashboard.json');
  const widgetsRoot = path.join(root, 'widgets');

  // Serialize writes to dashboard.json so concurrent create() calls don't lose updates.
  let writeChain: Promise<void> = Promise.resolve();
  const withDashboardLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const readDashboard = async (): Promise<DashboardFile> => {
    try {
      const raw = await fs.readFile(dashboardPath, 'utf8');
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code === 'ENOENT') return { widgets: [] };
      throw e;
    }
  };

  const writeDashboard = (d: DashboardFile) =>
    fs.writeFile(dashboardPath, JSON.stringify(d, null, 2));

  const metaPath = (uuid: string) => path.join(widgetsRoot, uuid, 'meta.json');

  const readMeta = async (uuid: string): Promise<WidgetMeta> => {
    const raw = await fs.readFile(metaPath(uuid), 'utf8');
    return JSON.parse(raw) as WidgetMeta;
  };

  const writeMeta = (uuid: string, meta: WidgetMeta) =>
    fs.writeFile(metaPath(uuid), JSON.stringify(meta, null, 2));

  return {
    widgetsRoot: () => widgetsRoot,
    dir: (uuid) => path.join(widgetsRoot, uuid),
    htmlPath: (uuid) => path.join(widgetsRoot, uuid, 'index.html'),
    logPath: (uuid) => path.join(widgetsRoot, uuid, 'codex.log'),

    async create(prompt) {
      const uuid = randomUUID();
      const dir = path.join(widgetsRoot, uuid);
      await fs.mkdir(dir, { recursive: true });
      const meta: WidgetMeta = { prompt, created_at: new Date().toISOString() };
      await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      await withDashboardLock(async () => {
        const d = await readDashboard();
        d.widgets.push(uuid);
        await writeDashboard(d);
      });
      return uuid;
    },

    async list() {
      const d = await readDashboard();
      const out: Widget[] = [];
      for (const uuid of d.widgets) {
        try {
          const meta = await readMeta(uuid);
          out.push({
            uuid,
            prompt: meta.prompt,
            created_at: meta.created_at,
            pinned: meta.pinned === true
          });
        } catch {
          // Skip a widget whose meta.json was deleted out-of-band.
        }
      }
      return out;
    },

    async delete(uuid) {
      await withDashboardLock(async () => {
        const d = await readDashboard();
        d.widgets = d.widgets.filter((u) => u !== uuid);
        await writeDashboard(d);
      });
      await fs.rm(path.join(widgetsRoot, uuid), { recursive: true, force: true });
    },

    async getMeta(uuid) {
      return readMeta(uuid);
    },

    async appendChatMessage(uuid, message) {
      const meta = await readMeta(uuid);
      const chat = meta.chat ?? [];
      await writeMeta(uuid, { ...meta, chat: [...chat, message] });
    },

    async replaceChatMessage(uuid, messageId, message) {
      const meta = await readMeta(uuid);
      const chat = meta.chat ?? [];
      await writeMeta(uuid, {
        ...meta,
        chat: chat.map((m) => m.id === messageId ? message : m)
      });
    },

    async updatePrompt(uuid, prompt) {
      const meta = await readMeta(uuid);
      await writeMeta(uuid, { ...meta, prompt });
    },

    async setPinned(uuid, pinned) {
      const meta = await readMeta(uuid);
      await writeMeta(uuid, { ...meta, pinned });
    },

    async replaceWidgetHtml(uuid, html) {
      await fs.writeFile(path.join(widgetsRoot, uuid, 'index.html'), html);
    },

    async readWidgetHtml(uuid) {
      try {
        return await fs.readFile(path.join(widgetsRoot, uuid, 'index.html'), 'utf8');
      } catch (e: any) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
    }
  };
}
