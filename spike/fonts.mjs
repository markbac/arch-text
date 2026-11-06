// Excalifont ships as several woff2 files split by Unicode range. Load them all and
// pick, per character, the file that has the glyph (what the browser does with unicode-range).
import fs from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';

export const FONT_DIR = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');

export function loadFamily(family) {
  const dir = path.join(FONT_DIR, family);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort().map((f) => ({ file: f, font: fontkit.openSync(path.join(dir, f)) }));
}

// Width in px of one line of text, as the sum of glyph advances (with kerning inside each run).
export function measureLine(faces, text, fontSize) {
  let width = 0;
  let run = '';
  let runFace = null;
  const flush = () => {
    if (!run) return;
    const { font } = runFace;
    width += (font.layout(run).advanceWidth / font.unitsPerEm) * fontSize;
    run = '';
  };
  for (const ch of text) {
    const face = faces.find((f) => f.font.hasGlyphForCodePoint(ch.codePointAt(0))) ?? faces[0];
    if (face !== runFace) { flush(); runFace = face; }
    run += ch;
  }
  flush();
  return width;
}
