import type { Provider, SecretsStore } from './secrets-store';

export interface FetchEnvelope {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const NETWORK_ERROR_ENVELOPE: FetchEnvelope = { status: 0, headers: {}, body: '' };

function findProvider(providers: Provider[], host: string): Provider | undefined {
  return providers.find((p) => p.hostnames.includes(host));
}

export function injectAuth(provider: Provider, url: string, init: RequestInit): { url: string; init: RequestInit } {
  if (provider.auth.type === 'query') {
    const u = new URL(url);
    u.searchParams.set(provider.auth.param, provider.value);
    return { url: u.toString(), init };
  }
  // header
  const prefix = provider.auth.prefix ?? '';
  const nextHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    [provider.auth.name]: prefix + provider.value
  };
  return { url, init: { ...init, headers: nextHeaders } };
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => { out[key] = value; });
  return out;
}

export function filterProviders<T extends { id: string }>(providers: T[], selectedIds: string[] | undefined): T[] {
  if (selectedIds === undefined) return providers;
  const allowed = new Set(selectedIds);
  return providers.filter((p) => allowed.has(p.id));
}

export async function appFetch(
  store: SecretsStore,
  url: string,
  init: RequestInit = {},
  selectedProviderIds?: string[]
): Promise<FetchEnvelope> {
  try {
    const host = new URL(url).host;
    const providers = filterProviders(await store.listForProxy(), selectedProviderIds);
    const provider = findProvider(providers, host);

    const { url: nextUrl, init: nextInit } = provider
      ? injectAuth(provider, url, init)
      : { url, init };

    const response = await fetch(nextUrl, nextInit);
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) return NETWORK_ERROR_ENVELOPE;

    return {
      status: response.status,
      headers: headersToObject(response.headers),
      body
    };
  } catch {
    return NETWORK_ERROR_ENVELOPE;
  }
}
