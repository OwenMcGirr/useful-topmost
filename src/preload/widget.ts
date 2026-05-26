import { contextBridge, ipcRenderer } from 'electron';

interface FetchEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Headers, Map and tuple arrays don't survive structured-clone over IPC.
// Normalize whatever the caller passed into a plain object the main proxy
// can read.
function flattenHeaders(h: RequestInit['headers']): Record<string, string> | undefined {
  if (h == null) return undefined;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v; });
    return out;
  }
  if (Array.isArray(h)) {
    const out: Record<string, string> = {};
    for (const pair of h) {
      if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
    }
    return out;
  }
  return { ...(h as Record<string, string>) };
}

async function appFetch(url: string, init?: RequestInit): Promise<Response> {
  // Strip non-serializable fields (AbortSignal, ReadableStream body, Headers).
  const safeInit = init ? {
    method: init.method,
    headers: flattenHeaders(init.headers),
    body: typeof init.body === 'string' ? init.body : undefined
  } : undefined;

  const env = await ipcRenderer.invoke('app:fetch', url, safeInit) as FetchEnvelope;
  if (env.status === 0) {
    throw new TypeError('NetworkError when attempting to fetch resource.');
  }
  return new Response(env.body, { status: env.status, headers: env.headers });
}

contextBridge.exposeInMainWorld('appFetch', appFetch);
