// Writes Excalidraw element JSON directly (ADR-001 in docs/decisions.md).
// IDs and seeds come from model IDs, so the same input always gives the same scene.
import { hash } from './ids.js';
import { EDGE_FONT_SIZE, type LaidOutEdge, type LaidOutNode, type Layout, NODE_FONT_SIZE, type Point } from './layout.js';
import { FONTS } from './text.js';

export const SCENE_SOURCE = 'https://github.com/markbac/arch-text';

/** Space between an arrow's end and the shape it is bound to, in px. */
const BINDING_GAP = 4;
const INK = '#1e1e1e';

export type ExcalidrawElement = Record<string, unknown> & { id: string; type: string };

export interface Scene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: null };
  files: Record<string, unknown>;
}

const r = (v: number) => Math.round(v * 100) / 100;

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Excalidraw's fractional `index` for the element at position `i` (a0, a1 ... az, b00, b01 ...),
 * the same keys its fractional-indexing library generates in sequence. Without them, opening
 * the file rewrites every element's version and timestamp.
 */
export function fractionalIndex(i: number): string {
  let width = 1;
  let span = 62;
  while (i >= span) {
    i -= span;
    width++;
    span *= 62;
  }
  let digits = '';
  for (let k = 0; k < width; k++) {
    digits = DIGITS[i % 62]! + digits;
    i = Math.floor(i / 62);
  }
  return String.fromCharCode('a'.charCodeAt(0) + width - 1) + digits;
}

/** Properties every element shares, in a fixed order. */
function base(id: string, type: string) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: null as null | { type: number },
    seed: hash(id),
    version: 1,
    versionNonce: hash(`${id}:nonce`),
    isDeleted: false,
    boundElements: null as null | { type: string; id: string }[],
    updated: 1,
    link: null,
    locked: false,
  };
}

function boundText(id: string, containerId: string, text: string, fontSize: number, width: number, height: number, x: number, y: number) {
  return {
    ...base(id, 'text'),
    x: r(x),
    y: r(y),
    width: r(width),
    height: r(height),
    text,
    fontSize,
    fontFamily: FONTS.hand.id,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId,
    originalText: text,
    autoResize: true,
    lineHeight: FONTS.hand.lineHeight,
  };
}

function system(node: LaidOutNode, arrows: string[]): ExcalidrawElement[] {
  const labelId = `${node.id}:label`;
  const rect = {
    ...base(node.id, 'rectangle'),
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    boundElements: [{ type: 'text', id: labelId }, ...arrows.map((id) => ({ type: 'arrow', id }))],
  };
  const { width, height } = node.label;
  const text = boundText(labelId, node.id, node.name, NODE_FONT_SIZE, width, height, node.x + (node.width - width) / 2, node.y + (node.height - height) / 2);
  return [rect, text];
}

/** Moves `p` towards `q` by `d` px. */
function towards(p: Point, q: Point, d: number): Point {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (len <= d * 2) return p;
  return [p[0] + ((q[0] - p[0]) * d) / len, p[1] + ((q[1] - p[1]) * d) / len];
}

/** Where Excalidraw puts an arrow's label: on the middle point, or the middle of the middle segment. */
function labelCentre(points: Point[]): Point {
  const n = points.length;
  if (n % 2 === 1) return points[(n - 1) / 2]!;
  const a = points[n / 2 - 1]!;
  const b = points[n / 2]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function arrow(edge: LaidOutEdge): ExcalidrawElement[] {
  const pts = edge.points.map((p) => [...p] as Point);
  pts[0] = towards(pts[0]!, pts[1]!, BINDING_GAP);
  pts[pts.length - 1] = towards(pts[pts.length - 1]!, pts[pts.length - 2]!, BINDING_GAP);
  const [ox, oy] = pts[0]!;
  const rel = pts.map(([x, y]) => [r(x - ox), r(y - oy)] as Point);
  const xs = rel.map((p) => p[0]);
  const ys = rel.map((p) => p[1]);
  const labelId = `${edge.id}:label`;
  const el = {
    ...base(edge.id, 'arrow'),
    x: r(ox),
    y: r(oy),
    width: r(Math.max(...xs) - Math.min(...xs)),
    height: r(Math.max(...ys) - Math.min(...ys)),
    boundElements: edge.label ? [{ type: 'text', id: labelId }] : null,
    points: rel,
    lastCommittedPoint: null,
    startBinding: { elementId: edge.from, focus: 0, gap: BINDING_GAP },
    endBinding: { elementId: edge.to, focus: 0, gap: BINDING_GAP },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  };
  if (!edge.label) return [el];
  const [cx, cy] = labelCentre(pts);
  const { width, height, text } = edge.label;
  return [el, boundText(labelId, edge.id, text, EDGE_FONT_SIZE, width, height, cx - width / 2, cy - height / 2)];
}

export function emit(layout: Layout): Scene {
  const arrowsOf = (id: string) => layout.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id);
  return {
    type: 'excalidraw',
    version: 2,
    source: SCENE_SOURCE,
    elements: [...layout.nodes.flatMap((n) => system(n, arrowsOf(n.id))), ...layout.edges.flatMap(arrow)].map((el, i) => ({ ...el, index: fractionalIndex(i) })),
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  };
}
