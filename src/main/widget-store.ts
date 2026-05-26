import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface WidgetMeta {
  prompt: string;
  created_at: string;
  codex_model?: string;
}

export interface Widget {
  uuid: string;
  prompt: string;
  created_at: string;
}

interface DashboardFile {
  widgets: string[];
}

export interface WidgetStore {
  create(prompt: string): Promise<string>;
  list(): Promise<Widget[]>;
  delete(uuid: string): Promise<void>;
  getMeta(uuid: string): Promise<WidgetMeta>;
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
          const meta = JSON.parse(await fs.readFile(path.join(widgetsRoot, uuid, 'meta.json'), 'utf8')) as WidgetMeta;
          out.push({ uuid, prompt: meta.prompt, created_at: meta.created_at });
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
      const raw = await fs.readFile(path.join(widgetsRoot, uuid, 'meta.json'), 'utf8');
      return JSON.parse(raw) as WidgetMeta;
    }
  };
}
