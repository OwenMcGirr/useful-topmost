import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          globals: true,
          environment: 'jsdom',
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts']
        }
      },
      {
        test: {
          name: 'main',
          globals: true,
          environment: 'node',
          include: ['src/main/**/*.{test,spec}.ts'],
          setupFiles: ['./vitest.setup.ts']
        }
      }
    ]
  }
});
