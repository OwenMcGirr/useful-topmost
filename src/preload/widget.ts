import { contextBridge, ipcRenderer } from 'electron';

interface FetchEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function appFetch(url: string, init?: RequestInit): Promise<Response> {
  // Strip non-serializable fields (e.g. AbortSignal, ReadableStream body).
  const safeInit = init ? {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    body: typeof init.body === 'string' ? init.body : undefined
  } : undefined;

  const env = await ipcRenderer.invoke('app:fetch', url, safeInit) as FetchEnvelope;
  if (env.status === 0) {
    throw new TypeError('NetworkError when attempting to fetch resource.');
  }
  return new Response(env.body, { status: env.status, headers: env.headers });
}

contextBridge.exposeInMainWorld('appFetch', appFetch);
