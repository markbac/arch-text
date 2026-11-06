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

type Api = { api: { updateScene(d: unknown): void; getSceneElements(): El[] } };

async function load(scene: Scene): Promise<El[]> {
  await page.evaluate((s) => (window as unknown as Api).api.updateScene({ elements: s.elements, appState: { selectedElementIds: {} } }), scene);
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
    scene = (await build(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'))).scene!;
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
