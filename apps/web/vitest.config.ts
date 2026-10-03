import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Компонентные тесты используют JSX; включаем автоматический рантайм React,
  // чтобы не требовался явный импорт React в каждом тесте.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
