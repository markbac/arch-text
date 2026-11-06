// Offline export to SVG and PNG (ADR-003 and ADR-004 in docs/decisions.md).
// Serves the built export page on 127.0.0.1, drives it with headless Chromium, and fails on any
// request to anywhere else, so a silent fallback to a font CDN cannot go unnoticed.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright-core';
import type { Scene } from './emit.js';

export interface ExportOptions {
  /** Pixel ratio for PNG (default 1). Ignored for SVG. */
  scale?: number;
  /** Space around the drawing, in px (default 16). */
  padding?: number;
  /** Draw the white background (default true). */
  background?: boolean;
}

export class ExportError extends Error {}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** The built export page: beside this file in a release, or in dist/ when running from source. */
export function exportPageDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.join(here, 'export-page'), path.join(here, '..', 'dist', 'export-page')]) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  throw new ExportError('The export page is not built. Run `npm run build` first.');
}

function serve(root: string): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function launch(): Promise<Browser> {
  const executablePath = process.env.ARCH_TEXT_CHROMIUM || undefined;
  try {
    return await chromium.launch({ executablePath });
  } catch (e) {
    const where = executablePath ? `at ARCH_TEXT_CHROMIUM (${executablePath})` : "in Playwright's browser folder";
    throw new ExportError(
      `Could not start Chromium ${where}.\nInstall it with \`npx playwright-core install chromium\`, or set ARCH_TEXT_CHROMIUM to a Chromium or Chrome binary.\n${(e as Error).message.split('\n')[0]}`,
    );
  }
}

export interface Exporter {
  svg(scene: Scene, options?: ExportOptions): Promise<string>;
  png(scene: Scene, options?: ExportOptions): Promise<Buffer>;
  /** The element IDs and types of the scene embedded in an exported SVG or PNG. */
  readScene(data: string | Buffer, mimeType: 'image/svg+xml' | 'image/png'): Promise<{ id: string; type: string }[]>;
  close(): Promise<void>;
}

/**
 * Starts Chromium and the export page once, for any number of exports. Call `close()` when done.
 * `pageDir` overrides the built export page folder; the tests use it.
 */
export async function openExporter(options: { pageDir?: string } = {}): Promise<Exporter> {
  const root = path.resolve(options.pageDir ?? exportPageDir());
  const server = await serve(root);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let browser: Browser | undefined;
  try {
    browser = await launch();
    const page: Page = await browser.newPage();
    const blocked: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      blocked.push(url);
      return route.abort();
    });
    await page.goto(`${origin}/index.html`);
    await page.waitForFunction(() => (window as unknown as { archTextReady?: boolean }).archTextReady === true, null, { timeout: 30_000 }).catch(() => {
      throw new ExportError(`The export page did not load.${pageErrors.length ? `\n${pageErrors.join('\n')}` : ''}`);
    });

    /** Runs one export and fails if it tried to reach anything but the local page. */
    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
      const before = blocked.length;
      const result = await fn();
      const outside = blocked.slice(before);
      if (outside.length) {
        throw new ExportError(`Export tried to fetch from outside this machine, so it was stopped:\n${[...new Set(outside)].map((u) => `  ${u}`).join('\n')}`);
      }
      return result;
    };
    const opts = (o: ExportOptions = {}) => ({ scale: o.scale ?? 1, padding: o.padding ?? 16, background: o.background ?? true });
    type Api = { archText: Record<string, (...args: unknown[]) => Promise<unknown>> };
    const call = <T>(name: string, ...args: unknown[]) =>
      page.evaluate(([n, a]) => (window as unknown as Api).archText[n as string]!(...(a as unknown[])), [name, args] as const) as Promise<T>;

    const b = browser;
    return {
      svg: (scene, o) => run(() => call<string>('exportSvg', scene, opts(o))),
      png: (scene, o) => run(async () => Buffer.from(await call<string>('exportPng', scene, opts(o)), 'base64')),
      readScene: (data, mimeType) => run(() => call('readScene', typeof data === 'string' ? data : data.toString('base64'), mimeType)),
      async close() {
        await b.close();
        server.close();
      },
    };
  } catch (e) {
    await browser?.close();
    server.close();
    throw e;
  }
}

/** Exports one scene. For several, use `openExporter()` so Chromium starts once. */
export async function exportScene(scene: Scene, format: 'svg' | 'png', options?: ExportOptions): Promise<string | Buffer> {
  const ex = await openExporter();
  try {
    return format === 'svg' ? await ex.svg(scene, options) : await ex.png(scene, options);
  } finally {
    await ex.close();
  }
}
