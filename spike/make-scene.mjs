// Writes scenes/two-boxes.excalidraw by hand (no skeleton API): two rectangles, a bound,
// Set UNSIZED=1 to write the icon with only a viewBox, which Excalidraw then draws clipped.
// labelled arrow and an embedded SVG image. Text is sized with the Node measurement.
import fs from 'node:fs';
import { loadFamily, measureLine } from './fonts.mjs';

const faces = loadFamily('Excalifont');
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25; // Excalidraw's line height for Excalifont

const base = (id, n) => ({
  id, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
  roundness: null, seed: 1000 + n, version: 1, versionNonce: 2000 + n, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false,
});

function box(id, n, x, y, w, h, fill, label) {
  const tw = measureLine(faces, label, FONT_SIZE);
  const th = FONT_SIZE * LINE_HEIGHT;
  const rect = { ...base(id, n), type: 'rectangle', x, y, width: w, height: h, backgroundColor: fill, roundness: { type: 3 },
    boundElements: [{ type: 'text', id: `${id}-label` }] };
  const text = { ...base(`${id}-label`, n + 100), type: 'text', x: x + (w - tw) / 2, y: y + (h - th) / 2, width: tw, height: th,
    text: label, originalText: label, fontSize: FONT_SIZE, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle',
    containerId: id, lineHeight: LINE_HEIGHT, autoResize: true };
  return [rect, text];
}

const [a, aText] = box('hes', 1, 0, 0, 160, 80, '#a5d8ff', 'HES');
const [b, bText] = box('platform', 2, 320, 0, 160, 80, '#a5d8ff', 'Platform');
const gap = 4;
const arrow = { ...base('hes-platform', 3), type: 'arrow', x: 160 + gap, y: 40, width: 160 - 2 * gap, height: 0,
  points: [[0, 0], [160 - 2 * gap, 0]], lastCommittedPoint: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false,
  startBinding: { elementId: 'hes', focus: 0, gap }, endBinding: { elementId: 'platform', focus: 0, gap },
  boundElements: [{ type: 'text', id: 'hes-platform-label' }], roundness: { type: 2 } };
const lw = measureLine(faces, 'Events', 16);
const arrowText = { ...base('hes-platform-label', 103), type: 'text', x: 240 - lw / 2, y: 40 - 10, width: lw, height: 20,
  text: 'Events', originalText: 'Events', fontSize: 16, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle',
  containerId: 'hes-platform', lineHeight: LINE_HEIGHT, autoResize: true };
a.boundElements.push({ type: 'arrow', id: 'hes-platform' });
b.boundElements.push({ type: 'arrow', id: 'hes-platform' });

// A 2:1 SVG icon, embedded as an image element scaled to fit a 48x48 box (so 48x24).
const size = !process.env.UNSIZED ? ' width="40" height="20"' : '';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"${size}><rect x="1" y="1" width="38" height="18" rx="4" fill="#ffd8a8" stroke="#e8590c" stroke-width="2"/><circle cx="10" cy="10" r="4" fill="#e8590c"/></svg>`;
const fileId = 'icon-0001';
const image = { ...base('icon', 4), type: 'image', x: 136, y: 120, width: 48, height: 24, status: 'saved', fileId, scale: [1, 1], crop: null };

const scene = {
  type: 'excalidraw', version: 2, source: 'arch-text spike',
  elements: [a, aText, b, bText, arrow, arrowText, image],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
  files: { [fileId]: { id: fileId, mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, created: 1 } },
};
fs.writeFileSync('scenes/two-boxes.excalidraw', JSON.stringify(scene, null, 2) + '\n');
console.log('wrote scenes/two-boxes.excalidraw');
