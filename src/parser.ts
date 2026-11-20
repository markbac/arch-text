// Parser for the arch-text notation (docs/notation.md). Line based: indentation opens a block,
// as in bpmn-text. Never throws on errors in the source; problems become diagnostics.
import { Codes, type Diagnostic, error, type Range } from './diagnostics.js';

export const ELEMENT_KINDS = ['system', 'component', 'actor', 'datastore', 'boundary'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
/** Kinds that may hold other elements. */
export const CONTAINER_KINDS: readonly string[] = ['system', 'component', 'boundary', 'group'];

export const EDGE_OPS = ['<->', '..>', '->', '--'] as const;
export type EdgeOp = (typeof EDGE_OPS)[number];

export interface Ref {
  /** Set for `@id` references. */
  id?: string;
  /** Set for name references. */
  name?: string;
  range: Range;
}

/** Attribute values by key. A flag has an empty list. */
export type Attrs = Map<string, string[]>;

export interface ElementStatement {
  kind: 'element';
  type: ElementKind | 'group';
  name?: string;
  id?: string;
  attrs: Attrs;
  children: Statement[];
  range: Range;
}

export interface EdgeStatement {
  kind: 'edge';
  /** The endpoints in order; a chain `A -> B -> C` has three. */
  refs: Ref[];
  /** The operator between each pair of endpoints. */
  ops: EdgeOp[];
  label?: string;
  attrs: Attrs;
  range: Range;
}

export type Statement =
  | ElementStatement
  | EdgeStatement
  | { kind: 'title'; value: string; range: Range }
  | { kind: 'option'; key: string; value: string; range: Range }
  | { kind: 'use'; what: string; path: string; range: Range }
  | { kind: 'style'; selector: string; attrs: Attrs; range: Range };

export interface ParseResult {
  statements: Statement[];
  diagnostics: Diagnostic[];
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*/;
const KEY_RE = /^([a-z][a-z-]*)\s*:/;

class ParseError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/** Calls `fn` for each character outside strings and `[...]`, with its index. Stops when `fn` returns true. */
function scanCode(text: string, fn: (i: number) => boolean | void): void {
  let inString = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && fn(i)) return;
  }
}

/** Removes a `#` comment: at line start or after whitespace, outside strings and `[...]`. */
function stripComment(text: string): string {
  let cut = text.length;
  scanCode(text, (i) => {
    if (text[i] === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) {
      cut = i;
      return true;
    }
  });
  return text.slice(0, cut);
}

/** Every edge operator outside strings and `[...]`, in order. */
function findEdgeOps(text: string): { index: number; op: EdgeOp }[] {
  const found: { index: number; op: EdgeOp }[] = [];
  let skipTo = -1;
  scanCode(text, (i) => {
    if (i < skipTo) return;
    const op = EDGE_OPS.find((o) => text.startsWith(o, i));
    if (op) {
      found.push({ index: i, op });
      skipTo = i + op.length;
    }
  });
  return found;
}

/** Reads one line left to right. `offset` is the column of `text[0]` minus one. */
class Line {
  pos = 0;
  constructor(
    readonly text: string,
    readonly line: number,
    readonly offset: number,
  ) {}

  range(start: number, end: number): Range {
    return { line: this.line, col: this.offset + start + 1, endCol: this.offset + Math.max(end, start + 1) + 1 };
  }
  fail(code: string, message: string, start: number, end: number, hint?: string): never {
    throw new ParseError(error(code, message, this.range(start, end), hint));
  }
  skipSpaces(): void {
    while (this.text[this.pos] === ' ') this.pos++;
  }
  atEnd(): boolean {
    this.skipSpaces();
    return this.pos >= this.text.length;
  }
  peek(s: string): boolean {
    this.skipSpaces();
    return this.text.startsWith(s, this.pos);
  }

