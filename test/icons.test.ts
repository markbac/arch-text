import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import type { ExcalidrawElement } from '../src/emit.js';
import { bounds, imageSize, readLibrary } from '../src/icons.js';
import { ICON } from '../src/layout.js';

const FIXTURES = path.resolve('test/fixtures');
/** A source file that would sit beside the fixtures, so relative paths resolve there. */
const FILE = path.join(FIXTURES, 'diagram.archt');
const lines = (...l: string[]) => l.join('\n');

async function scene(source: string) {
  const { scene: s, diagnostics } = await build(source, { file: FILE });
  expect(diagnostics).toEqual([]);
  return s!;
}
const iconParts = (els: ExcalidrawElement[], node: string) => els.filter((e) => e.id.startsWith(`${node}:icon`));
const box = (e: ExcalidrawElement) => e as unknown as { x: number; y: number; width: number; height: number };

describe('reading libraries', () => {
  it('reads version 1 (`library`), naming items by position', () => {
    const items = readLibrary(path.join(FIXTURES, 'v1.excalidrawlib'));
    expect(items.map((i) => i.names)).toEqual([['v1#1'], ['v1#2']]);
    expect(items[1]!.elements.map((e) => e.type)).toEqual(['rectangle', 'rectangle', 'arrow']);
  });

  it('reads version 2 (`libraryItems`), by name and by position', () => {
    const items = readLibrary(path.join(FIXTURES, 'v2.excalidrawlib'));
    expect(items.map((i) => i.names)).toEqual([['Labelled box', 'v2#1'], ['Turned', 'v2#2'], ['v2#3'], ['Picture only', 'v2#4']]);
  });

  it('finds the true bounds of a turned element', () => {
    const turned = readLibrary(path.join(FIXTURES, 'v2.excalidrawlib'))[1]!;
    const b = bounds(turned.elements);
    expect(b.width).toBeCloseTo(20, 5);
    expect(b.height).toBeCloseTo(100, 5);
  });
});

describe('image sizes', () => {
  it.each([
    ['wide.svg', 'image/svg+xml', 48, 24],
    ['sized.svg', 'image/svg+xml', 20, 40],
    ['wide.png', 'image/png', 40, 20],
    ['wide.jpg', 'image/jpeg', 40, 20],
  ])('%s is %s, %i by %i', (file, mime, width, height) => {
    expect(imageSize(fs.readFileSync(path.join(FIXTURES, file)), mime)).toEqual({ width, height });
  });

  it('gives up on files it cannot read', () => {
    expect(imageSize(Buffer.from('<svg width="100%"></svg>'), 'image/svg+xml')).toBeUndefined();
    expect(imageSize(Buffer.from('not a png at all, really'), 'image/png')).toBeUndefined();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')).toBeUndefined();
  });
});

