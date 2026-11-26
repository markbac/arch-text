import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import type { ExcalidrawElement } from '../src/emit.js';
import { colour, PALETTE } from '../src/style.js';
import { FONTS, measure } from '../src/text.js';

const lines = (...l: string[]) => l.join('\n');

async function scene(source: string): Promise<ExcalidrawElement[]> {
  const { scene: s, diagnostics } = await build(source);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return s!.elements;
}
const find = (els: ExcalidrawElement[], id: string) => els.find((e) => e.id === id)!;

describe('colours', () => {
  it.each([
    ['#1F4E79', 'fill', '#1f4e79'],
    ['#abc', 'stroke', '#aabbcc'],
    ['#11223344', 'fill', '#11223344'],
    ['transparent', 'fill', 'transparent'],
    ['none', 'fill', 'transparent'],
    ['black', 'stroke', '#1e1e1e'],
    ['white', 'fill', '#ffffff'],
    ['blue', 'fill', '#a5d8ff'],
    ['blue', 'stroke', '#1971c2'],
    ['Blue-3', 'fill', '#4dabf7'],
    ['grey', 'stroke', '#343a40'],
    ['purple', 'fill', '#d0bfff'],
    ['bronze-5', 'fill', '#846358'],
  ] as const)('%s as a %s is %s', (value, role, expected) => {
    expect(colour(value, role)).toBe(expected);
  });

  it.each(['blu', '#12345', 'blue-6', 'rgb(0,0,0)', ''])('rejects %j', (value) => {
    expect(colour(value, 'fill')).toBeUndefined();
  });

  it('names the same shades as Excalidraw: the second for a fill, the fifth for a stroke', () => {
    for (const [name, shades] of Object.entries(PALETTE)) {
      expect(colour(name, 'fill')).toBe(shades[1]);
      expect(colour(name, 'stroke')).toBe(shades[4]);
    }
  });
});

describe('every attribute sets its Excalidraw property', () => {
  it.each([
    ['fill: blue', 'backgroundColor', '#a5d8ff'],
    ['fill-style: cross-hatch', 'fillStyle', 'cross-hatch'],
    ['stroke: #ff0000', 'strokeColor', '#ff0000'],
    ['stroke-width: extra-bold', 'strokeWidth', 4],
    ['stroke-width: 3', 'strokeWidth', 3],
    ['stroke-style: dotted', 'strokeStyle', 'dotted'],
    ['rough: cartoon', 'roughness', 2],
    ['rough: 0', 'roughness', 0],
    ['rounded', 'roundness', { type: 3 }],
    ['opacity: 40', 'opacity', 40],
  ])('[%s] on an element: %s', async (attr, prop, value) => {
    expect(find(await scene(`system A [${attr}]`), 'a')[prop]).toEqual(value);
  });

  it.each([
    ['font: code', 'fontFamily', FONTS.code.id],
    ['font: normal', 'lineHeight', FONTS.normal.lineHeight],
    ['font-size: large', 'fontSize', 28],
    ['font-size: 13', 'fontSize', 13],
    ['text-color: green', 'strokeColor', '#2f9e44'],
    ['text-align: right', 'textAlign', 'right'],
    ['opacity: 40', 'opacity', 40],
  ])('[%s] on an element: its label\'s %s', async (attr, prop, value) => {
    expect(find(await scene(`system A [${attr}]`), 'a:label')[prop]).toEqual(value);
  });

  it('`rounded: no` takes the rounding off a component', async () => {
    expect(find(await scene('component A [rounded: no]'), 'a').roundness).toBeNull();
    expect(find(await scene('component A'), 'a').roundness).toEqual({ type: 3 });
  });

  it.each([
    ['stroke: red', 'strokeColor', '#e03131'],
    ['stroke-width: thin', 'strokeWidth', 1],
    ['stroke-style: dotted', 'strokeStyle', 'dotted'],
    ['rough: clean', 'roughness', 0],
  ])('[%s] on an edge: %s', async (attr, prop, value) => {
    expect(find(await scene(`system A\nsystem B\nA -> B: x [${attr}]`), 'a->b')[prop]).toEqual(value);
  });

  it.each([
    ['font: normal', 'fontFamily', FONTS.normal.id],
    ['font-size: small', 'fontSize', 16],
    ['font-size: huge', 'fontSize', 36],
    ['text-color: blue', 'strokeColor', '#1971c2'],
  ])('[%s] on an edge: its label\'s %s', async (attr, prop, value) => {
    expect(find(await scene(`system A\nsystem B\nA -> B: x [${attr}]`), 'a->b:label')[prop]).toEqual(value);
  });

  it('paints every part of an actor and a datastore, and keeps their bindable boxes invisible', async () => {
    const els = await scene('actor A [stroke: red, fill: yellow, stroke-style: dashed]\ndatastore D [fill: blue, fill-style: hachure]');
    for (const id of ['a:head', 'a:body', 'a:arms', 'a:legs']) expect(find(els, id)).toMatchObject({ strokeColor: '#e03131', strokeStyle: 'dashed' });
    expect(find(els, 'a:head').backgroundColor).toBe('#ffec99');
    for (const id of ['d:body', 'd:cap']) expect(find(els, id)).toMatchObject({ backgroundColor: '#a5d8ff', fillStyle: 'hachure' });
    for (const id of ['a', 'd']) expect(find(els, id)).toMatchObject({ strokeColor: 'transparent', backgroundColor: 'transparent' });
  });

  it('draws the label after a filled datastore\'s parts, so they never cover it', async () => {
    const ids = (await scene('datastore D [fill: blue]')).map((e) => e.id);
    expect(ids.indexOf('d:label')).toBeGreaterThan(ids.indexOf('d:body'));
    expect(ids.indexOf('d:label')).toBeGreaterThan(ids.indexOf('d:cap'));
  });
});

