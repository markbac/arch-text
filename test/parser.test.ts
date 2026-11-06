import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import { parse } from '../src/parser.js';

/** The diagnostics for `source`, as `code line:col-endCol` strings. */
async function codes(source: string): Promise<string[]> {
  const { diagnostics } = await build(source);
  return diagnostics.map((d) => `${d.code} ${d.range.line}:${d.range.col}-${d.range.endCol}`);
}

describe('parser', () => {
  it('reads titles, systems, IDs, edges and labels', () => {
    const { statements, diagnostics } = parse(
      ['title "Smart metering"', 'system Head-End System @hes', 'system "Odd -> name"', '@hes -> "Odd -> name": DLMS/COSEM'].join('\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(statements.map(({ range: _r, ...s }) => s)).toEqual([
      { kind: 'title', value: 'Smart metering' },
      { kind: 'system', name: 'Head-End System', id: 'hes' },
      { kind: 'system', name: 'Odd -> name' },
      { kind: 'edge', from: { id: 'hes', range: expect.anything() }, to: { name: 'Odd -> name', range: expect.anything() }, label: 'DLMS/COSEM' },
    ]);
  });

  it('ignores comments and blank lines, but not # inside strings or names', () => {
    const { statements, diagnostics } = parse('# a comment\n\nsystem "A #1" # trailing\nsystem C#\n');
    expect(diagnostics).toEqual([]);
    expect(statements.map((s) => (s.kind === 'system' ? s.name : ''))).toEqual(['A #1', 'C#']);
  });

  it('handles escapes in strings', () => {
    const { statements } = parse('system "Line one\\nLine \\"two\\""');
    expect(statements[0]).toMatchObject({ name: 'Line one\nLine "two"' });
  });

  it('accepts Windows line endings', async () => {
    expect(await codes('system A\r\nsystem B\r\nA -> B\r\n')).toEqual([]);
  });
});

describe('diagnostics', () => {
  it.each([
    ['AT001: tab in indentation', '\tsystem A', 'AT001 1:1-2'],
    ['AT002: indented line', '  system A', 'AT002 1:1-3'],
    ['AT003: system without a name', 'system', 'AT003 1:1-7'],
    ['AT003: title without a name', 'title', 'AT003 1:1-6'],
    ['AT003: @ without an ID', 'system A @', 'AT003 1:10-11'],
    ['AT004: keyword from a later phase', 'component A', 'AT004 1:1-10'],
    ['AT004: edge kind from a later phase', 'system A\nsystem B\nA ..> B', 'AT004 3:3-6'],
    ['AT005: not a statement', 'hello', 'AT005 1:1-6'],
    ['AT006: unterminated string', 'system "A', 'AT006 1:8-10'],
    ['AT007: duplicate ID', 'system A @x\nsystem B @x', 'AT007 2:1-12'],
    ['AT008: unknown reference', 'system A\nA -> B', 'AT008 2:6-7'],
    ['AT009: ambiguous reference', 'system A\nsystem A\nsystem B\nA -> B', 'AT009 4:1-2'],
    ['AT010: edge to itself', 'system A\nA -> A', 'AT010 2:1-7'],
    ['AT011: text after a statement', 'system A @a extra', 'AT011 1:13-18'],
  ])('%s', async (_name, source, expected) => {
    expect(await codes(source)).toEqual([expected]);
  });

  it('suggests the closest name for an unknown reference', async () => {
    const { diagnostics } = await build('system Platform\nsystem HES\nHES -> Platfrom');
    expect(diagnostics[0]?.hint).toBe('Did you mean "Platform"?');
  });

  it('reports every error in a file, in line order', async () => {
    expect(await codes('system A\nA -> B\n\tsystem C\nactor D')).toEqual(['AT008 2:6-7', 'AT001 3:1-2', 'AT004 4:1-6']);
  });

  it('produces no scene when there are errors, and a scene despite warnings', async () => {
    expect((await build('system A\nA -> B')).scene).toBeUndefined();
    expect((await build('system A\nA -> A')).scene).toBeDefined();
  });
});
