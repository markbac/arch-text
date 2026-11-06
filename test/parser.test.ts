import { describe, expect, it } from 'vitest';
import { build } from '../src/build.js';
import { resolve } from '../src/model.js';
import { type ElementStatement, parse, type Statement } from '../src/parser.js';

/** The diagnostics for `source`, as `code line:col-endCol` strings. */
async function codes(source: string): Promise<string[]> {
  const { diagnostics } = await build(source);
  return diagnostics.map((d) => `${d.code} ${d.range.line}:${d.range.col}-${d.range.endCol}`);
}

/** The model for `source`, which must have no errors. */
function model(source: string) {
  const parsed = parse(source);
  const resolved = resolve(parsed.statements);
  expect([...parsed.diagnostics, ...resolved.diagnostics].filter((d) => d.severity === 'error')).toEqual([]);
  return resolved.model;
}

const lines = (...l: string[]) => l.join('\n');
const strip = (st: Statement): unknown => {
  const { range: _r, ...rest } = st as Statement & { children?: Statement[]; attrs?: Map<string, string[]> };
  return {
    ...rest,
    ...('attrs' in rest && rest.attrs ? { attrs: Object.fromEntries(rest.attrs) } : {}),
    ...('children' in rest && rest.children ? { children: rest.children.map(strip) } : {}),
    ...('refs' in rest ? { refs: (rest as { refs: { range: unknown }[] }).refs.map(({ range: _x, ...r }) => r) } : {}),
  };
};

