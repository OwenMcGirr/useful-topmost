import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretsStore } from '../secrets-store';

async function freshRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-store-'));
}

const sampleProvider = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'OpenWeather',
  hostnames: ['api.openweathermap.org'],
  auth: { type: 'query' as const, param: 'appid' },
  value: 'SECRET-VALUE'
};

describe('secrets-store', () => {
  it('save() writes the entry; list() returns it without the value', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);

    await store.save(sampleProvider);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: sampleProvider.id,
      name: sampleProvider.name,
      hostnames: sampleProvider.hostnames,
      auth: sampleProvider.auth
    });
    expect('value' in list[0]).toBe(false);
  });

  it('listForProxy() includes the value', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);
    await store.save(sampleProvider);

    const proxy = await store.listForProxy();
    expect(proxy).toHaveLength(1);
    expect(proxy[0].value).toBe('SECRET-VALUE');
  });

  it('save() upserts by id (does not duplicate)', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);
    await store.save(sampleProvider);
    await store.save({ ...sampleProvider, name: 'OpenWeather Pro', value: 'NEW' });

    const proxy = await store.listForProxy();
    expect(proxy).toHaveLength(1);
    expect(proxy[0].name).toBe('OpenWeather Pro');
    expect(proxy[0].value).toBe('NEW');
  });

  it('delete() removes the entry', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);
    await store.save(sampleProvider);

    await store.delete(sampleProvider.id);

    expect(await store.list()).toEqual([]);
  });

  it('list() returns [] when secrets.json does not exist', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);
    expect(await store.list()).toEqual([]);
    expect(await store.listForProxy()).toEqual([]);
  });

  it('list() returns [] (no throw) when secrets.json is corrupted', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'secrets.json'), 'not json');
    const store = createSecretsStore(root);
    expect(await store.list()).toEqual([]);
    expect(await store.listForProxy()).toEqual([]);
  });

  it('concurrent saves produce stable state', async () => {
    const root = await freshRoot();
    const store = createSecretsStore(root);
    const a = { ...sampleProvider, id: 'a' };
    const b = { ...sampleProvider, id: 'b', name: 'NewsAPI' };

    await Promise.all([store.save(a), store.save(b)]);

    const proxy = await store.listForProxy();
    expect(proxy.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
