// The phase 3 exit check: every example opens in the real Excalidraw editor, and when any shape
// with arrows is moved, its arrows stay attached. Needs Chromium; builds the editor page once.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import type { Scene } from '../src/emit.js';
import { serve } from '../src/exporter.js';
import { normalizeSvg } from '../src/icons.js';
import { FONTS, lineWidth } from '../src/text.js';

const PAGE = path.resolve('dist-test/editor-page');
const EXAMPLES = path.resolve('examples');
const examples = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.archt'));
/**
 * How far each shape is moved, down and right: four presses of Shift+Down and Shift+Right, 5 px
 * each. Diagonal, so an arrow end that failed to follow is off the new border whichever side it is on.
 */
const MOVE = 20;
/** How far an arrow's end may sit from its shape's border: the binding gap, plus Excalidraw's rounding. */
const TOLERANCE = 8;

interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: [number, number][];
  groupIds: string[];
  boundElements: { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  isDeleted: boolean;
}

/** The properties styling sets, which must survive opening and saving unchanged. */
const STYLE_PROPS = [
  'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'roundness',
  'fontFamily', 'fontSize', 'lineHeight', 'textAlign', 'verticalAlign', 'fileId', 'groupIds', 'containerId',
];

let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  if (!fs.existsSync(path.join(PAGE, 'index.html'))) execFileSync(process.execPath, ['scripts/build-editor-page.mjs'], { stdio: 'inherit' });
  server = await serve(PAGE);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: process.env.ARCH_TEXT_CHROMIUM || undefined });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route('**/*', (r) => (r.request().url().startsWith(origin) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => (window as unknown as { editorReady?: boolean }).editorReady === true);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

type Api = { api: { updateScene(d: unknown): void; addFiles(f: unknown[]): void; getSceneElements(): El[]; getFiles(): Record<string, unknown> } };

async function load(scene: Scene): Promise<El[]> {
  await page.evaluate((s) => {
    const { api } = window as unknown as Api;
    api.addFiles(Object.values(s.files));
    api.updateScene({ elements: s.elements, appState: { selectedElementIds: {} } });
  }, scene);
  // A click on empty canvas gives the editor keyboard focus.
  await page.mouse.click(700, 880);
  return elements();
}

const elements = () => page.evaluate(() => (window as unknown as Api).api.getSceneElements().map((e) => JSON.parse(JSON.stringify(e)) as El));

/** Selects the shape, with every part of it, and nudges it down. */
async function move(ids: string[]): Promise<void> {
  await page.evaluate((sel) => (window as unknown as Api).api.updateScene({ appState: { selectedElementIds: Object.fromEntries(sel.map((i) => [i, true])) } }), ids);
  // Key presses before the editor has taken the selection would be lost.
  await page.waitForFunction(
    (sel) => {
      const selected = (window as unknown as { api: { getAppState(): { selectedElementIds: Record<string, boolean> } } }).api.getAppState().selectedElementIds;
      return sel.every((i) => selected[i]);
    },
    ids,
  );
  for (let i = 0; i < MOVE / 5; i++) {
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
  }
}

/** The absolute start or end point of an arrow. */
function end(a: El, which: 'start' | 'end'): [number, number] {
  const p = which === 'start' ? a.points![0]! : a.points![a.points!.length - 1]!;
  return [a.x + p[0], a.y + p[1]];
}

/** Distance from a point to the border of a box, from inside or outside. */
function toBorder([x, y]: [number, number], b: El): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(x - b.x, b.x + b.width - x, y - b.y, b.y + b.height - y);
}

