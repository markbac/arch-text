// Text measurement with Excalidraw's own font files (ADR-002 in docs/decisions.md).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { FONT_RANGES } from './font-ranges.js';

/**
 * Excalidraw's `fontFamily` numbers, font folders and line heights for the fonts arch-text uses:
 * the three in Excalidraw's own font picker (hand-drawn, normal and code).
 */
export const FONTS = {
  hand: { family: 'Excalifont', id: 5, lineHeight: 1.25 },
  normal: { family: 'Nunito', id: 6, lineHeight: 1.35 },
  code: { family: 'ComicShanns', id: 8, lineHeight: 1.25 },
} as const;

export type FontName = keyof typeof FONTS;
export type Font = (typeof FONTS)[FontName];

/**
 * The folder holding Excalidraw's font folders: beside the built export page in a release,
 * or in the installed `@excalidraw/excalidraw` package when running from source.
 */
export function fontRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const built = path.join(here, 'export-page', 'fonts');
  if (fs.existsSync(built)) return built;
  // The package's main file is dist/prod/index.js, beside its fonts folder.
  const main = createRequire(import.meta.url).resolve('@excalidraw/excalidraw');
  return path.join(path.dirname(main), 'fonts');
}

interface Face {
  font: fontkit.Font;
  /** The code points Excalidraw declares this file for. */
  ranges: [number, number][];
}

const families = new Map<string, Face[]>();

/** Every `woff2` file of a family, in Excalidraw's order; each covers part of Unicode. */
function loadFamily(family: string): Face[] {
  let faces = families.get(family);
  if (!faces) {
    const dir = path.join(fontRoot(), family);
    const declared = FONT_RANGES[family] ?? [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.woff2'));
    // Files Excalidraw declares come in its order; any others (none, today) cover nothing.
    const order = (f: string) => {
      const i = declared.findIndex((d) => d.file === f);
      return i === -1 ? declared.length : i;
    };
    faces = files
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
      .map((f) => ({ font: fontkit.openSync(path.join(dir, f)) as fontkit.Font, ranges: declared.find((d) => d.file === f)?.ranges ?? [] }));
    families.set(family, faces);
  }
  return faces;
}

/**
 * The file the browser draws a character from: as CSS says for faces whose unicode ranges overlap,
 * the last one declared for its range that has the glyph is tried first.
 */
function faceFor(faces: Face[], cp: number): Face {
  for (let i = faces.length - 1; i >= 0; i--) {
    const f = faces[i]!;
    if (f.ranges.some(([a, b]) => cp >= a && cp <= b) && f.font.hasGlyphForCodePoint(cp)) return f;
  }
  return faces.find((f) => f.font.hasGlyphForCodePoint(cp)) ?? faces[0]!;
}

/** Width in px of one line, summing glyph advances with kerning, each character from the file the browser would use. */
export function lineWidth(text: string, family: string, fontSize: number): number {
  const faces = loadFamily(family);
  let width = 0;
  let run = '';
  let runFace: Face | undefined;
  const flush = () => {
    if (run && runFace) width += (runFace.font.layout(run).advanceWidth / runFace.font.unitsPerEm) * fontSize;
    run = '';
  };
  for (const ch of text) {
    const face = faceFor(faces, ch.codePointAt(0)!);
    if (face !== runFace) {
      flush();
      runFace = face;
    }
    run += ch;
  }
  flush();
  return width;
}

export interface TextSize {
  width: number;
  height: number;
}

/** Size of a possibly multi-line label, as Excalidraw lays it out. */
export function measure(text: string, fontSize: number, font: Font = FONTS.hand): TextSize {
  const lines = text.split('\n');
  return {
    width: Math.max(...lines.map((l) => lineWidth(l, font.family, fontSize))),
    height: lines.length * fontSize * font.lineHeight,
  };
}
