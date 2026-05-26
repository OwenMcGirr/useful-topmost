import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface OnboardingState {
  dismissed: boolean;
  completedAt?: string;
}

export interface OnboardingStore {
  get(): Promise<OnboardingState>;
  dismiss(): Promise<void>;
}

const DEFAULT_STATE: OnboardingState = { dismissed: false };

export function createOnboardingStore(root: string): OnboardingStore {
  const filePath = path.join(root, 'onboarding.json');

  const read = async (): Promise<OnboardingState> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as OnboardingState;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.dismissed !== 'boolean') {
        return { ...DEFAULT_STATE };
      }
      return parsed;
    } catch {
      return { ...DEFAULT_STATE };
    }
  };

  return {
    get: () => read(),
    async dismiss() {
      const next: OnboardingState = {
        dismissed: true,
        completedAt: new Date().toISOString()
      };
      await fs.writeFile(filePath, JSON.stringify(next, null, 2));
    }
  };
}
