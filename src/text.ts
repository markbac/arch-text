// Text measurement with Excalidraw's own font files (ADR-002 in docs/decisions.md).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

/** Excalidraw's `fontFamily` numbers and line heights for the fonts arch-text uses. */
export const FONTS = {
  hand: { family: 'Excalifont', id: 5, lineHeight: 1.25 },
} as const;

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
}

const families = new Map<string, Face[]>();

/** Every `woff2` file of a family; each covers part of Unicode. */
function loadFamily(family: string): Face[] {
  let faces = families.get(family);
  if (!faces) {
    const dir = path.join(fontRoot(), family);
    faces = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.woff2'))
      .sort()
      .map((f) => ({ font: fontkit.openSync(path.join(dir, f)) as fontkit.Font }));
    families.set(family, faces);
  }
  return faces;
}

/** Width in px of one line, summing glyph advances with kerning; each character uses the file that has its glyph. */
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
    const face = faces.find((f) => f.font.hasGlyphForCodePoint(ch.codePointAt(0)!)) ?? faces[0];
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
export function measure(text: string, fontSize: number, font: (typeof FONTS)[keyof typeof FONTS] = FONTS.hand): TextSize {
  const lines = text.split('\n');
  return {
    width: Math.max(...lines.map((l) => lineWidth(l, font.family, fontSize))),
    height: lines.length * fontSize * font.lineHeight,
  };
}