describe('options', () => {
  it.each([
    ['clean', 0],
    ['artist', 1],
    ['cartoon', 2],
  ])('`option sketch %s` sets roughness %i everywhere', async (value, roughness) => {
    const els = await scene(`option sketch ${value}\nsystem A\nactor B\nA -> B`);
    for (const id of ['a', 'b:head', 'a->b']) expect(find(els, id).roughness).toBe(roughness);
  });

  it.each(['hand', 'normal', 'code'] as const)('`option font %s` sets every label\'s font', async (font) => {
    const els = await scene(`option font ${font}\nsystem A\nsystem B\nA -> B: x`);
    for (const id of ['a:label', 'a->b:label']) expect(find(els, id)).toMatchObject({ fontFamily: FONTS[font].id, lineHeight: FONTS[font].lineHeight });
  });

  it('`option colors types` fills by kind, lighter for containers, and leaves boundaries and edges clear', async () => {
    const els = await scene(lines('option colors types', 'system S', '  component C', 'datastore D', 'actor A', 'boundary B', '  system T', 'S -> D'));
    expect(find(els, 's').backgroundColor).toBe('#e7f5ff');
    expect(find(els, 'c').backgroundColor).toBe('#b2f2bb');
    expect(find(els, 't').backgroundColor).toBe('#a5d8ff');
    expect(find(els, 'd:cap').backgroundColor).toBe('#ffec99');
    expect(find(els, 'a:head').backgroundColor).toBe('#d0bfff');
    expect(find(els, 'b').backgroundColor).toBe('transparent');
    expect(find(els, 's->d').backgroundColor).toBe('transparent');
  });
});

