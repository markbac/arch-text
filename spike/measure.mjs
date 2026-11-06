// Step 3 of the spike: label widths measured in Node (font files) vs the browser (canvas.measureText).
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';
import { FONT_DIR, loadFamily, measureLine } from './fonts.mjs';

const LABELS = [
  'HES', 'Platform', 'Firmware', 'Comms module', 'DLMS/COSEM', 'Events', 'Readings', 'Operator',
  'Meter data', 'API Gateway', 'Identity Provider (OIDC)', 'Kafka topic: meter.events.v2',
  'PostgreSQL 16', 'Head-End System', 'Café payments', 'Zürich data centre', 'iiiiiiiiii', 'WWWWWWWWWW',
  '1234567890', 'A, B & C -> D',
];
const SIZES = [16, 20, 28];

// Font-face rules with the unicode ranges Excalidraw itself declares for each file.
const chunk = fs.readdirSync(path.resolve('node_modules/@excalidraw/excalidraw/dist/prod')).filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.resolve('node_modules/@excalidraw/excalidraw/dist/prod', f), 'utf8')).join('\n');
function fontFaces(family) {
  return loadFamily(family).map(({ file }) => {
    const varName = chunk.match(new RegExp(`var (\\w+)="\\./fonts/${family}/${file.replace('.', '\\.')}"`))?.[1];
    const range = varName && chunk.match(new RegExp(`uri:${varName},descriptors:\\{unicodeRange:"([^"]+)"`))?.[1];
    const data = fs.readFileSync(path.join(FONT_DIR, family, file)).toString('base64');
    return `@font-face{font-family:${family};src:url(data:font/woff2;base64,${data}) format('woff2');${range ? `unicode-range:${range};` : ''}}`;
  }).join('\n');
}

const family = 'Excalifont';
const faces = loadFamily(family);
const browser = await launch();
const page = await browser.newPage();
await page.setContent(`<style>${fontFaces(family)}</style><body></body>`);
const rows = [];
for (const size of SIZES) {
  const browserWidths = await page.evaluate(async ({ labels, size, family }) => {
    await Promise.all(labels.map((l) => document.fonts.load(`${size}px ${family}`, l)));
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${size}px ${family}`;
    return labels.map((l) => ctx.measureText(l).width);
  }, { labels: LABELS, size, family });
  LABELS.forEach((l, i) => rows.push({ size, label: l, node: measureLine(faces, l, size), browser: browserWidths[i] }));
}
await browser.close();

let worst = 0;
for (const r of rows) {
  const diff = r.node - r.browser;
  worst = Math.max(worst, Math.abs(diff));
  if (r.size === 20) console.log(`${r.label.padEnd(30)} node ${r.node.toFixed(2).padStart(7)}  browser ${r.browser.toFixed(2).padStart(7)}  diff ${diff.toFixed(2)}`);
}
console.log(`\n${rows.length} measurements at sizes ${SIZES.join(', ')} px; largest absolute difference ${worst.toFixed(3)} px`);
