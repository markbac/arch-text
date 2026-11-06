// Needs the built export page (`npm run build`) and a Playwright Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import type { Scene } from '../src/emit.js';
import { ExportError, type Exporter, exportPageDir, openExporter } from '../src/exporter.js';

const EXAMPLES = path.resolve('examples');
const examples = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.archt'));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

let ex: Exporter;
beforeAll(async () => {
  ex = await openExporter();
});
afterAll(async () => {
  await ex?.close();
});

describe.each(examples)('exporting examples/%s', (file) => {
  let scene: Scene;
  beforeAll(async () => {
    scene = (await build(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'))).scene!;
  });
  const ids = () => scene.elements.map((e) => ({ id: e.id, type: e.type }));

  it('exports SVG offline, matching its golden file (update with `npm run test:update`)', async () => {
    const svg = await ex.svg(scene);
    await expect(svg).toMatchFileSnapshot(`golden/${file.replace(/\.archt$/, '.svg')}`);
  });

  it('exports byte-identical SVG every time', async () => {
    expect(await ex.svg(scene)).toBe(await ex.svg(scene));
  });

  it('inlines Excalifont in the SVG, so it renders without the network', async () => {
    const svg = await ex.svg(scene);
    expect(svg).toMatch(/@font-face\s*\{\s*font-family:\s*Excalifont;\s*src:\s*url\(data:font\/woff2;base64,/);
    expect(svg).not.toMatch(/127\.0\.0\.1|https?:\/\/(?!www\.w3\.org|github\.com\/markbac\/arch-text)/);
  });

  it('embeds the scene in the SVG and the PNG, so both reopen in Excalidraw', async () => {
    expect(await ex.readScene(await ex.svg(scene), 'image/svg+xml')).toEqual(ids());
    expect(await ex.readScene(await ex.png(scene), 'image/png')).toEqual(ids());
  });

  it('exports PNG at the requested scale', async () => {
    const [w1, h1] = pngSize(await ex.png(scene, { scale: 1 }));
    const [w2, h2] = pngSize(await ex.png(scene, { scale: 2 }));
    expect([w2, h2]).toEqual([w1 * 2, h1 * 2]);
  });

  it('applies padding', async () => {
    const [w0] = pngSize(await ex.png(scene, { padding: 0 }));
    const [w40] = pngSize(await ex.png(scene, { padding: 40 }));
    expect(w40 - w0).toBe(80);
  });

  it('leaves the background out when asked', async () => {
    expect(await ex.svg(scene, { background: true })).toMatch(/<rect[^>]*fill="#ffffff"/);
    expect(await ex.svg(scene, { background: false })).not.toMatch(/<rect[^>]*fill="#ffffff"/);
  });
});

describe('offline guarantee', () => {
  it('fails, naming the URL, when Excalidraw reaches outside the machine', async () => {
    // A copy of the export page without its fonts: Excalidraw then falls back to a CDN.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-text-nofonts-'));
    fs.cpSync(exportPageDir(), dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}fonts`) });
    const scene = (await build('system A')).scene!;
    const bare = await openExporter({ pageDir: dir });
    try {
      await expect(bare.svg(scene)).rejects.toThrow(ExportError);
      await expect(bare.svg(scene)).rejects.toThrow(/esm\.sh/);
    } finally {
      await bare.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