  /** A `"..."` string at the current position, with `\"`, `\\` and `\n` escapes. */
  readString(): string {
    const start = this.pos;
    let out = '';
    this.pos++;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]!;
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (ch === '\\' && this.pos + 1 < this.text.length) {
        const next = this.text[this.pos + 1]!;
        out += next === 'n' ? '\n' : next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos++;
    }
    return this.fail(Codes.unterminatedString, 'This string has no closing quote.', start, this.text.length, 'Add a `"` at the end of the text.');
  }

  /** A quoted string, or bare text up to the first of `stops` outside strings (trimmed). */
  readText(stops: readonly string[]): { value: string; start: number; end: number } | undefined {
    this.skipSpaces();
    const start = this.pos;
    if (this.text[this.pos] === '"') {
      const value = this.readString();
      return { value, start, end: this.pos };
    }
    let end = this.text.length;
    for (const stop of stops) {
      const i = this.text.indexOf(stop, this.pos);
      if (i !== -1 && i < end) end = i;
    }
    const value = this.text.slice(this.pos, end).trim();
    this.pos = end;
    return value ? { value, start, end: start + value.length } : undefined;
  }

  /** An `@id` at the current position. */
  readId(): string {
    this.skipSpaces();
    const start = this.pos;
    const m = ID_RE.exec(this.text.slice(this.pos + 1));
    if (!m) this.fail(Codes.missingName, 'Expected an ID after `@`.', start, start + 1, 'IDs start with a letter or `_`, for example `@hes`.');
    this.pos += 1 + m[0].length;
    return m[0];
  }

  /** `[key: value, flag, ...]` if the line continues with one; otherwise an empty map. */
  readAttrs(): Attrs {
    const attrs: Attrs = new Map();
    if (!this.peek('[')) return attrs;
    const open = this.pos;
    let close = -1;
    let inString = false;
    for (let i = open + 1; i < this.text.length; i++) {
      const ch = this.text[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === ']') {
        close = i;
        break;
      }
    }
    if (close === -1) this.fail(Codes.unclosedAttrs, 'This attribute list has no closing `]`.', open, this.text.length, 'Add a `]` at the end.');
    // Split on commas outside strings.
    const items: string[] = [];
    let cur = '';
    inString = false;
    for (let i = open + 1; i < close; i++) {
      const ch = this.text[i]!;
      if (inString && ch === '\\') {
        cur += ch + (this.text[++i] ?? '');
        continue;
      }
      if (ch === '"') inString = !inString;
      if (ch === ',' && !inString) {
        items.push(cur);
        cur = '';
      } else cur += ch;
    }
    items.push(cur);
    let lastKey: string | undefined;
    const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? JSON.parse(v.replace(/\n/g, '\\n')) as string : v);
    for (const raw of items) {
      const item = raw.trim();
      if (!item) continue;
      const key = KEY_RE.exec(item);
      if (key) {
        lastKey = key[1]!;
        attrs.set(lastKey, [unquote(item.slice(key[0].length).trim())]);
      } else if (/^[a-z][a-z-]*$/.test(item) && (FLAGS.has(item) || !lastKey)) {
        attrs.set(item, []);
        lastKey = undefined;
      } else if (lastKey) {
        attrs.get(lastKey)!.push(unquote(item));
      } else {
        attrs.set(item, []);
      }
    }
    this.pos = close + 1;
    return attrs;
  }

  expectEnd(): void {
    if (!this.atEnd()) {
      this.fail(Codes.trailingText, 'Unexpected text after the end of the statement.', this.pos, this.text.length, 'Remove it, or quote the name if it is part of it.');
    }
  }
}

/** Attribute names that take no value. */
const FLAGS = new Set(['icon-only', 'rounded']);

function readRef(l: Line, stops: readonly string[]): Ref | undefined {
  l.skipSpaces();
  const start = l.pos;
  if (l.text[l.pos] === '@') {
    const id = l.readId();
    return { id, range: l.range(start, l.pos) };
  }
  const t = l.readText(stops);
  return t && { name: t.value, range: l.range(t.start, t.end) };
}

