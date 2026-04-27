import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: {
      entry: 'src/content-loader.ts',
      formats: ['iife'],
      name: 'GitLabPierreLoader',
      fileName: () => 'content.js',
    },
    outDir: 'dist',
    sourcemap: false,
  },
});
