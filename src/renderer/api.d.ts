import type { Api } from '../preload';

export {};

declare global {
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

  interface Window {
    api: Api;
    appFetch: (url: string, init?: RequestInit) => Promise<Response>;
    cache: {
      get<T>(
        key: string,
        ttlOrFetcher: number | (() => Promise<T>),
        maybeFetcher?: () => Promise<T>
      ): Promise<T>;
    };
    local: {
      exec(command: string, args?: string[]): Promise<LocalExecResult>;
    };
  }
}