describe('precedence: options, then kind rules, then class rules in source order, then attributes', () => {
  // Each row: the style lines, the element's attributes, and the stroke that should win.
  it.each([
    ['nothing set', [], '', '#1e1e1e'],
    ['a kind rule', ['style system [stroke: red]'], '', '#e03131'],
    ['a class rule beats a kind rule written after it', ['style .x [stroke: blue]', 'style system [stroke: red]'], 'class: x', '#1971c2'],
    ['the attribute beats both', ['style system [stroke: red]', 'style .x [stroke: blue]'], 'class: x, stroke: green', '#2f9e44'],
    ['two classes: the later rule in the source wins', ['style .x [stroke: blue]', 'style .y [stroke: red]'], 'class: x, y', '#e03131'],
    ['two classes: the order on the element does not matter', ['style .x [stroke: blue]', 'style .y [stroke: red]'], 'class: y, x', '#e03131'],
    ['two rules for one kind: the later wins', ['style system [stroke: blue]', 'style system [stroke: red]'], '', '#e03131'],
    ['a class rule only applies to its class', ['style .y [stroke: red]'], 'class: x', '#1e1e1e'],
    ['a class written with its dot', ['style .x [stroke: red]'], 'class: .x', '#e03131'],
  ])('%s', async (_name, rules, attrs, stroke) => {
    const els = await scene(lines(...rules, `system A${attrs ? ` [${attrs}]` : ''}`));
    expect(find(els, 'a').strokeColor).toBe(stroke);
  });

  it('layers merge property by property', async () => {
    const els = await scene(lines('option sketch clean', 'style system [fill: blue, stroke: red]', 'style .x [stroke: green, opacity: 50]', 'system A [class: x, opacity: 80]'));
    expect(find(els, 'a')).toMatchObject({ roughness: 0, backgroundColor: '#a5d8ff', strokeColor: '#2f9e44', opacity: 80 });
  });

  it('`..>` is dashed unless a rule or attribute says otherwise', async () => {
    const base = ['system A', 'system B'];
    expect(find(await scene(lines(...base, 'A ..> B')), 'a->b').strokeStyle).toBe('dashed');
    expect(find(await scene(lines('style edge [stroke-style: dotted]', ...base, 'A ..> B')), 'a->b').strokeStyle).toBe('dotted');
    expect(find(await scene(lines(...base, 'A ..> B [stroke-style: solid]')), 'a->b').strokeStyle).toBe('solid');
  });

  it('edges take only the edge properties from a class rule shared with elements', async () => {
    const els = await scene(lines('style .x [fill: red, stroke: blue, rounded, opacity: 10]', 'system A [class: x]', 'system B', 'A -> B [class: x]'));
    expect(find(els, 'a->b')).toMatchObject({ strokeColor: '#1971c2', backgroundColor: 'transparent', opacity: 100, roundness: null });
  });

  it('kind rules for edges apply to every edge, not to elements', async () => {
    const els = await scene(lines('style edge [stroke: red]', 'system A', 'system B', 'A -> B'));
    expect(find(els, 'a->b').strokeColor).toBe('#e03131');
    expect(find(els, 'a').strokeColor).toBe('#1e1e1e');
  });
});

describe('text measurement follows the font and size', () => {
  it('sizes a label for its own font and size, and the box to fit it', async () => {
    for (const [attrs, font, size] of [
      ['', FONTS.hand, 20],
      ['font: normal, font-size: 36', FONTS.normal, 36],
      ['font: code, font-size: small', FONTS.code, 16],
    ] as const) {
      // One word, so it is never wrapped.
      const els = await scene(`system Gateway${attrs ? ` [${attrs}]` : ''}`);
      const label = find(els, 'gateway:label');
      const box = find(els, 'gateway');
      const m = measure('Gateway', size, font);
      expect(label.width).toBeCloseTo(m.width, 1);
      expect(label.height).toBeCloseTo(m.height, 1);
      expect(box.width as number).toBeGreaterThan(m.width);
      expect(box.height as number).toBeGreaterThan(m.height);
    }
  });

  it('makes a bigger font give a bigger box', async () => {
    const width = async (attrs: string) => find(await scene(`system Platform [${attrs}]`), 'platform').width as number;
    expect(await width('font-size: huge')).toBeGreaterThan(await width('font-size: medium'));
  });

  it('measures edge labels in their own font, so ELK makes room for them', async () => {
    const els = await scene('system A\nsystem B\nA -> B: a long label here [font: code, font-size: large]');
    expect(find(els, 'a->b:label').width).toBeCloseTo(measure('a long label here', 28, FONTS.code).width, 1);
  });
});

