// Styling (docs/notation.md#styling): diagram options, `style` rules and attributes, merged in that
// order into one look per element and per edge, using Excalidraw's own property values.
import { Codes, type Diagnostic, error, type Range, warning } from './diagnostics.js';
import type { Attrs } from './parser.js';
import type { FontName } from './text.js';

export type FillStyle = 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
/** Kinds a look is worked out for: the element kinds, plus `edge`. */
export type StyledKind = 'system' | 'component' | 'actor' | 'datastore' | 'boundary' | 'group' | 'edge';

export interface Icon {
  /** A library item name, or a path to an image file. */
  value: string;
  range: Range;
}

/** Everything about how an element or an edge is drawn. Edges use only some of it. */
export interface Look {
  fill: string;
  fillStyle: FillStyle;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  rounded: boolean;
  opacity: number;
  font: FontName;
  fontSize: number;
  textColor: string;
  textAlign: TextAlign;
  icon?: Icon;
  iconOnly: boolean;
}

export interface Options {
  /** Roughness from `option sketch`. */
  roughness: number;
  font: FontName;
  colors: 'none' | 'types';
  /** From `option edges`: draw edges with the same ends and look as one arrow. */
  bundle: boolean;
}

export const DEFAULT_OPTIONS: Options = { roughness: 1, font: 'hand', colors: 'none', bundle: false };

export const INK = '#1e1e1e';
export const GREY = '#868e96';
export const NODE_FONT_SIZE = 20;
export const EDGE_FONT_SIZE = 16;

/**
 * Excalidraw's colour palette (open-color shades 0, 2, 4, 6 and 8, plus Radix bronze), as in its
 * colour picker. A named colour means the picker's default shade: the second for a fill, the
 * fifth for a stroke or text. `blue-1` to `blue-5` pick a shade, lightest first.
 */
export const PALETTE: Record<string, readonly string[]> = {
  gray: ['#f8f9fa', '#e9ecef', '#ced4da', '#868e96', '#343a40'],
  red: ['#fff5f5', '#ffc9c9', '#ff8787', '#fa5252', '#e03131'],
  pink: ['#fff0f6', '#fcc2d7', '#f783ac', '#e64980', '#c2255c'],
  grape: ['#f8f0fc', '#eebefa', '#da77f2', '#be4bdb', '#9c36b5'],
  violet: ['#f3f0ff', '#d0bfff', '#9775fa', '#7950f2', '#6741d9'],
  blue: ['#e7f5ff', '#a5d8ff', '#4dabf7', '#228be6', '#1971c2'],
  cyan: ['#e3fafc', '#99e9f2', '#3bc9db', '#15aabf', '#0c8599'],
  teal: ['#e6fcf5', '#96f2d7', '#38d9a9', '#12b886', '#099268'],
  green: ['#ebfbee', '#b2f2bb', '#69db7c', '#40c057', '#2f9e44'],
  yellow: ['#fff9db', '#ffec99', '#ffd43b', '#fab005', '#f08c00'],
  orange: ['#fff4e6', '#ffd8a8', '#ffa94d', '#fd7e14', '#e8590c'],
  bronze: ['#f8f1ee', '#eaddd7', '#d2bab0', '#a18072', '#846358'],
};
const ALIASES: Record<string, string> = { grey: 'gray', purple: 'violet' };

/** Fills for `option colors types`: a light shade for leaves, the lightest for containers. */
const TYPE_COLOURS: Partial<Record<StyledKind, string>> = { system: 'blue', component: 'green', datastore: 'yellow', actor: 'violet' };

export const SKETCH: Record<string, number> = { clean: 0, artist: 1, cartoon: 2 };
const STROKE_WIDTHS: Record<string, number> = { thin: 1, bold: 2, 'extra-bold': 4 };
const FONT_SIZES: Record<string, number> = { small: 16, medium: 20, large: 28, huge: 36 };
export const FONT_NAMES: readonly FontName[] = ['hand', 'normal', 'code'];

type Role = 'fill' | 'stroke';