describe('library icons', () => {
  it('copies an item used twice independently, with no shared element or group IDs', async () => {
    const { elements } = await scene(lines('use icons ./v1.excalidrawlib', 'system A [icon: v1#2]', 'system B [icon: V1#2]'));
    const a = iconParts(elements, 'a');
    const b = iconParts(elements, 'b');
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    const ids = elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = (els: ExcalidrawElement[]) => new Set(els.flatMap((e) => e.groupIds as string[]));
    expect([...groups(a)].filter((g) => groups(b).has(g))).toEqual([]);
  });

  it('points bindings inside the item at the copies', async () => {
    const { elements } = await scene(lines('use icons ./v1.excalidrawlib', 'system A [icon: v1#2]'));
    const [r1, r2, arrow] = iconParts(elements, 'a');
    expect(arrow).toMatchObject({ startBinding: { elementId: r1!.id }, endBinding: { elementId: r2!.id } });
    expect(r1!.boundElements).toEqual([{ type: 'arrow', id: arrow!.id }]);
    // The item's own group becomes a fresh group of the copy, inside the node's shape group.
    expect(r1!.groupIds).toEqual(['a:icon:g0', 'a:shape']);
  });

  it('points bound text at its copied container, and scales the text with the item', async () => {
    const { elements } = await scene(lines('use icons ./v2.excalidrawlib', 'system A [icon: labelled  BOX]'));
    const [rect, text] = iconParts(elements, 'a');
    expect(text).toMatchObject({ containerId: rect!.id });
    expect(rect!.boundElements).toEqual([{ type: 'text', id: text!.id }]);
    expect(text!.fontSize).toBeCloseTo((20 * ICON.inside) / 80, 2);
  });

  it('scales an item to fit the icon box, keeping its aspect ratio', async () => {
    const { elements } = await scene(lines('use icons ./v2.excalidrawlib', 'system A [icon: Labelled box]'));
    const [rect] = iconParts(elements, 'a');
    expect([box(rect!).width, box(rect!).height]).toEqual([ICON.inside, ICON.inside / 2]);
  });

  it('places the icon inside its node, above the label', async () => {
    const { elements } = await scene(lines('use icons ./v2.excalidrawlib', 'system A [icon: v2#3]'));
    const node = box(elements.find((e) => e.id === 'a')!);
    const icon = box(iconParts(elements, 'a')[0]!);
    const label = box(elements.find((e) => e.id === 'a:label')!);
    expect(icon.x).toBeGreaterThan(node.x);
    expect(icon.x + icon.width).toBeLessThan(node.x + node.width);
    expect(icon.y).toBeGreaterThan(node.y);
    expect(icon.y + icon.height).toBeLessThanOrEqual(label.y);
    expect(label.y + label.height).toBeLessThanOrEqual(node.y + node.height);
  });

  it('takes an icon from a style rule', async () => {
    const { elements } = await scene(lines('use icons ./v2.excalidrawlib', 'style .chip [icon: Turned]', 'system A [class: chip]'));
    expect(iconParts(elements, 'a')).toHaveLength(1);
  });

  it('uses the first library that has a name', async () => {
    const { elements } = await scene(lines('use icons ./v2.excalidrawlib', 'use icons ./v1.excalidrawlib', 'system A [icon: v1#1]', 'system B [icon: v2#1]'));
    expect(iconParts(elements, 'a').map((e) => e.type)).toEqual(['ellipse']);
    expect(iconParts(elements, 'b').map((e) => e.type)).toEqual(['rectangle', 'text']);
  });
});

describe('image icons', () => {
  it.each([
    ['./wide.svg', 'image/svg+xml', 2],
    ['./wide.png', 'image/png', 2],
    ['wide.jpg', 'image/jpeg', 2],
    ['./sized.svg', 'image/svg+xml', 0.5],
  ])('%s becomes an image element with its data in files, keeping its aspect ratio', async (file, mimeType, ratio) => {
    const s = await scene(`system A [icon: ${file}]`);
    const [img] = iconParts(s.elements, 'a');
    expect(img).toMatchObject({ type: 'image', status: 'saved', scale: [1, 1] });
    expect(box(img!).width / box(img!).height).toBeCloseTo(ratio, 5);
    expect(Math.max(box(img!).width, box(img!).height)).toBe(ICON.inside);
    const stored = s.files[img!.fileId as string]!;
    expect(stored).toMatchObject({ id: img!.fileId, mimeType });
    expect(stored.dataURL.startsWith(`data:${mimeType};base64,`)).toBe(true);
  });

  it('stores an image used twice once, keyed by its content', async () => {
    const s = await scene(lines('system A [icon: ./wide.png]', 'system B [icon: ./../fixtures/wide.png]'));
    expect(Object.keys(s.files)).toHaveLength(1);
    expect(iconParts(s.elements, 'a')[0]!.fileId).toBe(iconParts(s.elements, 'b')[0]!.fileId);
  });
});

