// Step 2 of the spike: can convertToExcalidrawElements run in Node, and is its output usable?
//   1. Plain import from node_modules.
//   2. Bundled for Node with esbuild, no DOM.
//   3. Bundled, with the fake DOM in node-shim.mjs: inspect bindings, text sizes and determinism.
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const skeleton = () => [
  { type: 'rectangle', id: 'a', x: 0, y: 0, width: 160, height: 80, label: { text: 'HES' } },
  { type: 'rectangle', id: 'b', x: 300, y: 0, width: 160, height: 80, label: { text: 'Platform' } },
  { type: 'arrow', x: 160, y: 40, width: 140, height: 0, start: { id: 'a' }, end: { id: 'b' }, label: { text: 'Events' } },
];

if (process.argv[2] === 'run') {
  const { convertToExcalidrawElements } = await import(process.argv[3]);
  const r1 = convertToExcalidrawElements(skeleton(), { regenerateIds: false });
  const r2 = convertToExcalidrawElements(skeleton(), { regenerateIds: false });
  const arrow = r1.find((e) => e.type === 'arrow');
  console.log('   ran: bindings', arrow.startBinding?.elementId, '->', arrow.endBinding?.elementId);
  console.log('   text widths (fake measureText gives 10 px per character):', r1.filter((e) => e.type === 'text').map((t) => `${t.text}=${t.width}`).join(', '));
  console.log('   same IDs on two runs:', JSON.stringify(r1.map((e) => e.id)) === JSON.stringify(r2.map((e) => e.id)),
    '| same seeds:', JSON.stringify(r1.map((e) => e.seed)) === JSON.stringify(r2.map((e) => e.seed)));
  process.exit(0);
}

const attempt = (label, args) => {
  try { console.log(label); console.log(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()); }
  catch (e) { console.log('   failed:', (e.stderr || e.message).split('\n').find((l) => /Error/.test(l))?.trim()); }
};
await build({ entryPoints: ['@excalidraw/excalidraw'], bundle: true, platform: 'node', format: 'esm', outfile: '.tmp/excalidraw-node.mjs',
  loader: { '.css': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
  banner: { js: 'import {createRequire} from "module";const require=createRequire(import.meta.url);' } });
attempt('1. Plain import:', ['node-import.mjs', 'run', '@excalidraw/excalidraw']);
attempt('2. Bundled for Node, no DOM:', ['node-import.mjs', 'run', './.tmp/excalidraw-node.mjs']);
attempt('3. Bundled, with node-shim.mjs:', ['--import', './node-shim.mjs', 'node-import.mjs', 'run', './.tmp/excalidraw-node.mjs']);
