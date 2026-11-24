// Icons (docs/notation.md#icons): items from Excalidraw libraries named by `use icons`, and image
// files. This module finds and reads them; layout sizes them and the emitter places copies.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Codes, type Diagnostic, error, type Range } from './diagnostics.js';
import type { Model } from './model.js';

export type RawElement = Record<string, unknown> & { id: string; type: string };

/** An icon ready to place: its natural size, and what to draw. */
export type LoadedIcon =
  | { kind: 'library'; width: number; height: number; minX: number; minY: number; elements: RawElement[] }
  | { kind: 'image'; width: number; height: number; fileId: string };

/** An image in the scene's `files`, as Excalidraw stores it. */
export interface BinaryFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
  lastRetrieved: number;
}

export interface Icons {
  /** By element ID. */
  byNode: Map<string, LoadedIcon>;
  /** By file ID, for the scene's `files`. */
  files: Record<string, BinaryFile>;
  diagnostics: Diagnostic[];
}

interface LibraryItem {
  /** What `[icon: ...]` matches: the item's name, and `<library>#<n>` for every item. */
  names: string[];
  elements: RawElement[];
}

const IMAGE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const isPath = (v: string) => /[\\/]/.test(v) || /\.[a-z0-9]+$/i.test(v);
const key = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** Reads a `.excalidrawlib` file: version 1 (`library`) or version 2 (`libraryItems`). */
export function readLibrary(file: string): LibraryItem[] {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { type?: string; library?: unknown; libraryItems?: unknown };
  if (data.type !== 'excalidrawlib') throw new Error('it is not an Excalidraw library (its type is not "excalidrawlib")');
  const base = path.basename(file).replace(/\.excalidrawlib$/i, '');
  const raw: { name?: string; elements: RawElement[] }[] = Array.isArray(data.libraryItems)
    ? (data.libraryItems as { name?: unknown; elements?: unknown }[]).map((it) => ({
        ...(typeof it.name === 'string' && it.name.trim() ? { name: it.name } : {}),
        elements: Array.isArray(it.elements) ? (it.elements as RawElement[]) : [],
      }))
    : Array.isArray(data.library)
      ? (data.library as unknown[]).map((els) => ({ elements: Array.isArray(els) ? (els as RawElement[]) : [] }))
      : (() => {
          throw new Error('it has neither `libraryItems` nor `library`');
        })();
  return raw.map((it, i) => ({
    names: [...(it.name ? [it.name] : []), `${base}#${i + 1}`],
    elements: it.elements.filter((e) => e && typeof e === 'object' && !(e as { isDeleted?: boolean }).isDeleted),
  }));
}

/** The corners of an element's box, turned by its angle about its centre. */
function corners(e: RawElement): [number, number][] {
  const x = Number(e.x ?? 0);
  const y = Number(e.y ?? 0);
  let pts: [number, number][];
  if (Array.isArray(e.points) && e.points.length) pts = (e.points as [number, number][]).map(([px, py]) => [x + px, y + py]);
  else {
    const w = Number(e.width ?? 0);
    const h = Number(e.height ?? 0);
    pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  }
  const angle = Number(e.angle ?? 0);
  if (!angle) return pts;
  const cx = x + Number(e.width ?? 0) / 2;
  const cy = y + Number(e.height ?? 0) / 2;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return pts.map(([px, py]) => [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]);
}