/** A colour value: `#rgb`, `#rrggbb`, `#rrggbbaa`, `transparent`, a palette name or `name-N`. */
export function colour(value: string, role: Role): string | undefined {
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) {
    return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v;
  }
  if (v === 'transparent' || v === 'none') return 'transparent';
  if (v === 'black') return INK;
  if (v === 'white') return '#ffffff';
  const m = /^([a-z]+)(?:-([1-5]))?$/.exec(v);
  if (!m) return undefined;
  const shades = PALETTE[ALIASES[m[1]!] ?? m[1]!];
  if (!shades) return undefined;
  return shades[m[2] ? Number(m[2]) - 1 : role === 'fill' ? 1 : 4];
}

const COLOUR_HINT = `Use #rrggbb, transparent, black, white, or one of ${Object.keys(PALETTE).join(', ')} (optionally with a shade, such as blue-3).`;

type Parsed<T> = { value: T } | { problem: string; hint?: string };
const oneOf = <T extends string>(choices: readonly T[], v: string): Parsed<T> =>
  (choices as readonly string[]).includes(v) ? { value: v as T } : { problem: `is one of ${choices.join(', ')}` };
const number = (v: string, min: number, max: number): number | undefined => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** What each styling attribute sets, how its value is read, and whether edges take it. */
const ATTRS: Record<string, { edges: boolean; read: (v: string) => Parsed<Partial<Look>> }> = {
  fill: { edges: false, read: (v) => { const c = colour(v, 'fill'); return c ? { value: { fill: c } } : { problem: 'is not a colour', hint: COLOUR_HINT }; } },
  'fill-style': { edges: false, read: (v) => { const p = oneOf(['hachure', 'cross-hatch', 'solid', 'zigzag'] as const, v); return 'value' in p ? { value: { fillStyle: p.value } } : p; } },
  stroke: { edges: true, read: (v) => { const c = colour(v, 'stroke'); return c ? { value: { stroke: c } } : { problem: 'is not a colour', hint: COLOUR_HINT }; } },
  'stroke-width': {
    edges: true,
    read: (v) => {
      const n = STROKE_WIDTHS[v] ?? number(v, 0.5, 20);
      return n !== undefined ? { value: { strokeWidth: n } } : { problem: 'is thin, bold, extra-bold or a number of px from 0.5 to 20' };
    },
  },
  'stroke-style': { edges: true, read: (v) => { const p = oneOf(['solid', 'dashed', 'dotted'] as const, v); return 'value' in p ? { value: { strokeStyle: p.value } } : p; } },
  rough: {
    edges: true,
    read: (v) => {
      const n = SKETCH[v] ?? (['0', '1', '2'].includes(v) ? Number(v) : undefined);
      return n !== undefined ? { value: { roughness: n } } : { problem: 'is clean, artist or cartoon (or 0, 1 or 2)' };
    },
  },
  rounded: {
    edges: false,
    read: (v) => {
      if (['', 'yes', 'true', 'on'].includes(v)) return { value: { rounded: true } };
      if (['no', 'false', 'off'].includes(v)) return { value: { rounded: false } };
      return { problem: 'is a flag: write `rounded`, or `rounded: no` to turn it off' };
    },
  },
  opacity: {
    edges: false,
    read: (v) => {
      const n = number(v.replace(/%$/, ''), 0, 100);
      return n !== undefined ? { value: { opacity: Math.round(n) } } : { problem: 'is a number from 0 to 100' };
    },
  },
  font: { edges: true, read: (v) => { const p = oneOf(FONT_NAMES, v); return 'value' in p ? { value: { font: p.value } } : p; } },
  'font-size': {
    edges: true,
    read: (v) => {
      const n = FONT_SIZES[v] ?? number(v, 6, 200);
      return n !== undefined ? { value: { fontSize: n } } : { problem: 'is small, medium, large, huge or a number of px from 6 to 200' };
    },
  },
  'text-color': { edges: true, read: (v) => { const c = colour(v, 'stroke'); return c ? { value: { textColor: c } } : { problem: 'is not a colour', hint: COLOUR_HINT }; } },
  'text-align': { edges: false, read: (v) => { const p = oneOf(['left', 'center', 'right'] as const, v); return 'value' in p ? { value: { textAlign: p.value } } : p; } },
};