describe('style diagnostics', () => {
  it('warns about markup and names the alternatives', async () => {
    const { diagnostics } = await build('system _Core_ platform');
    expect(diagnostics.map((d) => d.code)).toEqual(['AT022']);
    expect(diagnostics[0]!.hint).toMatch(/font-size|text-color/);
  });

  it('accepts names that only look a little like markup', async () => {
    for (const name of ['snake_case_name', 'a * b', '2*3', 'C++']) expect((await build(`system "${name}"`)).diagnostics).toEqual([]);
  });

  it('explains a bad value and keeps the rest of the list', async () => {
    const { scene: s, diagnostics } = await build('system A [fill: blu, stroke: red]');
    expect(diagnostics[0]).toMatchObject({ code: 'AT023', severity: 'warning' });
    expect(diagnostics[0]!.hint).toMatch(/blue-3/);
    expect(find(s!.elements, 'a')).toMatchObject({ backgroundColor: 'transparent', strokeColor: '#e03131' });
  });
});

describe('size', () => {
  const box = async (source: string, id = 'a') => {
    const e = find(await scene(source), id) as unknown as { width: number; height: number };
    return [e.width, e.height];
  };

  it.each([
    ['medium', 200, 100],
    ['large', 320, 160],
    ['huge', 480, 240],
    ['400x200', 400, 200],
    ['400 x 200', 400, 200],
  ])('`size: %s` draws a %i x %i box', async (size, w, h) => {
    expect(await box(`system A [size: ${size}]`)).toEqual([w, h]);
  });

  it('`size: small` is the smallest box, which its label may make a little taller', async () => {
    const [w, h] = await box('system A [size: small]');
    expect(w).toBe(120);
    expect(h).toBe((await box('system A'))[1]);
  });

  it('sets one side with `width` or `height`; the other keeps to 2:1 or fits the label', async () => {
    const [w] = await box('system A');
    expect(await box('system A [width: 300]')).toEqual([300, 150]);
    expect(await box('system A [height: 40]')).toEqual([w, (await box('system A [height: 40]'))[1]]);
    expect(await box('system A [height: 150]')).toEqual([w, 150]);
  });

  it('never makes a box smaller than its label needs', async () => {
    const [w] = await box('system A rather long name for a small box @a');
    expect((await box('system A rather long name for a small box @a [size: 40x40]'))[0]).toBe(w);
  });

  it('comes from style rules, and `auto` undoes one', async () => {
    const src = lines('style system [size: large]', 'style .plain [size: auto]', 'system A', 'system B [class: plain]', 'system C [class: plain, width: 250]');
    const natural = await box('system B', 'b');
    expect(await box(src, 'a')).toEqual([320, 160]);
    expect(await box(src, 'b')).toEqual(natural);
    expect((await box(src, 'c'))[0]).toBe(250);
  });

  it('is the least size of a container, which still grows to hold its children', async () => {
    expect(await box(lines('boundary A [size: 900x500]', '  system B'))).toEqual([900, 500]);
    const [w] = await box(lines('boundary A [width: 50]', '  system B', '  system C', '  B -> C'));
    expect(w).toBeGreaterThan(50 + 2 * 120);
  });

  it('overrides the growth of a hub', async () => {
    const targets = ['system T1', 'system T2', 'system T3', 'system T4', 'system T5'];
    const src = (attrs: string) => lines('option direction down', `system A ${attrs}`, ...targets, ...targets.map((t) => `A -> ${t.slice(7)}`));
    expect((await box(src('')))[0]).toBeGreaterThan(500);
    expect(await box(src('[size: medium]'))).toEqual([200, 100]);
  });

  it('scales an actor\'s stick figure to the height it gives, never below the usual', async () => {
    const figure = async (attrs: string) => {
      const { diagnostics, scene: s } = await build(`actor A ${attrs}`);
      expect(diagnostics).toEqual([]);
      const part = (p: string) => s!.elements.find((e) => e.id === `a:${p}`) as unknown as { y: number; height: number; points: [number, number][] };
      const legs = part('legs');
      return legs.y + Math.max(...legs.points.map(([, y]) => y)) - part('head').y;
    };
    expect(await figure('')).toBeCloseTo(70, 0);
    expect(await figure('[size: small]')).toBeCloseTo(70, 0);
    expect(await figure('[size: large]')).toBeCloseTo(160, 0);
    expect(await figure('[height: 120]')).toBeCloseTo(120, 0);
    const big = (await build(lines('style actor [size: huge]', 'actor A'))).scene!.elements.find((e) => e.id === 'a') as unknown as { height: number };
    expect(big.height).toBeGreaterThan(240);
  });

  it('scales an `icon-only` element\'s icon to the height it gives, never below the usual', async () => {
    const icon = async (attrs: string) => {
      const { diagnostics, scene: s } = await build(`system A [icon: ./icons/router.svg, icon-only${attrs}]`, { file: 'examples/x.archt' });
      expect(diagnostics).toEqual([]);
      const e = s!.elements.find((x) => x.id === 'a:icon') as unknown as { width: number; height: number };
      return Math.max(e.width, e.height);
    };
    expect(await icon('')).toBe(64);
    expect(await icon(', size: small')).toBe(64);
    expect(await icon(', size: large')).toBe(160);
  });

  it.each(['big', '10x10', '400x', 'x200', '5000x100'])('rejects `size: %s` with a hint', async (size) => {
    const { diagnostics } = await build(`system A [size: ${size}]`);
    expect(diagnostics.map((d) => d.code)).toEqual(['AT023']);
    expect(diagnostics[0]!.message).toContain('400x200');
  });
});

