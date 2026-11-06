// Serves the built export page on 127.0.0.1, drives it with Playwright and blocks every other request.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launch } from './browser.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };

export function serve(root = path.resolve('dist/export-page')) {
  const ROOT = root;
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function openExporter() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const page = await browser.newPage();
  const blocked = [];
  const fonts = new Set();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      if (url.endsWith('.woff2')) fonts.add(url.slice(origin.length));
      return route.continue();
    }
    blocked.push(url);
    return route.abort();
  });
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => window.archTextReady === true);
  return {
    page, blocked, fonts,
    svg: (scene, options) => page.evaluate(([s, o]) => window.archText.exportSvg(s, o), [scene, options]),
    png: async (scene, options) => Buffer.from(await page.evaluate(([s, o]) => window.archText.exportPng(s, o), [scene, options]), 'base64'),
    readBack: (data, mimeType) => page.evaluate(([d, m]) => window.archText.readBack(d, m), [data, mimeType]),
    async close() { await browser.close(); server.close(); },
  };
}