/** Attributes that are not styling but are allowed where noted. */
const OTHER_ATTRS = new Set(['doc', 'class', 'icon', 'icon-only']);
/** Attributes that take a list of values. */
const LISTS = new Set(['class']);

export const STYLE_ATTRS = new Set([...Object.keys(ATTRS), ...OTHER_ATTRS]);

/** Where a set of attributes is written: it decides which ones apply. */
export type AttrSite = 'element' | 'edge' | 'rule' | 'group';

/**
 * Reads styling attributes into a partial look, reporting values it cannot use and attributes
 * that do not apply where they are written.
 */
export function readAttrs(attrs: Attrs, site: AttrSite, range: Range, diagnostics: Diagnostic[]): Partial<Look> {
  const look: Partial<Look> = {};
  for (const [key, values] of attrs) {
    if (!STYLE_ATTRS.has(key)) {
      diagnostics.push(warning(Codes.unknownAttr, `\`${key}\` is not an attribute arch-text knows, so it is ignored.`, range, 'Check the spelling; see docs/notation.md for the attributes.'));
      continue;
    }
    const notHere = (where: string, hint?: string) => diagnostics.push(warning(Codes.notApplicable, `\`${key}\` does not apply to ${where}, so it is ignored.`, range, hint));
    if (site === 'group' && key !== 'doc' && key !== 'class') {
      notHere('a group, which is not drawn', 'Style the elements inside it instead.');
      continue;
    }
    if (site === 'edge' && (key === 'icon' || key === 'icon-only' || (ATTRS[key] && !ATTRS[key].edges))) {
      notHere('edges');
      continue;
    }
    if (site === 'rule' && (key === 'class' || key === 'doc')) {
      notHere('a style rule');
      continue;
    }
    if (values.length > 1 && !LISTS.has(key)) {
      diagnostics.push(warning(Codes.badValue, `\`${key}\` takes one value, so only the first, \`${values[0]}\`, is used.`, range, 'Quote a value that contains a comma.'));
    }
    const value = values[0] ?? '';
    if (key === 'icon') {
      if (!value) diagnostics.push(warning(Codes.badValue, '`icon` needs a library item name or an image path, so it is ignored.', range, 'For example: `[icon: chip]` or `[icon: ./icons/router.svg]`.'));
      else look.icon = { value, range };
      continue;
    }
    if (key === 'icon-only') {
      if (value) diagnostics.push(warning(Codes.badValue, '`icon-only` is a flag and takes no value.', range));
      look.iconOnly = true;
      continue;
    }
    if (OTHER_ATTRS.has(key)) continue;
    if (key !== 'rounded' && !value) {
      diagnostics.push(warning(Codes.badValue, `\`${key}\` needs a value, so it is ignored.`, range, `For example: \`[${key}: ${key.includes('color') || key === 'fill' || key === 'stroke' ? 'blue' : '...'}]\`.`));
      continue;
    }
    const read = ATTRS[key]!.read(value.toLowerCase());
    if ('value' in read) Object.assign(look, read.value);
    else diagnostics.push(warning(Codes.badValue, `\`${value}\` is not a value \`${key}\` takes: it ${read.problem}. It is ignored.`, range, read.hint));
  }
  return look;
}

/** The look before any rule or attribute: Excalidraw's defaults, the diagram options, and the kind. */
export function defaults(kind: StyledKind, container: boolean, options: Options): Look {
  const boundary = kind === 'boundary';
  const typeColour = options.colors === 'types' ? TYPE_COLOURS[kind] : undefined;
  return {
    fill: typeColour ? PALETTE[typeColour]![container ? 0 : 1]! : 'transparent',
    fillStyle: 'solid',
    stroke: boundary ? GREY : INK,
    strokeWidth: 2,
    strokeStyle: boundary ? 'dashed' : 'solid',
    roughness: options.roughness,
    rounded: kind === 'component',
    opacity: 100,
    font: options.font,
    fontSize: kind === 'edge' ? EDGE_FONT_SIZE : NODE_FONT_SIZE,
    textColor: boundary ? GREY : INK,
    textAlign: boundary ? 'left' : 'center',
    iconOnly: false,
  };
}

