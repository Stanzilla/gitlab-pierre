import { defineConfig } from 'vite';

const customElementsShim = `
var process = globalThis.process ?? { env: { NODE_ENV: "production" } };
process.env ??= { NODE_ENV: "production" };
process.env.NODE_ENV ??= "production";
const __gitlabPierreCustomElementsRegistry = new Map();
var customElements = globalThis.customElements ?? {
  define(name, constructor) {
    __gitlabPierreCustomElementsRegistry.set(name, constructor);
  },
  get(name) {
    return __gitlabPierreCustomElementsRegistry.get(name);
  },
  upgrade() {},
  whenDefined() {
    return Promise.resolve();
  }
};
`;

export default defineConfig({
  resolve: {
    alias: {
      '@pierre-diffs-core-style': new URL(
        './node_modules/@pierre/diffs/dist/style.js',
        import.meta.url
      ).pathname,
    },
  },
  build: {
    copyPublicDir: true,
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: 'src/content.tsx',
      formats: ['es'],
      fileName: () => 'pierre-app.js',
      cssFileName: 'content',
    },
    outDir: 'dist',
    rollupOptions: {
      output: {
        banner: customElementsShim,
      },
    },
    sourcemap: false,
  },
});
