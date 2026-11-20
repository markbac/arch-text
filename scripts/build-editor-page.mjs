// Builds the full-editor test page (test/editor-page) into dist-test/editor-page, with fonts.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const out = path.resolve('dist-test/editor-page');
await build({
  root: path.resolve('test/editor-page'),
  base: './',
  logLevel: 'warn',
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: { outDir: out, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000 },
  plugins: [{ name: 'quiet-use-client', apply: 'build', config: () => ({ build: { rollupOptions: { onwarn(w, warn) { if (w.code !== 'MODULE_LEVEL_DIRECTIVE') warn(w); } } } }) }],
});
fs.cpSync(path.join(path.dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts'), path.join(out, 'fonts'), { recursive: true });
console.log(`Built ${path.relative(process.cwd(), out)}.`);
