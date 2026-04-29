import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string };

function syncExtensionVersion(): Plugin {
  return {
    name: 'pierre-sync-extension-version',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      const manifestPath = path.join(outDir, 'manifest.json');
      const contentScriptPath = path.join(outDir, 'content.js');

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.version !== pkg.version) {
        manifest.version = pkg.version;
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }

      const contentScript = readFileSync(contentScriptPath, 'utf8');
      const versionedContentScript = contentScript.replaceAll('__APP_VERSION__', pkg.version);
      if (versionedContentScript !== contentScript) {
        writeFileSync(contentScriptPath, versionedContentScript);
      }
    },
  };
}

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
  plugins: [syncExtensionVersion()],
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
