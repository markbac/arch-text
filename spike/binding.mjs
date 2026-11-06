// Step 6 of the spike: load the hand-written scene in the real editor, drag "Platform" with
// the mouse, and check the bound arrow follows and stays bound.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';
import { serve } from './exporter.mjs';

const scene = JSON.parse(fs.readFileSync('scenes/two-boxes.excalidraw', 'utf8'));
const server = await serve(path.resolve('dist/binding-page'));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
let blocked = 0;
await page.route('**/*', (r) => (r.request().url().startsWith(origin) || r.request().url().startsWith('data:') ? r.continue() : (blocked++, r.abort())));
await page.goto(`${origin}/index.html`);
await page.waitForFunction(() => typeof window.loadScene === 'function');
await page.evaluate((s) => window.loadScene(s), scene);

const state = () => page.evaluate(() => {
  const els = window.api.getSceneElements();
  const by = (id) => els.find((e) => e.id === id);
  const a = by('hes-platform');
  const last = a.points[a.points.length - 1];
  const p = by('platform');
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = window.api.getAppState();
  return {
    platform: { x: p.x, y: p.y, w: p.width, h: p.height },
    arrowEnd: { x: a.x + last[0], y: a.y + last[1] },
    endBinding: a.endBinding?.elementId, startBinding: a.startBinding?.elementId,
    view: { scrollX, scrollY, zoom: zoom.value, offsetLeft, offsetTop },
  };
});

const before = await state();
const { view, platform } = before;
const toScreen = (x, y) => [(x + view.scrollX) * view.zoom + view.offsetLeft, (y + view.scrollY) * view.zoom + view.offsetTop];
const [sx, sy] = toScreen(platform.x + 20, platform.y + 15); // inside the box, clear of the label
const dy = 150;
await page.mouse.move(sx, sy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(sx, sy + (dy * i) / 10);
await page.mouse.up();
await page.waitForTimeout(200);
const after = await state();
await page.screenshot({ path: 'out/binding-after-drag.png' });
await browser.close();
server.close();

const moved = after.platform.y - before.platform.y;
const endFollowed = after.arrowEnd.y - before.arrowEnd.y;
console.log('Platform moved by', moved, 'px; arrow end moved by', endFollowed.toFixed(1), 'px');
console.log('Arrow end is on Platform\'s left edge:', Math.abs(after.arrowEnd.x - after.platform.x) < 12,
  '| within its height:', after.arrowEnd.y >= after.platform.y && after.arrowEnd.y <= after.platform.y + after.platform.h);
console.log('Still bound:', after.startBinding === 'hes' && after.endBinding === 'platform');
console.log('Blocked external requests:', blocked);
