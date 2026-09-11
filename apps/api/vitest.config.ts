import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    root: './',
  },
  // esbuild (Vitest's default transform) cannot emit decorator metadata,
  // which Nest's DI depends on. swc can.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