function parseEdge(l: Line, ops: { index: number; op: EdgeOp }[]): EdgeStatement {
  const whole = l.range(0, l.text.length);
  const refs: Ref[] = [];
  ops.forEach(({ index, op }, k) => {
    const segStart = k === 0 ? 0 : ops[k - 1]!.index + ops[k - 1]!.op.length;
    const seg = new Line(l.text.slice(segStart, index), l.line, l.offset + segStart);
    const ref = readRef(seg, []);
    if (!ref) l.fail(Codes.missingName, `There is nothing before \`${op}\`.`, segStart, index + op.length, 'Write edges as `A -> B`.');
    seg.expectEnd();
    refs.push(ref);
  });
  const last = ops[ops.length - 1]!;
  l.pos = last.index + last.op.length;
  const to = readRef(l, [':', '[']);
  if (!to) l.fail(Codes.missingName, `There is nothing after \`${last.op}\`.`, last.index, l.text.length, 'Write edges as `A -> B`.');
  refs.push(to);
  let label: string | undefined;
  const labelStart = l.pos;
  if (l.peek(':')) {
    l.pos++;
    label = l.readText(['['])?.value;
    if (label !== undefined && ops.length > 1) {
      l.fail(Codes.chainLabel, 'A chain of edges cannot have a label.', labelStart, l.pos, 'Write each labelled edge on its own line.');
    }
  }
  const attrs = l.readAttrs();
  l.expectEnd();
  return { kind: 'edge', refs, ops: ops.map((o) => o.op), ...(label !== undefined ? { label } : {}), attrs, range: whole };
}

/** Parses one line's statement (without its block). */
function parseLine(l: Line): Statement {
  const word = /^[a-z]+/.exec(l.text)?.[0] ?? '';
  const keyword = word && (l.text.length === word.length || l.text[word.length] === ' ') ? word : '';
  const whole = l.range(0, l.text.length);
  const nameStops = ['@', '[', ...EDGE_OPS];

  if ((ELEMENT_KINDS as readonly string[]).includes(keyword) || keyword === 'group') {
    l.pos = word.length;
    const name = l.readText(nameStops);
    if (!name && keyword !== 'group') l.fail(Codes.missingName, `\`${keyword}\` needs a name.`, 0, l.text.length, `For example: \`${keyword} Platform\`.`);
    const id = l.peek('@') ? l.readId() : undefined;
    const attrs = l.readAttrs();
    l.expectEnd();
    return {
      kind: 'element',
      type: keyword as ElementKind | 'group',
      ...(name ? { name: name.value } : {}),
      ...(id ? { id } : {}),
      attrs,
      children: [],
      range: whole,
    };
  }

  if (keyword === 'title') {
    l.pos = word.length;
    const t = l.readText([]);
    if (!t) l.fail(Codes.missingName, '`title` needs a name.', 0, l.text.length, 'For example: `title "Smart metering"`.');
    l.expectEnd();
    return { kind: 'title', value: t.value, range: whole };
  }

  if (keyword === 'option') {
    l.pos = word.length;
    const key = l.readText([' ']);
    const value = l.readText([' ']);
    if (!key || !value) l.fail(Codes.missingName, '`option` needs a name and a value.', 0, l.text.length, 'For example: `option direction down`.');
    l.expectEnd();
    return { kind: 'option', key: key.value, value: value.value, range: whole };
  }

  if (keyword === 'use') {
    l.pos = word.length;
    const what = l.readText([' ']);
    const path = l.readText([]);
    if (!what || !path) l.fail(Codes.missingName, '`use` needs what to use and a path.', 0, l.text.length, 'For example: `use icons ./icons.excalidrawlib`.');
    return { kind: 'use', what: what.value, path: path.value, range: whole };
  }

  if (keyword === 'style') {
    l.pos = word.length;
    const selector = l.readText(['[']);
    if (!selector) l.fail(Codes.missingName, '`style` needs a type or `.class`.', 0, l.text.length, 'For example: `style system [fill: blue]`.');
    const attrs = l.readAttrs();
    l.expectEnd();
    return { kind: 'style', selector: selector.value, attrs, range: whole };
  }

  const ops = findEdgeOps(l.text);
  if (ops.length) return parseEdge(l, ops);

  return l.fail(
    Codes.unknownStatement,
    'This is not a statement.',
    0,
    l.text.length,
    'Statements start with an element kind (system, component, actor, datastore, boundary, group), title, option, use or style, or are edges such as `A -> B: label`.',
  );
}

