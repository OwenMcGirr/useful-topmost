import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SecretsStore, Provider } from '../secrets-store';
import { appFetch } from '../proxy';

function fakeStore(providers: Provider[]): SecretsStore {
  return {
    list: async () => providers.map(({ value: _v, ...rest }) => rest),
    listForProxy: async () => providers,
    save: async () => {},
    delete: async () => {}
  };
}

let originalFetch: typeof fetch;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  globalThis.fetch = fetchSpy as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const queryProvider: Provider = {
  id: 'q',
  name: 'OpenWeather',
  hostnames: ['api.openweathermap.org'],
  auth: { type: 'query', param: 'appid' },
  value: 'SECRET'
};

const headerProvider: Provider = {
  id: 'h',
  name: 'Bearer-API',
  hostnames: ['api.x.com'],
  auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
  value: 'TOK'
};

describe('appFetch', () => {
  it('query-strategy appends auth param, preserving existing query string', async () => {
    const store = fakeStore([queryProvider]);
    await appFetch(store, 'https://api.openweathermap.org/data?q=London');

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.openweathermap.org/data?q=London&appid=SECRET');
  });

  it('header-strategy adds the auth header, preserving caller headers', async () => {
    const store = fakeStore([headerProvider]);
    await appFetch(store, 'https://api.x.com/v1/me', { headers: { 'Accept': 'application/json' } });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'Accept': 'application/json',
      'Authorization': 'Bearer TOK'
    });
  });

  it('no matching provider → forwards unchanged', async () => {
    const store = fakeStore([queryProvider]);
    await appFetch(store, 'https://api.example.com/x?a=1', { headers: { 'X-Custom': 'v' } });

    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/x?a=1');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-Custom': 'v' });
  });

  it('hostname matching is exact (no suffix matching)', async () => {
    const store = fakeStore([queryProvider]);
    await appFetch(store, 'https://evil-api.openweathermap.org/x');

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://evil-api.openweathermap.org/x');
  });

  it('upstream throw → returns network-error envelope', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const store = fakeStore([]);

    const env = await appFetch(store, 'https://nope.example/');

    expect(env).toEqual({ status: 0, headers: {}, body: '' });
  });

  it('upstream 401 → passes envelope through unchanged', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 401, headers: { 'x-rl': '5' } }));
    const store = fakeStore([]);

    const env = await appFetch(store, 'https://example/');

    expect(env.status).toBe(401);
    expect(env.body).toBe('forbidden');
    expect(env.headers['x-rl']).toBe('5');
  });

  it('body >5MB → returns network-error envelope', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('x'.repeat(5 * 1024 * 1024 + 1), { status: 200 }));
    const store = fakeStore([]);

    const env = await appFetch(store, 'https://example/');

    expect(env).toEqual({ status: 0, headers: {}, body: '' });
  });

  it('matches the first provider whose hostnames includes the URL host', async () => {
    const multi: Provider = {
      ...queryProvider,
      id: 'multi',
      hostnames: ['api.openweathermap.org', 'pro.openweathermap.org']
    };
    const store = fakeStore([multi]);
    await appFetch(store, 'https://pro.openweathermap.org/data');

    expect(fetchSpy.mock.calls[0][0]).toBe('https://pro.openweathermap.org/data?appid=SECRET');
  });
});
