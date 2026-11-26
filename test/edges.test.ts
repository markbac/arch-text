import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import { parse } from '../src/parser.js';

type Arrow = { id: string; startArrowhead: string | null; endArrowhead: string | null; strokeStyle: string; strokeWidth: number; startBinding: { elementId: string }; endBinding: { elementId: string } };

async function arrowOf(op: string): Promise<Arrow> {
  const { scene, diagnostics } = await build(`system A\nsystem B\nA ${op} B`);
  expect(diagnostics).toEqual([]);
  const arrows = scene!.elements.filter((e) => e.type === 'arrow') as unknown as Arrow[];
  expect(arrows).toHaveLength(1);
  return arrows[0]!;
}

describe('edge operators: the body is the line, the ends are the arrowheads', () => {
  it.each([
    ['--', 'solid', 2, false, false],
    ['->', 'solid', 2, false, true],
    ['<->', 'solid', 2, true, true],
    ['..', 'dashed', 2, false, false],
    ['..>', 'dashed', 2, false, true],
    ['<..>', 'dashed', 2, true, true],
    ['==', 'solid', 4, false, false],
    ['==>', 'solid', 4, false, true],
    ['<==>', 'solid', 4, true, true],
    ['-->', 'solid', 2, false, true],
    ['---', 'solid', 2, false, false],
    ['<-->', 'solid', 2, true, true],
  ] as const)('`A %s B` is %s, %i px, head at start: %s, at end: %s', async (op, style, width, start, end) => {
    const a = await arrowOf(op);
    expect(a.strokeStyle).toBe(style);
    expect(a.strokeWidth).toBe(width);
    expect(a.startArrowhead !== null).toBe(start);
    expect(a.endArrowhead !== null).toBe(end);
    expect([a.startBinding.elementId, a.endBinding.elementId]).toEqual(['a', 'b']);
  });

  it.each([
    ['<-', 'solid', 2],
    ['<--', 'solid', 2],
    ['<..', 'dashed', 2],
    ['<==', 'solid', 4],
  ] as const)('`A %s B` is the edge from B to A, with its arrowhead at A', async (op, style, width) => {
    const a = await arrowOf(op);
    expect([a.startBinding.elementId, a.endBinding.elementId]).toEqual(['b', 'a']);
    expect(a.startArrowhead).toBeNull();
    expect(a.endArrowhead).not.toBeNull();
    expect(a.strokeStyle).toBe(style);
    expect(a.strokeWidth).toBe(width);
  });

  it('lets attributes and rules change the line an operator gives', async () => {
    const { scene } = await build('style edge [stroke-width: thin]\nsystem A\nsystem B\nsystem C\nA ==> B [stroke-style: dotted]\nB ..> C [stroke-style: solid]');
    const arrows = scene!.elements.filter((e) => e.type === 'arrow') as unknown as Arrow[];
    expect(arrows.map((a) => [a.strokeStyle, a.strokeWidth])).toEqual([['dotted', 1], ['solid', 1]]);
  });

  it('needs spaces round `..` and `==`, so names keep their dots and equals signs', () => {
    const { statements, diagnostics } = parse('system Loading...\nsystem v1..v2\nsystem a==b');
    expect(diagnostics).toEqual([]);
    expect(statements.map((s) => (s.kind === 'element' ? s.name : s.kind))).toEqual(['Loading...', 'v1..v2', 'a==b']);
  });

  it('chains mixed operators', async () => {
    const { scene } = await build('system A\nsystem B\nsystem C\nsystem D\nA ==> B .. C <- D');
    const arrows = scene!.elements.filter((e) => e.type === 'arrow') as unknown as Arrow[];
    expect(arrows.map((a) => `${a.startBinding.elementId}>${a.endBinding.elementId}`)).toEqual(['a>b', 'b>c', 'd>c']);
  });
});