export function parse(source: string): ParseResult {
  const statements: Statement[] = [];
  const diagnostics: Diagnostic[] = [];
  // Open blocks, innermost last: the indentation of their lines and where their statements go.
  const stack: { indent: number; into: Statement[]; owner?: ElementStatement }[] = [{ indent: 0, into: statements }];
  // The previous statement and its indentation, which an indented line may belong to.
  let prev: { st: Statement; indent: number } | undefined;
  let skipDeeperThan: number | undefined;

  source.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const indentText = /^[ \t]*/.exec(raw)![0];
    const text = stripComment(raw.slice(indentText.length)).trimEnd();
    if (!text) return;
    const indentRange = { line: lineNo, col: 1, endCol: indentText.length + 1 };
    if (indentText.includes('\t')) {
      diagnostics.push(error(Codes.tab, 'Indentation uses a tab.', indentRange, 'Use spaces for indentation.'));
      return;
    }
    const indent = indentText.length;
    // Lines under a statement that was rejected for having a block are skipped quietly.
    if (skipDeeperThan !== undefined && indent > skipDeeperThan) return;
    skipDeeperThan = undefined;

    const top = stack[stack.length - 1]!;
    if (indent > top.indent && !(prev && indent > prev.indent && prev.indent === top.indent)) {
      diagnostics.push(error(Codes.indent, 'Unexpected indentation.', indentRange, 'Indent only the lines inside a block, under the element that holds them.'));
      return;
    }
    if (indent > top.indent && prev) {
      // A new block under the previous statement.
      const owner = prev.st;
      if (owner.kind !== 'element' || !CONTAINER_KINDS.includes(owner.type)) {
        const what = owner.kind === 'element' ? `\`${owner.type}\`` : 'This statement';
        diagnostics.push(
          error(
            owner.kind === 'element' ? Codes.noChildren : Codes.indent,
            owner.kind === 'element' ? `${what} cannot contain other elements.` : 'Unexpected indentation.',
            indentRange,
            'Only boundary, system, component and group can contain elements.',
          ),
        );
        skipDeeperThan = prev.indent;
        return;
      }
      stack.push({ indent, into: owner.children, owner });
    } else {
      while (stack.length > 1 && indent < stack[stack.length - 1]!.indent) stack.pop();
      if (indent !== stack[stack.length - 1]!.indent) {
        diagnostics.push(error(Codes.dedent, 'This indentation does not match any enclosing block.', indentRange, 'Line it up with the block it belongs to.'));
        return;
      }
    }

    const block = stack[stack.length - 1]!;
    let st: Statement;
    try {
      st = parseLine(new Line(text, lineNo, indent));
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      diagnostics.push(e.diagnostic);
      prev = undefined;
      skipDeeperThan = indent;
      return;
    }
    if ((st.kind === 'title' || st.kind === 'option' || st.kind === 'use' || st.kind === 'style') && block.owner) {
      diagnostics.push(error(Codes.notTopLevel, `\`${st.kind}\` must be at the top level, not inside a block.`, st.range, 'Move it to the left margin.'));
      return;
    }
    block.into.push(st);
    prev = { st, indent };
  });

  // Groups exist only to hold things.
  const checkGroups = (list: Statement[]) => {
    for (const st of list) {
      if (st.kind !== 'element') continue;
      if (st.type === 'group' && !st.children.some((c) => c.kind === 'element')) {
        diagnostics.push(error(Codes.emptyGroup, 'This group holds no elements.', st.range, 'Indent the elements it groups under it.'));
      }
      checkGroups(st.children);
    }
  };
  checkGroups(statements);
  return { statements, diagnostics };
}

