// Parser for the phase 2 subset of the notation: `title`, `system` and `->` edges.
// Other keywords and edge kinds are recognised and reported as not supported yet (AT004).
import { Codes, type Diagnostic, error, type Range } from './diagnostics.js';

export interface Ref {
  /** Set for `@id` references. */
  id?: string;
  /** Set for name references. */
  name?: string;
  range: Range;
}

export type Statement =
  | { kind: 'title'; value: string; range: Range }
  | { kind: 'system'; name: string; id?: string; range: Range }
  | { kind: 'edge'; from: Ref; to: Ref; label?: string; range: Range };

export interface ParseResult {
  statements: Statement[];
  diagnostics: Diagnostic[];
}

/** Keywords from the full notation that later phases add. */
const LATER_KEYWORDS = ['component', 'actor', 'datastore', 'boundary', 'group', 'style', 'use', 'option'];
/** Edge operators, longest first so `<->` is not read as `->`. */
const EDGE_OPS = ['<->', '..>', '->', '--'] as const;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*/;

class ParseError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
  }
}

/** Reads one line left to right. Columns are 1-based. */
class Line {
  pos = 0;
  constructor(
    readonly text: string,
    readonly line: number,
  ) {}

  range(start: number, end: number): Range {
    return { line: this.line, col: start + 1, endCol: Math.max(end, start + 1) + 1 };
  }
  skipSpaces(): void {
    while (this.text[this.pos] === ' ') this.pos++;
  }
  atEnd(): boolean {
    this.skipSpaces();
    return this.pos >= this.text.length;
  }
  startsWith(s: string): boolean {
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
    throw new ParseError(
      error(Codes.unterminatedString, 'This string has no closing quote.', this.range(start, this.text.length), 'Add a `"` at the end of the text.'),
    );
  }

  /** A quoted string, or bare text up to the first of `stops` (trimmed). */
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
  readId(): { value: string; start: number; end: number } {
    const start = this.pos;
    const m = ID_RE.exec(this.text.slice(this.pos + 1));
    if (!m) {
      throw new ParseError(
        error(Codes.missingName, 'Expected an ID after `@`.', this.range(start, start + 1), 'IDs start with a letter or `_`, for example `@hes`.'),
      );
    }
    this.pos += 1 + m[0].length;
    return { value: m[0], start, end: this.pos };
  }
}

/** Removes a `#` comment: at line start or after whitespace, and outside strings. */
function stripComment(text: string): string {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString && ch === '\\') i++;
    else if (ch === '"') inString = !inString;
    else if (ch === '#' && !inString && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) return text.slice(0, i);
  }
  return text;
}

/** Index of the first edge operator outside strings, with which operator it is. */
function findEdgeOp(text: string): { index: number; op: (typeof EDGE_OPS)[number] } | undefined {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString && ch === '\\') i++;
    else if (ch === '"') inString = !inString;
    else if (!inString) {
      const op = EDGE_OPS.find((o) => text.startsWith(o, i));
      if (op) return { index: i, op };
    }
  }
  return undefined;
}

function expectEnd(l: Line): void {
  if (!l.atEnd()) {
    throw new ParseError(
      error(Codes.trailingText, 'Unexpected text after the end of the statement.', l.range(l.pos, l.text.length), 'Remove it, or quote the name if it is part of it.'),
    );
  }
}

function readRef(l: Line, stops: readonly string[]): Ref | undefined {
  l.skipSpaces();
  if (l.startsWith('@')) {
    const id = l.readId();
    return { id: id.value, range: l.range(id.start, id.end) };
  }
  const t = l.readText(stops);
  return t && { name: t.value, range: l.range(t.start, t.end) };
}

function parseLine(l: Line): Statement | undefined {
  const word = /^[a-z]+/.exec(l.text)?.[0] ?? '';
  const keyword = word && (l.text.length === word.length || l.text[word.length] === ' ') ? word : '';
  const whole = l.range(0, l.text.length);

  if (keyword === 'title') {
    l.pos = word.length;
    const t = l.readText([]);
    if (!t) throw new ParseError(error(Codes.missingName, '`title` needs a name.', whole, 'For example: `title "Smart metering"`.'));
    expectEnd(l);
    return { kind: 'title', value: t.value, range: whole };
  }

  if (keyword === 'system') {
    l.pos = word.length;
    const name = l.readText(['@', ...EDGE_OPS]);
    if (!name) throw new ParseError(error(Codes.missingName, '`system` needs a name.', whole, 'For example: `system Platform`.'));
    let id: string | undefined;
    l.skipSpaces();
    if (l.startsWith('@')) id = l.readId().value;
    expectEnd(l);
    return { kind: 'system', name: name.value, ...(id ? { id } : {}), range: whole };
  }

  if (keyword && LATER_KEYWORDS.includes(keyword)) {
    throw new ParseError(
      error(Codes.notYet, `\`${keyword}\` is not supported yet.`, l.range(0, keyword.length), 'This version supports `title`, `system` and `->` edges.'),
    );
  }

  const edge = findEdgeOp(l.text);
  if (edge) {
    if (edge.op !== '->') {
      throw new ParseError(
        error(Codes.notYet, `\`${edge.op}\` edges are not supported yet.`, l.range(edge.index, edge.index + edge.op.length), 'Use `->` for now.'),
      );
    }
    const left = new Line(l.text.slice(0, edge.index), l.line);
    const from = readRef(left, []);
    if (!from) throw new ParseError(error(Codes.missingName, 'The edge has no source.', l.range(0, edge.index + 2), 'Write it as `A -> B`.'));
    expectEnd(left);
    l.pos = edge.index + edge.op.length;
    const to = readRef(l, [':']);
    if (!to) throw new ParseError(error(Codes.missingName, 'The edge has no target.', l.range(edge.index, l.text.length), 'Write it as `A -> B`.'));
    let label: string | undefined;
    l.skipSpaces();
    if (l.startsWith(':')) {
      l.pos++;
      label = l.readText([])?.value;
    }
    expectEnd(l);
    return { kind: 'edge', from, to, ...(label ? { label } : {}), range: whole };
  }

  throw new ParseError(
    error(Codes.unknownStatement, 'This is not a statement.', whole, 'Statements start with `title` or `system`, or are edges such as `A -> B: label`.'),
  );
}

export function parse(source: string): ParseResult {
  const statements: Statement[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const indent = /^[ \t]*/.exec(raw)![0];
    const text = stripComment(raw.slice(indent.length)).trimEnd();
    if (!text) return;
    if (indent.includes('\t')) {
      diagnostics.push(error(Codes.tab, 'Indentation uses a tab.', { line: lineNo, col: 1, endCol: indent.length + 1 }, 'Use spaces for indentation.'));
      return;
    }
    if (indent.length > 0) {
      diagnostics.push(
        error(Codes.indent, 'Indented blocks are not supported yet.', { line: lineNo, col: 1, endCol: indent.length + 1 }, 'Start the line at the left margin.'),
      );
      return;
    }
    try {
      const st = parseLine(new Line(text, lineNo));
      if (st) statements.push(st);
    } catch (e) {
      if (e instanceof ParseError) diagnostics.push(e.diagnostic);
      else throw e;
    }
  });
  return { statements, diagnostics };
}
