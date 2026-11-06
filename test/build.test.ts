import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, serialise } from '../src/build.js';
import type { ExcalidrawElement, Scene } from '../src/emit.js';

const EXAMPLES = path.resolve('examples');
const examples = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.archt'));

async function buildExample(file: string): Promise<Scene> {
  const { scene, diagnostics } = await build(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'));
  expect(diagnostics).toEqual([]);
  return scene!;
}

describe.each(examples)('examples/%s', (file) => {
  it('matches its golden .excalidraw file (update with `npm run test:update`)', async () => {
    const scene = await buildExample(file);
    await expect(serialise(scene)).toMatchFileSnapshot(`golden/${file.replace(/\.archt$/, '.excalidraw')}`);
  });

  it('builds byte-identical output every time', async () => {
    expect(serialise(await buildExample(file))).toBe(serialise(await buildExample(file)));
  });

  it('binds every arrow at both ends, and every shape lists its arrows', async () => {
    const { elements } = await buildExample(file);
    const byId = new Map(elements.map((e) => [e.id, e]));
    expect(byId.size).toBe(elements.length);
    for (const a of elements.filter((e) => e.type === 'arrow')) {
      for (const end of ['startBinding', 'endBinding'] as const) {
        const target = byId.get((a[end] as { elementId: string }).elementId);
        expect(target, `${a.id} ${end}`).toBeDefined();
        expect(target!.boundElements).toContainEqual({ type: 'arrow', id: a.id });
      }
    }
  });

  it('binds every label to its container, centred, and lists it there', async () => {
    const { elements } = await buildExample(file);
    const byId = new Map(elements.map((e) => [e.id, e]));
    for (const t of elements.filter((e) => e.type === 'text')) {
      const box = byId.get(t.containerId as string) as ExcalidrawElement & Record<'x' | 'y' | 'width' | 'height', number>;
      expect(box.boundElements).toContainEqual({ type: 'text', id: t.id });
      if (box.type === 'rectangle') {
        const centre = (e: { x: number; y: number; width: number; height: number }) => [e.x + e.width / 2, e.y + e.height / 2];
        const [bx, by] = centre(box);
        const [tx, ty] = centre(t as unknown as typeof box);
        expect(Math.abs(bx! - tx!)).toBeLessThan(0.02);
        expect(Math.abs(by! - ty!)).toBeLessThan(0.02);
        expect(t.width as number).toBeLessThan(box.width);
      }
    }
  });
});

describe('layout', () => {
  it('places systems left to right in order of their edges, without overlaps', async () => {
    const { scene } = await build('system C\nsystem B\nsystem A\nA -> B\nB -> C');
    const rects = scene!.elements.filter((e) => e.type === 'rectangle') as unknown as { id: string; x: number; y: number; width: number; height: number }[];
    const x = Object.fromEntries(rects.map((r) => [r.id, r.x]));
    expect(x.a).toBeLessThan(x.b!);
    expect(x.b).toBeLessThan(x.c!);
    for (const a of rects)
      for (const b of rects) {
        if (a === b) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
  });

  it('makes a box wide enough for a long name', async () => {
    const { scene } = await build('system Identity Provider (OIDC) with a long name');
    const [rect, text] = scene!.elements as unknown as { width: number }[];
    expect(rect!.width).toBeGreaterThan(text!.width + 40);
  });

  it('gives each element a unique ID, even when names and edges could collide', async () => {
    const { scene } = await build('system A\nsystem B\nsystem A to B\nA -> B: x\nA -> B: y');
    const ids = scene!.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
