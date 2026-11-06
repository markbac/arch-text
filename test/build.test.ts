import fs from 'node:fs';
import path from 'node:path';
import { generateNKeysBetween } from 'fractional-indexing';
import { describe, expect, it } from 'vitest';
import { build, serialise } from '../src/build.js';
import { fractionalIndex, type Scene } from '../src/emit.js';
import { resolve } from '../src/model.js';
import { parse } from '../src/parser.js';

type Box = { x: number; y: number; width: number; height: number };
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const EXAMPLES = path.resolve('examples');
const examples = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.archt'));

function resolveExample(file: string) {
  return resolve(parse(fs.readFileSync(path.join(EXAMPLES, file), 'utf8')).statements);
}

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

  it('binds every label to its container, inside it, and lists it there', async () => {
    const { elements } = await buildExample(file);
    const byId = new Map(elements.map((e) => [e.id, e]));
    for (const t of elements.filter((e) => e.type === 'text')) {
      const box = byId.get(t.containerId as string) as unknown as Box & { id: string; boundElements: unknown[]; type: string };
      expect(box.boundElements).toContainEqual({ type: 'text', id: t.id });
      if (box.type !== 'rectangle') continue;
      const tb = t as unknown as Box;
      expect(tb.x >= box.x && tb.y >= box.y && tb.x + tb.width <= box.x + box.width && tb.y + tb.height <= box.y + box.height, `${t.id} inside ${box.id}`).toBe(true);
      if (t.verticalAlign === 'middle') {
        expect(Math.abs(tb.x + tb.width / 2 - (box.x + box.width / 2))).toBeLessThan(0.02);
        expect(Math.abs(tb.y + tb.height / 2 - (box.y + box.height / 2))).toBeLessThan(0.02);
      }
    }
  });

  it('puts every element inside its container, and overlaps nothing else', async () => {
    const { elements } = await buildExample(file);
    const rects = elements.filter((e) => e.type === 'rectangle') as unknown as (Box & { id: string })[];
    const { model: m } = resolveExample(file);
    const parent = new Map(m.nodes.map((n) => [n.id, n.parent]));
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let p = parent.get(id); p; p = parent.get(p)) out.push(p);
      return out;
    };
    const byId = new Map(rects.map((r) => [r.id, r]));
    for (const r of rects) {
      // Groups are not drawn, so the nearest drawn ancestor is the container.
      const container = ancestors(r.id).map((a) => byId.get(a)).find(Boolean);
      if (container) expect(inside(r, container), `${r.id} inside ${container.id}`).toBe(true);
      for (const o of rects) {
        if (o === r || ancestors(r.id).includes(o.id) || ancestors(o.id).includes(r.id)) continue;
        expect(overlaps(r, o), `${r.id} overlaps ${o.id}`).toBe(false);
      }
    }
  });

  it('keeps arrow labels clear of shapes and of each other', async () => {
    const { elements } = await buildExample(file);
    const byId = new Map(elements.map((e) => [e.id, e]));
    const titled = new Set(elements.filter((e) => e.type === 'text' && e.verticalAlign !== 'middle').map((t) => t.containerId));
    const labels = elements.filter((e) => e.type === 'text' && byId.get(e.containerId as string)?.type === 'arrow') as unknown as (Box & { text: string })[];
    // Containers are left out: their labels sit at the top, and arrows cross them.
    const shapes = elements.filter((e) => e.type === 'rectangle' && !titled.has(e.id)) as unknown as (Box & { id: string })[];
    for (const l of labels) {
      for (const s of shapes) expect(overlaps(l, s), `"${l.text}" overlaps ${s.id}`).toBe(false);
      for (const o of labels) if (o !== l) expect(overlaps(l, o), `"${l.text}" overlaps "${o.text}"`).toBe(false);
    }
  });

  it('gives every elbow arrow fixed points on the borders of its shapes', async () => {
    const { elements } = await buildExample(file);
    for (const a of elements.filter((e) => e.type === 'arrow')) {
      expect(a.elbowed).toBe(true);
      for (const end of ['startBinding', 'endBinding'] as const) {
        const [fx, fy] = (a[end] as { fixedPoint: [number, number] }).fixedPoint;
        expect(fx === 0 || fx === 1 || fy === 0 || fy === 1, `${a.id} ${end} on a border`).toBe(true);
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

  it('places elements top to bottom with `option direction down`', async () => {
    const { scene } = await build('option direction down\nsystem A\nsystem B\nA -> B');
    const [a, , b] = scene!.elements as unknown as Box[];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  });

  it('makes a container wide enough for its title', async () => {
    const { scene } = await build('boundary A boundary with a very long title indeed\n  system B');
    const [box, title] = scene!.elements as unknown as Box[];
    expect(box!.width).toBeGreaterThan(title!.width);
  });

  it('draws actors and datastores from parts grouped as one shape, inside any enclosing group', async () => {
    const { scene } = await build('group G\n  actor A\n  datastore D');
    const groupsOf = (prefix: string) => [...new Set(scene!.elements.filter((e) => e.id.startsWith(prefix)).map((e) => JSON.stringify(e.groupIds)))];
    expect(groupsOf('a')).toEqual(['["a:shape","group:g"]']);
    expect(groupsOf('d')).toEqual(['["d:shape","group:g"]']);
    expect(scene!.elements.filter((e) => e.id.startsWith('a')).map((e) => e.type)).toEqual(['rectangle', 'text', 'ellipse', 'line', 'line', 'line']);
  });

  it('gives each element a unique ID, even when names and edges could collide', async () => {
    const { scene } = await build('system A\nsystem B\nsystem A to B\nA -> B: x\nA -> B: y');
    const ids = scene!.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fractional indices', () => {
  it('match the keys Excalidraw\'s fractional-indexing library generates in sequence', () => {
    const keys = generateNKeysBetween(null, null, 5000);
    expect(keys.map((_, i) => fractionalIndex(i))).toEqual(keys);
  });
});