/** The bounding box of a library item's elements. */
export function bounds(elements: readonly RawElement[]): { minX: number; minY: number; width: number; height: number } {
  const all = elements.flatMap(corners);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** The natural size of an image: SVG `viewBox` or width and height, or the PNG or JPEG header. */
export function imageSize(data: Buffer, mimeType: string): { width: number; height: number } | undefined {
  if (mimeType === 'image/png') {
    if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.toString('ascii', 12, 16) !== 'IHDR') return undefined;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') {
    if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
    // Walk the markers to the first start-of-frame, which holds the size.
    for (let i = 2; i + 9 < data.length; ) {
      if (data[i] !== 0xff) return undefined;
      const marker = data[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return undefined;
  }
  const svg = /<svg\b[^>]*>/i.exec(data.toString('utf8'))?.[0];
  if (!svg) return undefined;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(svg)?.[1];
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  const px = (v: string | undefined) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : undefined);
  const w = px(attr('width'));
  const h = px(attr('height'));
  return w && h ? { width: w, height: h } : undefined;
}

/**
 * An SVG as Excalidraw's editor stores it (its `normalizeSVG`): just the `<svg>` element, with
 * `xmlns`, `width`, `height` and `viewBox` added where missing. Embedding it in this form means
 * opening the scene does not rewrite the file and bump its version. Excalidraw re-serialises
 * through the DOM, so unusual markup (such as single-quoted attributes) may still be rewritten.
 */
export function normalizeSvg(text: string): string {
  const start = text.search(/<svg\b/i);
  const end = text.lastIndexOf('</svg>');
  if (start === -1) return text;
  let svg = end > start ? text.slice(start, end + '</svg>'.length) : text.slice(start).trim();
  const tag = /<svg\b[^>]*?(\/?)>/i.exec(svg)!;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`).exec(tag[0])?.[1];
  const add: string[] = [];
  if (attr('xmlns') === undefined) add.push('xmlns="http://www.w3.org/2000/svg"');
  let width = attr('width');
  let height = attr('height');
  if (width?.includes('%') || width === 'auto') width = undefined;
  if (height?.includes('%') || height === 'auto') height = undefined;
  const viewBox = attr('viewBox');
  if (!width || !height) {
    let w = width || '50';
    let h = height || '50';
    const m = viewBox && /\d+ +\d+ +(\d+(?:\.\d+)?) +(\d+(?:\.\d+)?)/.exec(viewBox);
    if (m) [, w, h] = m as unknown as [string, string, string];
    // setAttribute replaces an attribute in place, or adds it at the end.
    const set = (n: string, v: string) => {
      const re = new RegExp(`(\\s${n}\\s*=\\s*)(["'])[^"']*\\2`);
      if (re.test(tag[0])) svg = svg.replace(tag[0], (tag[0] = tag[0].replace(re, `$1"${v}"`)));
      else add.push(`${n}="${v}"`);
    };
    set('width', w);
    set('height', h);
    if (!viewBox) add.push(`viewBox="0 0 ${w} ${h}"`);
  } else if (!viewBox) add.push(`viewBox="0 0 ${width} ${height}"`);
  if (!add.length) return svg;
  const open = tag[0].replace(/\s*\/?>$/, '');
  return svg.replace(tag[0], `${open} ${add.join(' ')}${tag[1] ? '/' : ''}>`);
}

/** Lists up to `max` things, for a diagnostic hint. */
function list(things: string[], max = 12): string {
  const shown = things.slice(0, max).map((t) => `"${t}"`).join(', ');
  return things.length > max ? `${shown} and ${things.length - max} more` : shown;
}

/**
 * Loads every library named by `use icons` and every icon the elements ask for. Paths are relative
 * to `baseDir`, the folder of the source file.
 */
export function loadIcons(model: Model, baseDir: string): Icons {
  const diagnostics: Diagnostic[] = [];
  const items = new Map<string, LibraryItem>();
  const allNames: string[] = [];
  for (const lib of model.libraries) {
    const file = path.resolve(baseDir, lib.path);
    try {
      for (const item of readLibrary(file)) {
        for (const n of item.names) {
          allNames.push(n);
          // The first library to have a name wins, as the first `use icons` comes first.
          if (!items.has(key(n))) items.set(key(n), item);
        }
      }
    } catch (e) {
      const reason = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'there is no such file' : (e as Error).message.replace(/^Unexpected .*JSON.*$/, 'it is not valid JSON');
      diagnostics.push(error(Codes.badLibrary, `Cannot read the icon library "${lib.path}": ${reason}.`, lib.range, `The path is relative to the .archt file's folder: ${baseDir}.`));
    }
  }

  const byNode = new Map<string, LoadedIcon>();
  const files: Record<string, BinaryFile> = {};
  for (const n of model.nodes) {
    const icon = n.look.icon;
    if (!icon || n.kind === 'group') continue;
    const loaded = isPath(icon.value) ? loadImage(icon.value, icon.range, baseDir, files, diagnostics) : libraryIcon(icon.value, icon.range, items, allNames, model.libraries.length, diagnostics);
    if (loaded) byNode.set(n.id, loaded);
  }
  return { byNode, files, diagnostics };
}

function libraryIcon(name: string, range: Range, items: Map<string, LibraryItem>, names: string[], libraries: number, diagnostics: Diagnostic[]): LoadedIcon | undefined {
  const item = items.get(key(name));
  if (!item) {
    diagnostics.push(
      error(
        Codes.unknownIcon,
        `No icon is called "${name}".`,
        range,
        libraries === 0 ? 'Load a library first with `use icons <file.excalidrawlib>`, or give the path of an image file.' : names.length ? `The libraries have ${list(names)}.` : 'The libraries are empty.',
      ),
    );
    return undefined;
  }
  const drawable = item.elements.filter((e) => e.type !== 'image' && e.type !== 'frame' && e.type !== 'magicframe' && e.type !== 'embeddable' && e.type !== 'iframe');
  if (!drawable.length) {
    diagnostics.push(error(Codes.unknownIcon, `The icon "${name}" has nothing arch-text can draw.`, range, 'Library icons are drawn from shapes, lines and text; images inside libraries are not carried.'));
    return undefined;
  }
  const b = bounds(drawable);
  return { kind: 'library', width: Math.max(b.width, 1), height: Math.max(b.height, 1), minX: b.minX, minY: b.minY, elements: drawable };
}

function loadImage(value: string, range: Range, baseDir: string, files: Record<string, BinaryFile>, diagnostics: Diagnostic[]): LoadedIcon | undefined {
  const file = path.resolve(baseDir, value);
  const ext = path.extname(file).toLowerCase();
  const mimeType = IMAGE_TYPES[ext];
  if (!mimeType) {
    diagnostics.push(error(Codes.unknownIcon, `"${value}" is not an image arch-text can use.`, range, 'Icons are SVG, PNG or JPEG files, or names of library items.'));
    return undefined;
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(file);
    if (mimeType === 'image/svg+xml') data = Buffer.from(normalizeSvg(data.toString('utf8')), 'utf8');
  } catch {
    const dir = path.dirname(file);
    const here = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => IMAGE_TYPES[path.extname(f).toLowerCase()]).sort() : [];
    const rel = (f: string) => path.relative(baseDir, path.join(dir, f)).replace(/\\/g, '/');
    diagnostics.push(
      error(
        Codes.unknownIcon,
        `There is no image at "${value}".`,
        range,
        here.length ? `That folder has ${list(here.map((f) => (rel(f).startsWith('.') ? rel(f) : `./${rel(f)}`)))}.` : `The path is relative to the .archt file's folder, ${baseDir}, and the folder has no images.`,
      ),
    );
    return undefined;
  }
  const size = imageSize(data, mimeType);
  if (!size) {
    diagnostics.push(error(Codes.unknownIcon, `Cannot read the size of "${value}".`, range, mimeType === 'image/svg+xml' ? 'Give the SVG a viewBox, or a width and height in px.' : 'The file may be damaged.'));
    return undefined;
  }
  // Keyed by content, so the same image used twice is stored once.
  const fileId = createHash('sha1').update(data).digest('hex');
  files[fileId] ??= { id: fileId, mimeType, dataURL: `data:${mimeType};base64,${data.toString('base64')}`, created: 1, lastRetrieved: 1 };
  return { kind: 'image', ...size, fileId };
}