export interface StyleRule {
  /** An element kind, `edge`, or a class name with its dot. */
  selector: string;
  look: Partial<Look>;
}

const RULE_KINDS = new Set(['system', 'component', 'actor', 'datastore', 'boundary', 'edge']);

/** Checks a `style` rule's selector and reads its attributes. */
export function readRule(selector: string, attrs: Attrs, range: Range, diagnostics: Diagnostic[]): StyleRule | undefined {
  const s = selector.trim();
  if (!RULE_KINDS.has(s) && !/^\.[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) {
    diagnostics.push(
      error(
        Codes.badSelector,
        s === 'group' ? 'Groups cannot be styled, because they are not drawn.' : `\`${s}\` is not something a style rule can apply to.`,
        range,
        'Write `style <kind>` (system, component, actor, datastore, boundary or edge) or `style .<class>`.',
      ),
    );
    return undefined;
  }
  if (!attrs.size) diagnostics.push(warning(Codes.badValue, 'This style rule sets nothing.', range, `For example: \`style ${s} [fill: blue]\`.`));
  const look = readAttrs(attrs, 'rule', range, diagnostics);
  if (s === 'edge') {
    for (const key of [...attrs.keys()]) {
      if ((ATTRS[key] && !ATTRS[key].edges) || key === 'icon' || key === 'icon-only') {
        diagnostics.push(warning(Codes.notApplicable, `\`${key}\` does not apply to edges, so it is ignored.`, range));
      }
    }
  }
  return { selector: s, look };
}

/** Keeps only what an edge can use, so a class rule shared with elements does not leak shape properties. */
function forEdge(look: Partial<Look>): Partial<Look> {
  const out: Partial<Look> = {};
  for (const k of ['stroke', 'strokeWidth', 'strokeStyle', 'roughness', 'font', 'fontSize', 'textColor'] as const) {
    if (look[k] !== undefined) (out as Record<string, unknown>)[k] = look[k];
  }
  return out;
}

/**
 * The look of one element or edge. Later layers win: defaults (with the options), then rules for
 * its kind, then rules for its classes in source order, then its own attributes.
 */
export function lookFor(
  kind: StyledKind,
  container: boolean,
  classes: readonly string[],
  own: Partial<Look>,
  rules: readonly StyleRule[],
  options: Options,
  /** Defaults that depend on more than the kind, such as the dashes of `..>`. */
  base: Partial<Look> = {},
): Look {
  const layers: Partial<Look>[] = [base];
  for (const r of rules) if (r.selector === kind) layers.push(r.look);
  for (const r of rules) if (r.selector.startsWith('.') && classes.includes(r.selector.slice(1))) layers.push(r.look);
  layers.push(own);
  const look = defaults(kind, container, options);
  for (const layer of layers) Object.assign(look, kind === 'edge' ? forEdge(layer) : layer);
  return look;
}

/** The class names in a `class` attribute. */
export const classesOf = (attrs: Attrs): string[] => (attrs.get('class') ?? []).map((c) => c.trim().replace(/^\./, '')).filter(Boolean);

const RICH_TEXT = /\*\*[^*\n]+\*\*|(?:^|\s)_[^_\n]+_(?:\s|$)|(?:^|\s)\*[^*\n]+\*(?:\s|$)|<\/?(?:u|b|i|em|strong)>/i;

/** Warns about Markdown or HTML emphasis in a label, which Excalidraw would show as typed. */
export function checkLabel(text: string | undefined, range: Range, diagnostics: Diagnostic[]): void {
  if (text !== undefined && RICH_TEXT.test(text)) {
    diagnostics.push(
      warning(
        Codes.richText,
        'Labels are plain text, so this bold, italic or underline markup is drawn as typed.',
        range,
        'Excalidraw text has one font, size and colour per label: use `font`, `font-size` or `text-color` instead.',
      ),
    );
  }
}