describe('parser', () => {
  it('reads every element kind, with names, IDs and attributes', () => {
    const { statements, diagnostics } = parse(
      lines('system Head-End System @hes', 'component "Odd -> name"', 'actor Operator [doc: "Runs the platform"]', 'datastore Readings', 'boundary Meter', 'group'),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(['AT016']);
    expect(statements.map(strip)).toEqual([
      { kind: 'element', type: 'system', name: 'Head-End System', id: 'hes', attrs: {}, children: [] },
      { kind: 'element', type: 'component', name: 'Odd -> name', attrs: {}, children: [] },
      { kind: 'element', type: 'actor', name: 'Operator', attrs: { doc: ['Runs the platform'] }, children: [] },
      { kind: 'element', type: 'datastore', name: 'Readings', attrs: {}, children: [] },
      { kind: 'element', type: 'boundary', name: 'Meter', attrs: {}, children: [] },
      { kind: 'element', type: 'group', attrs: {}, children: [] },
    ]);
  });

  it('nests blocks to any depth, and returns to outer blocks', () => {
    const { statements, diagnostics } = parse(lines('boundary A', '  boundary B', '    system C', '  system D', 'system E'));
    expect(diagnostics).toEqual([]);
    const a = statements[0] as ElementStatement;
    expect(a.children.map((c) => (c as ElementStatement).name)).toEqual(['B', 'D']);
    expect(((a.children[0] as ElementStatement).children[0] as ElementStatement).name).toBe('C');
    expect((statements[1] as ElementStatement).name).toBe('E');
  });

  it('reads every edge kind, chains, labels and edge attributes', () => {
    const { statements, diagnostics } = parse(lines('A -> B: calls', 'A <-> B', 'A -- B [doc: x]', 'A ..> B: async', 'A -> B ..> @c'));
    expect(diagnostics).toEqual([]);
    expect(statements.map(strip)).toEqual([
      { kind: 'edge', refs: [{ name: 'A' }, { name: 'B' }], ops: ['->'], label: 'calls', attrs: {} },
      { kind: 'edge', refs: [{ name: 'A' }, { name: 'B' }], ops: ['<->'], attrs: {} },
      { kind: 'edge', refs: [{ name: 'A' }, { name: 'B' }], ops: ['--'], attrs: { doc: ['x'] } },
      { kind: 'edge', refs: [{ name: 'A' }, { name: 'B' }], ops: ['..>'], label: 'async', attrs: {} },
      { kind: 'edge', refs: [{ name: 'A' }, { name: 'B' }, { id: 'c' }], ops: ['->', '..>'], attrs: {} },
    ]);
  });

  it('reads attribute flags, several values, quoted values and colours with #', () => {
    const { statements } = parse('system A [icon-only, class: a, b, fill: #1F4E79, doc: "x, y"] # comment');
    expect(Object.fromEntries((statements[0] as ElementStatement).attrs)).toEqual({ 'icon-only': [], class: ['a', 'b'], fill: ['#1F4E79'], doc: ['x, y'] });
  });

  it('reads title, option, use and style', () => {
    const { statements } = parse(lines('title "Smart metering"', 'option direction down', 'use icons ./icons/iot.excalidrawlib', 'style .external [fill: orange]'));
    expect(statements.map(strip)).toEqual([
      { kind: 'title', value: 'Smart metering' },
      { kind: 'option', key: 'direction', value: 'down' },
      { kind: 'use', what: 'icons', path: './icons/iot.excalidrawlib' },
      { kind: 'style', selector: '.external', attrs: { fill: ['orange'] } },
    ]);
  });

  it('ignores comments and blank lines, but not # inside strings or names', () => {
    const { statements, diagnostics } = parse('# a comment\n\nsystem "A #1" # trailing\nsystem C#\n');
    expect(diagnostics).toEqual([]);
    expect(statements.map((s) => (s as ElementStatement).name)).toEqual(['A #1', 'C#']);
  });

  it('handles escapes in strings', () => {
    expect(parse('system "Line one\\nLine \\"two\\""').statements[0]).toMatchObject({ name: 'Line one\nLine "two"' });
  });

  it('accepts Windows line endings', async () => {
    expect(await codes('system A\r\nsystem B\r\nA -> B\r\n')).toEqual([]);
  });
});

describe('model', () => {
  it('gives every element a parent and its children, in document order', () => {
    const m = model(lines('boundary A', '  system B', '  group', '    system C'));
    expect(m.nodes.map((n) => [n.id, n.parent ?? null, n.children])).toEqual([
      ['a', null, ['b', 'group']],
      ['b', 'a', []],
      ['group', 'a', ['c']],
      ['c', 'group', []],
    ]);
  });

  it('resolves a name in its own block first, then the blocks around it', () => {
    const m = model(lines('boundary One', '  system Gateway', '  system Logger', '  Gateway -> Logger', 'boundary Two', '  system Gateway', '  system Logger', '  Gateway -> Logger'));
    expect(m.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['gateway->logger', 'gateway-2->logger-2']);
  });

  it('resolves a name from an enclosing block when the own block has none', () => {
    const m = model(lines('system Cloud', 'boundary Site', '  system Gateway', '  Gateway -> Cloud'));
    expect(m.edges[0]).toMatchObject({ from: 'gateway', to: 'cloud' });
  });

  it('matches names ignoring case and repeated spaces', () => {
    const m = model(lines('system Head  End', 'system Platform', 'head end -> PLATFORM'));
    expect(m.edges[0]).toMatchObject({ from: 'head-end', to: 'platform' });
  });

  it('allows edges to and from containers', () => {
    const m = model(lines('actor Engineer', 'boundary Meter', '  system Firmware', 'Engineer -> Meter'));
    expect(m.edges[0]).toMatchObject({ from: 'engineer', to: 'meter' });
  });

  it('makes one edge per step of a chain, each with its own operator', () => {
    const m = model(lines('system A', 'system B', 'system C', 'A -> B ..> C'));
    expect(m.edges.map((e) => [e.id, e.op])).toEqual([
      ['a->b', '->'],
      ['b->c', '..>'],
    ]);
  });

  it('sets the layout direction', () => {
    expect(model('option direction down').direction).toBe('DOWN');
    expect(model('system A').direction).toBe('RIGHT');
  });
});

describe('diagnostics', () => {
  it.each([
    ['AT001: tab in indentation', '\tsystem A', ['AT001 1:1-2']],
    ['AT002: indented with no block to belong to', '  system A', ['AT002 1:1-3']],
    ['AT002: indented under an edge', 'system A\nsystem B\nA -> B\n  system C', ['AT002 4:1-3']],
    ['AT003: element without a name', 'system', ['AT003 1:1-7']],
    ['AT003: @ without an ID', 'system A @', ['AT003 1:10-11']],
    ['AT003: edge without a target', 'system A\nA ->', ['AT003 2:3-5']],
    ['AT004: styling attribute (warning)', 'system A [fill: blue]', ['AT004 1:1-22']],
    ['AT004: later option (warning)', 'option sketch clean', ['AT004 1:1-20']],
    ['AT004: use icons (warning)', 'use icons ./x.excalidrawlib', ['AT004 1:1-28']],
    ['AT004: style (warning)', 'style system [fill: blue]', ['AT004 1:1-26']],
    ['AT005: not a statement', 'hello', ['AT005 1:1-6']],
    ['AT006: unterminated string', 'system "A', ['AT006 1:8-10']],
    ['AT007: duplicate ID', 'system A @x\nsystem B @x', ['AT007 2:1-12']],
    ['AT008: unknown reference', 'system A\nA -> B', ['AT008 2:6-7']],
    ['AT009: ambiguous reference', 'system A\nsystem A\nsystem B\nB -> A', ['AT009 4:6-7']],
    ['AT010: edge to itself (warning)', 'system A\nA -> A', ['AT010 2:1-7']],
    ['AT011: text after a statement', 'system A @a extra', ['AT011 1:13-18']],
    ['AT012: children under an actor', 'actor A\n  system B', ['AT012 2:1-3']],
    ['AT013: unknown attribute (warning)', 'system A [colour: red]', ['AT013 1:1-23']],
    ['AT014: indentation matching no block', 'boundary A\n    system B\n  system C', ['AT014 3:1-3']],
    ['AT015: labelled chain', 'system A\nsystem B\nsystem C\nA -> B -> C: x', ['AT015 4:12-15']],
    ['AT016: empty group', 'group', ['AT016 1:1-6']],
    ['AT017: edge to a group', 'group G\n  system A\nsystem B\nB -> G', ['AT017 4:6-7']],
    ['AT018: edge into its own container (warning)', 'boundary A\n  system B\nA -> B', ['AT018 3:1-7']],
    ['AT019: unknown option', 'option colour red', ['AT019 1:1-18']],
    ['AT019: bad direction', 'option direction up', ['AT019 1:1-20']],
    ['AT020: directive inside a block', 'boundary A\n  title "x"', ['AT020 2:3-12']],
    ['AT021: unclosed attribute list', 'system A [doc: x', ['AT021 1:10-17']],
  ])('%s', async (_name, source, expected) => {
    expect(await codes(source)).toEqual(expected);
  });

  it('suggests the closest name for an unknown reference', async () => {
    const { diagnostics } = await build('system Platform\nsystem HES\nHES -> Platfrom');
    expect(diagnostics[0]?.hint).toBe('Did you mean "Platform"?');
  });

  it('skips the lines under a statement with an error', async () => {
    expect(await codes(lines('actor A', '  system B', '    system C', 'system D'))).toEqual(['AT012 2:1-3']);
  });

  it('reports every error in a file, in line order', async () => {
    expect(await codes('system A\nA -> B\n\tsystem C\nhello')).toEqual(['AT008 2:6-7', 'AT001 3:1-2', 'AT005 4:1-6']);
  });

  it('produces no scene when there are errors, and a scene despite warnings', async () => {
    expect((await build('system A\nA -> B')).scene).toBeUndefined();
    expect((await build('system A [fill: red]\nA -> A')).scene).toBeDefined();
  });
});
