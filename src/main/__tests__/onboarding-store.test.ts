import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOnboardingStore } from '../onboarding-store';

async function freshRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-store-'));
}

describe('onboarding-store', () => {
  it('get() returns { dismissed: false } when onboarding.json does not exist', async () => {
    const root = await freshRoot();
    const store = createOnboardingStore(root);
    expect(await store.get()).toEqual({ dismissed: false });
  });

  it('get() returns { dismissed: false } (no throw) when onboarding.json is corrupted', async () => {
    const root = await freshRoot();
    await fs.writeFile(path.join(root, 'onboarding.json'), 'not json');
    const store = createOnboardingStore(root);
    expect(await store.get()).toEqual({ dismissed: false });
  });

  it('dismiss() writes onboarding.json with dismissed:true and an ISO completedAt', async () => {
    const root = await freshRoot();
    const store = createOnboardingStore(root);

    const before = Date.now();
    await store.dismiss();
    const after = Date.now();

    const raw = JSON.parse(await fs.readFile(path.join(root, 'onboarding.json'), 'utf8'));
    expect(raw.dismissed).toBe(true);
    expect(typeof raw.completedAt).toBe('string');
    const completedMs = new Date(raw.completedAt).getTime();
    expect(completedMs).toBeGreaterThanOrEqual(before);
    expect(completedMs).toBeLessThanOrEqual(after);
  });

  it('get() reflects a prior dismiss()', async () => {
    const root = await freshRoot();
    const store = createOnboardingStore(root);
    await store.dismiss();

    const state = await store.get();
    expect(state.dismissed).toBe(true);
    expect(typeof state.completedAt).toBe('string');
  });

  it('a second store rooted at the same dir reads the persisted dismissal', async () => {
    const root = await freshRoot();
    await createOnboardingStore(root).dismiss();

    const fresh = createOnboardingStore(root);
    expect((await fresh.get()).dismissed).toBe(true);
  });
});
