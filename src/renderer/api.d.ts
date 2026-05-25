import type { Api } from '../preload';

export {};

declare global {
  interface Window {
    api: Api;
  }
}