describe('placement', () => {
  it('with icon-only, draws no shape: the icon is the node, the label beneath, and arrows bind to an invisible box', async () => {
    const { elements } = await scene(lines('system A [icon: ./wide.svg, icon-only]', 'system B', 'B -> A'));
    const node = elements.find((e) => e.id === 'a')!;
    expect(node).toMatchObject({ type: 'rectangle', strokeColor: 'transparent', backgroundColor: 'transparent' });
    expect(node.boundElements).toContainEqual({ type: 'arrow', id: 'b->a' });
    const icon = box(iconParts(elements, 'a')[0]!);
    const label = box(elements.find((e) => e.id === 'a:label')!);
    expect(Math.max(icon.width, icon.height)).toBe(ICON.only);
    expect(icon.y).toBe(box(node).y);
    expect(label.y).toBeGreaterThanOrEqual(icon.y + icon.height);
    // The rectangle, label and icon are one group, so they move together.
    for (const id of ['a', 'a:label', 'a:icon']) expect(elements.find((e) => e.id === id)!.groupIds).toEqual(['a:shape']);
  });

  it('draws an actor\'s icon in place of the stick figure', async () => {
    const { elements } = await scene('actor A [icon: ./wide.png]');
    expect(elements.map((e) => e.id)).toEqual(['a', 'a:label', 'a:icon']);
  });

  it('puts a container\'s icon in its top corner, clear of the title', async () => {
    const { elements } = await scene(lines('system Platform [icon: ./wide.svg]', '  component A'));
    const node = box(elements.find((e) => e.id === 'platform')!);
    const icon = box(elements.find((e) => e.id === 'platform:icon')!);
    const title = box(elements.find((e) => e.id === 'platform:label')!);
    const child = box(elements.find((e) => e.id === 'a')!);
    expect(Math.max(icon.width, icon.height)).toBe(ICON.corner);
    expect(icon.x + icon.width).toBeLessThan(node.x + node.width);
    expect(icon.x).toBeGreaterThan(title.x + title.width);
    expect(icon.y + icon.height).toBeLessThanOrEqual(child.y);
  });

  it('warns that icon-only does not apply to a container', async () => {
    const { diagnostics } = await build(lines('system P [icon: ./wide.svg, icon-only]', '  system A'), { file: FILE });
    expect(diagnostics.map((d) => d.code)).toEqual(['AT024']);
  });
});

describe('icon diagnostics', () => {
  const problems = async (source: string) => (await build(source, { file: FILE })).diagnostics.map((d) => ({ code: d.code, line: d.range.line, hint: d.hint }));

  it('lists the items there are for an unknown name', async () => {
    const [d] = await problems(lines('use icons ./v2.excalidrawlib', 'system A [icon: box]'));
    expect(d).toMatchObject({ code: 'AT027', line: 2 });
    expect(d!.hint).toContain('"Labelled box"');
    expect(d!.hint).toContain('"v2#3"');
  });

  it('lists the images in the folder for a missing image', async () => {
    const [d] = await problems('system A [icon: ./wid.svg]');
    expect(d).toMatchObject({ code: 'AT027' });
    expect(d!.hint).toContain('"./wide.svg"');
    expect(d!.hint).toContain('"./wide.png"');
  });

  it('reports a library that is missing or not a library, at its `use` line', async () => {
    expect(await problems(lines('system A', 'use icons ./missing.excalidrawlib'))).toMatchObject([{ code: 'AT026', line: 2 }]);
    expect(await problems('use icons ./wide.svg')).toMatchObject([{ code: 'AT026', line: 1 }]);
  });

  it('refuses an item with nothing it can draw, and a file type it cannot use', async () => {
    expect(await problems(lines('use icons ./v2.excalidrawlib', 'system A [icon: Picture only]'))).toMatchObject([{ code: 'AT027' }]);
    expect(await problems('system A [icon: ./icon.gif]')).toMatchObject([{ code: 'AT027' }]);
  });

  it('warns that edges and groups take no icons', async () => {
    expect(await problems(lines('system A', 'system B', 'A -> B [icon: ./wide.svg]'))).toMatchObject([{ code: 'AT024' }]);
    expect(await problems(lines('group G [icon: ./wide.svg]', '  system A'))).toMatchObject([{ code: 'AT024' }]);
  });

  it('builds the same scene every time', async () => {
    const src = lines('use icons ./v1.excalidrawlib', 'system A [icon: v1#2]', 'system B [icon: ./wide.png]', 'A -> B');
    expect(JSON.stringify(await scene(src))).toBe(JSON.stringify(await scene(src)));
  });
});
