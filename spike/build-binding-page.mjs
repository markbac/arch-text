// Builds the binding-check page (full editor) into dist/binding-page, with fonts beside it.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const out = path.resolve('dist/binding-page');
await build({ root: path.resolve('binding-page'), base: './', logLevel: 'warn', plugins: [react()],
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: { outDir: out, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 5000 } });
fs.cpSync(path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts'), path.join(out, 'fonts'), { recursive: true });
console.log(`built ${out}`);
