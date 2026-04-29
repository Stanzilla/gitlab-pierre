import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
