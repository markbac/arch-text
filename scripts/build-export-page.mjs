// Builds the export page into dist/export-page and copies every Excalidraw font folder beside it
// (ADR-004 in docs/decisions.md).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const out = path.resolve('dist/export-page');
await build({
  root: path.resolve('export-page'),
  base: './',
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000 },
  // Excalidraw's dependencies carry "use client" directives, which mean nothing here.
  plugins: [{ name: 'quiet-use-client', apply: 'build', config: () => ({ build: { rollupOptions: { onwarn(w, warn) { if (w.code !== 'MODULE_LEVEL_DIRECTIVE') warn(w); } } } }) }],
});
const fonts = path.join(path.dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts');
fs.cpSync(fonts, path.join(out, 'fonts'), { recursive: true });
const count = fs.readdirSync(path.join(out, 'fonts'), { recursive: true }).filter((f) => String(f).endsWith('.woff2')).length;
console.log(`Built ${path.relative(process.cwd(), out)} with ${count} font files.`);
