import { contextBridge, ipcRenderer } from 'electron';

interface FetchEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type LocalExecResult =
  | {
      ok: true;
      stdout: string;
      exitCode: number;
      truncated: boolean;
    }
  | {
      ok: false;
      stdout: string;
      exitCode: number | null;
      truncated: boolean;
      error: string;
    };

// Headers and tuple arrays don't survive structured-clone over IPC.
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

// We can't return a real Response across contextBridge — only own properties
// proxy through, and Response's surface (status, ok, json(), etc.) all lives
// on the prototype. Build a plain object that quacks like Response: every
// property an own field, every method an own function. Widgets that read
// .ok / .status / call .json() / .text() / .headers.get() see the right
// values.
interface HeadersLike {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(cb: (value: string, key: string) => void): void;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  type: 'basic';
  headers: HeadersLike;
  json(): Promise<unknown>;
  text(): Promise<string>;
  clone(): ResponseLike;
}

function makeHeadersLike(raw: Record<string, string>): HeadersLike {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(raw)) lower[k.toLowerCase()] = raw[k];
  return {
    get(name: string) {
      const v = lower[String(name).toLowerCase()];
      return v === undefined ? null : v;
    },
    has(name: string) {
      return String(name).toLowerCase() in lower;
    },
    forEach(cb) {
      for (const k of Object.keys(lower)) cb(lower[k], k);
    }
  };
}

function makeResponseLike(env: FetchEnvelope, url: string): ResponseLike {
  return {
    ok: env.status >= 200 && env.status < 300,
    status: env.status,
    statusText: '',
    url,
    redirected: false,
    type: 'basic',
    headers: makeHeadersLike(env.headers),
    async json() {
      return JSON.parse(env.body);
    },
    async text() {
      return env.body;
    },
    clone() {
      return makeResponseLike(env, url);
    }
  };
}

async function appFetch(url: string, init?: RequestInit): Promise<ResponseLike> {
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
  return makeResponseLike(env, url);
}

contextBridge.exposeInMainWorld('appFetch', appFetch);

contextBridge.exposeInMainWorld('local', {
  exec: (command: string, args: string[] = []): Promise<LocalExecResult> =>
    ipcRenderer.invoke('app:exec', command, args) as Promise<LocalExecResult>
});