describe('line breaks and wrapping', () => {
  const text = async (source: string, id: string) => find(await scene(source), `${id}:label`).text;

  it.each([
    ['system Metrology<br>Unit @a', 'Metrology\nUnit'],
    ['system Metrology <br/> Unit @a', 'Metrology\nUnit'],
    ['system Metrology\\nUnit @a', 'Metrology\nUnit'],
    ['system "Metrology\\nUnit" @a', 'Metrology\nUnit'],
    ['system "Metrology<br>Unit" @a', 'Metrology\nUnit'],
  ])('`%s` breaks the name', async (source, expected) => {
    expect(await text(source, 'a')).toBe(expected);
  });

  it('breaks edge labels, and matches a broken name in an edge as if on one line', async () => {
    const els = await scene(lines('system Metrology<br>Unit', 'system B', 'Metrology Unit -> B: VCC<br>GND'));
    const label = els.find((e) => e.type === 'text' && e.containerId === 'metrology-unit->b')!;
    expect(label.text).toBe('VCC\nGND');
  });

  it('wraps a long name onto even lines, and keeps a short one on one line', async () => {
    expect(await text('system Metrology Pressure & Temperature Sensor @a', 'a')).toBe('Metrology Pressure &\nTemperature Sensor');
    expect(await text('system Application Unit @a', 'a')).toBe('Application Unit');
  });

  it('keeps a name with its own breaks as written, and does not wrap container titles', async () => {
    expect(await text('system A very long name that would wrap<br>here @a', 'a')).toBe('A very long name that would wrap\nhere');
    expect(await text(lines('boundary A very long boundary title that is not wrapped @a', '  system B'), 'a')).toBe('A very long boundary title that is not wrapped');
  });

  it('keeps a box sized from its label to 2:1', async () => {
    const e = find(await scene('system Metrology Pressure & Temperature Sensor @a'), 'a') as unknown as { width: number; height: number };
    expect(e.width / e.height).toBeLessThanOrEqual(2.01);
  });
});
