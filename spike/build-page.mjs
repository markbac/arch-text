// Builds the export page into dist/export-page and copies every Excalidraw font folder beside it.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const out = path.resolve('dist/export-page');
await build({ root: path.resolve('export-page'), base: './', logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000 } });
fs.cpSync(path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts'), path.join(out, 'fonts'), { recursive: true });
const count = fs.readdirSync(path.join(out, 'fonts'), { recursive: true }).filter((f) => String(f).endsWith('.woff2')).length;
console.log(`built ${out} with ${count} font files`);