describe.each(examples)('examples/%s in the Excalidraw editor', (file) => {
  let scene: Scene;
  beforeAll(async () => {
    scene = (await build(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'), { file: path.join(EXAMPLES, file) })).scene!;
  });

  it('keeps every style property and image through opening and saving in Excalidraw', async () => {
    await load(scene);
    const saved = JSON.parse(
      await page.evaluate(() => {
        const w = window as unknown as Api & { serializeAsJSON(e: unknown, a: unknown, f: unknown, t: string): string };
        return w.serializeAsJSON(w.api.getSceneElements(), {}, w.api.getFiles(), 'local');
      }),
    ) as { elements: Record<string, unknown>[]; files: Record<string, { dataURL: string }> };
    const byId = new Map(saved.elements.map((e) => [e.id, e]));
    for (const el of scene.elements) {
      const props = STYLE_PROPS.filter((p) => p in el);
      const after = byId.get(el.id)!;
      expect(Object.fromEntries(props.map((p) => [p, after[p]])), el.id).toEqual(Object.fromEntries(props.map((p) => [p, el[p]])));
    }
    expect(Object.keys(saved.files ?? {}).sort()).toEqual(Object.keys(scene.files).sort());
    for (const [id, f] of Object.entries(scene.files)) expect(saved.files[id]!.dataURL).toBe(f.dataURL);
  });

  it('opens with every element, and every arrow bound at both ends', async () => {
    const els = await load(scene);
    expect(els.filter((e) => !e.isDeleted).map((e) => e.id)).toEqual(scene.elements.map((e) => e.id));
    for (const a of els.filter((e) => e.type === 'arrow')) {
      expect(a.startBinding?.elementId, `${a.id} start`).toBeTruthy();
      expect(a.endBinding?.elementId, `${a.id} end`).toBeTruthy();
    }
  });

  it('keeps arrows attached when each shape is moved', async () => {
    const shapes = (scene.elements as unknown as El[]).filter((e) => e.type === 'rectangle' && e.boundElements?.some((b) => b.type === 'arrow'));
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      await load(scene);
      // An actor or datastore is several elements in one group: select them all.
      const group = shape.groupIds[0]?.endsWith(':shape') ? shape.groupIds[0] : undefined;
      const parts = group ? (scene.elements as unknown as El[]).filter((e) => e.groupIds.includes(group)).map((e) => e.id) : [shape.id];
      await move(parts);
      const after = await elements();
      const moved = after.find((e) => e.id === shape.id)!;
      expect([moved.x - shape.x, moved.y - shape.y], `${shape.id} moved`).toEqual([MOVE, MOVE]);
      for (const { id } of shape.boundElements!.filter((b) => b.type === 'arrow')) {
        const a = after.find((e) => e.id === id)!;
        const before = (scene.elements as unknown as El[]).find((e) => e.id === id)!;
        for (const which of ['start', 'end'] as const) {
          const binding = which === 'start' ? before.startBinding : before.endBinding;
          if (binding?.elementId !== shape.id) continue;
          expect(toBorder(end(a, which), moved), `${id} ${which} is on ${shape.id}'s border after the move`).toBeLessThanOrEqual(TOLERANCE);
        }
        expect([a.startBinding?.elementId, a.endBinding?.elementId], `${id} still bound`).toContain(shape.id);
      }
    }
  });
});

describe('SVG icons as Excalidraw stores them', () => {
  it.each([
    ['complete, with text around it', '<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2" width="4" height="2"><rect width="4" height="2"/></svg>\n'],
    ['no width or height', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect/></svg>'],
    ['no viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="40"><rect/></svg>'],
    ['no xmlns', '<svg viewBox="0 0 10 10" width="10" height="10"><rect/></svg>'],
    ['percentage width', '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="30" viewBox="0 0 60 30"><rect/></svg>'],
    ['nothing at all', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'],
    ['fractional viewBox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12.5 7.25"><rect/></svg>'],
  ])('%s: the editor keeps it exactly as arch-text embeds it', async (name, svg) => {
    // The editor rewrites an SVG file it is given into its normal form; read back what it kept.
    const stored = await page.evaluate(
      ([id, text]) => {
        const { api } = window as unknown as { api: { addFiles(f: unknown[]): void; getFiles(): Record<string, { dataURL: string }> } };
        api.addFiles([{ id, mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa(text)}`, created: 1 }]);
        const kept = api.getFiles()[id]!.dataURL;
        return atob(kept.slice(kept.indexOf(',') + 1));
      },
      [`svg-${name}`, svg] as const,
    );
    expect(normalizeSvg(svg)).toBe(stored);
  });
});

describe('text measurement matches the browser', () => {
  const LABELS = ['HES', 'Comms module', 'Identity Provider (OIDC)', 'Café payments', 'Zürich data centre', 'iiiiiiiiii', 'WWWWWWWWWW', 'A, B & C -> D'];
  for (const [name, font] of Object.entries(FONTS)) it(`${name} (${font.family})`, async ({ skip }) => {
    // Headless Chromium on Linux rounds each glyph's advance to a whole pixel, so its widths are
    // not exact there and cannot check ours. Excalidraw in a desktop browser does not round.
    const rounds = await page.evaluate(async () => {
      await document.fonts.load('20px Excalifont', 'i');
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '20px Excalifont';
      return ['i', 'ii', 'HES', 'Comms module'].every((t) => Number.isInteger(ctx.measureText(t).width));
    });
    if (rounds) skip();
    for (const size of [16, 20, 28]) {
      // Excalidraw registers its font faces, with their unicode ranges, in the editor page.
      const css = font.family === 'ComicShanns' ? '"Comic Shanns"' : font.family;
      const widths = await page.evaluate(
        async ([labels, size, css]) => {
          await Promise.all(labels.map((l) => document.fonts.load(`${size}px ${css}`, l)));
          const ctx = document.createElement('canvas').getContext('2d')!;
          ctx.font = `${size}px ${css}`;
          return labels.map((l) => ctx.measureText(l).width);
        },
        [LABELS, size, css] as const,
      );
      LABELS.forEach((l, i) => expect(lineWidth(l, font.family, size), `${l} at ${size}px`).toBeCloseTo(widths[i]!, 1));
    }
  });
});
