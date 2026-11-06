// Writes Excalidraw element JSON directly (ADR-001 in docs/decisions.md).
// IDs and seeds come from model IDs, so the same input always gives the same scene.
import { hash } from './ids.js';
import {
  ACTOR,
  BOUND_TEXT_PADDING,
  EDGE_FONT_SIZE,
  type LaidOutEdge,
  type LaidOutNode,
  type Layout,
  NODE_FONT_SIZE,
  type Point,
} from './layout.js';
import type { EdgeOp } from './parser.js';
import { FONTS, type TextSize } from './text.js';

export const SCENE_SOURCE = 'https://github.com/markbac/arch-text';

/** Space between an arrow's end and the shape it is bound to, in px. */
const BINDING_GAP = 4;
const INK = '#1e1e1e';
const GREY = '#868e96';

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
function base(id: string, type: string, groupIds: string[]) {
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
    groupIds,
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

type Box = { x: number; y: number; width: number; height: number };

/** A label bound to `box`, placed where Excalidraw would put it for the given alignment. */
function boundText(
  id: string,
  box: Box & { id: string },
  text: string,
  size: TextSize,
  fontSize: number,
  align: { h: 'left' | 'center'; v: 'top' | 'middle' | 'bottom' },
  groupIds: string[],
  colour = INK,
) {
  const x = align.h === 'left' ? box.x + BOUND_TEXT_PADDING : box.x + (box.width - size.width) / 2;
  const y =
    align.v === 'top' ? box.y + BOUND_TEXT_PADDING : align.v === 'bottom' ? box.y + box.height - BOUND_TEXT_PADDING - size.height : box.y + (box.height - size.height) / 2;
  return {
    ...base(id, 'text', groupIds),
    strokeColor: colour,
    x: r(x),
    y: r(y),
    width: r(size.width),
    height: r(size.height),
    text,
    fontSize,
    fontFamily: FONTS.hand.id,
    textAlign: align.h,
    verticalAlign: align.v,
    containerId: box.id,
    originalText: text,
    autoResize: true,
    lineHeight: FONTS.hand.lineHeight,
  };
}

/** A line through `points`, given in absolute coordinates. */
function line(id: string, points: Point[], groupIds: string[]) {
  const [ox, oy] = points[0]!;
  const rel = points.map(([x, y]) => [r(x - ox), r(y - oy)] as Point);
  const xs = rel.map((p) => p[0]);
  const ys = rel.map((p) => p[1]);
  return {
    ...base(id, 'line', groupIds),
    x: r(ox),
    y: r(oy),
    width: r(Math.max(...xs) - Math.min(...xs)),
    height: r(Math.max(...ys) - Math.min(...ys)),
    points: rel,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  };
}

/** The elements for one node. `arrows` are the arrows bound to it; `groups` its enclosing groups, innermost first. */
function nodeElements(node: LaidOutNode, arrows: string[], groups: string[]): ExcalidrawElement[] {
  if (node.kind === 'group') return [];
  const labelId = `${node.id}:label`;
  // Actors and datastores are drawn from several parts, grouped so they move as one.
  const composite = node.kind === 'actor' || node.kind === 'datastore';
  const groupIds = composite ? [`${node.id}:shape`, ...groups] : groups;
  const box = { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height };
  const bound = [...(node.name !== undefined ? [{ type: 'text', id: labelId }] : []), ...arrows.map((id) => ({ type: 'arrow', id }))];

  // The bindable box: arrows and the label attach to it. For composite shapes it is invisible.
  const rect = {
    ...base(node.id, 'rectangle', groupIds),
    ...box,
    boundElements: bound.length ? bound : null,
    ...(node.kind === 'component' ? { roundness: { type: 3 } } : {}),
    ...(node.kind === 'boundary' ? { strokeColor: GREY, strokeStyle: 'dashed' } : {}),
    ...(composite ? { strokeColor: 'transparent' } : {}),
  };
  const out: ExcalidrawElement[] = [rect];
  if (node.name !== undefined && node.label) {
    const align =
      node.kind === 'boundary'
        ? ({ h: 'left', v: 'top' } as const)
        : node.container
          ? ({ h: 'center', v: 'top' } as const)
          : node.kind === 'actor'
            ? ({ h: 'center', v: 'bottom' } as const)
            : ({ h: 'center', v: 'middle' } as const);
    out.push(boundText(labelId, box, node.name, node.label, NODE_FONT_SIZE, align, groupIds, node.kind === 'boundary' ? GREY : INK));
  }

  if (node.kind === 'actor') {
    const cx = node.x + node.width / 2;
    const top = node.y;
    const head = ACTOR.head;
    const neck = top + head;
    const hip = top + ACTOR.height * 0.66;
    const foot = top + ACTOR.height;
    const half = ACTOR.width / 2;
    out.push(
      { ...base(`${node.id}:head`, 'ellipse', groupIds), x: r(cx - head / 2), y: r(top), width: head, height: head },
      line(`${node.id}:body`, [[cx, neck], [cx, hip]], groupIds),
      line(`${node.id}:arms`, [[cx - half, neck + 12], [cx + half, neck + 12]], groupIds),
      line(`${node.id}:legs`, [[cx - half * 0.8, foot], [cx, hip], [cx + half * 0.8, foot]], groupIds),
    );
  }

  if (node.kind === 'datastore') {
    const cap = node.cap ?? 20;
    const { x, y, width: w, height: h } = node;
    const bottom = y + h - cap / 2;
    const arc: Point[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = (Math.PI * k) / 12;
      arc.push([x + w / 2 - (w / 2) * Math.cos(t), bottom + (cap / 2) * Math.sin(t)]);
    }
    // The body as a closed loop (so it can be filled later), then the top ellipse over it.
    out.push(
      line(`${node.id}:body`, [[x, y + cap / 2], ...arc, [x + w, y + cap / 2], [x, y + cap / 2]], groupIds),
      { ...base(`${node.id}:cap`, 'ellipse', groupIds), x: r(x), y: r(y), width: r(w), height: cap },
    );
  }
  return out;
}

/** Moves `p` towards `q` by `d` px. */
function towards(p: Point, q: Point, d: number): Point {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (len <= d * 2) return p;
  return [p[0] + ((q[0] - p[0]) * d) / len, p[1] + ((q[1] - p[1]) * d) / len];
}

/** The point on segment a-b nearest to p. */
function project(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Excalidraw always draws an arrow's label at the arrow's middle point (for an odd number of
 * points), whatever position the file gives. So put a point where the label should be, on the
 * line nearest `centre`, and pad the shorter side with points on the line until it is the middle one.
 */
function withLabelPoint(pts: Point[], centre: Point): { points: Point[]; at: Point } {
  let best = { d: Infinity, i: 0, q: pts[0]! };
  for (let i = 0; i < pts.length - 1; i++) {
    const q = project(centre, pts[i]!, pts[i + 1]!);
    const d = Math.hypot(q[0] - centre[0], q[1] - centre[1]);
    if (d < best.d) best = { d, i, q };
  }
  const before = pts.slice(0, best.i + 1);
  const after = pts.slice(best.i + 1);
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Split the segment next to the label point, on the side that is short of points.
  while (before.length < after.length) before.push(mid(before[before.length - 1]!, best.q));
  while (after.length < before.length) after.unshift(mid(best.q, after[0]!));
  return { points: [...before, best.q, ...after], at: best.q };
}

const ARROWHEADS: Record<EdgeOp, [string | null, string | null]> = {
  '->': [null, 'arrow'],
  '..>': [null, 'arrow'],
  '<->': ['arrow', 'arrow'],
  '--': [null, null],
};

/** Where `p` sits on `box`, as fractions of its width and height: an elbow arrow's fixed point. */
function fixedPoint(p: Point, box: Box): [number, number] {
  const f = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  return [f((p[0] - box.x) / box.width), f((p[1] - box.y) / box.height)];
}

/**
 * An elbow arrow, so Excalidraw re-routes it when either end's shape moves. A plain arrow with
 * bends would keep its bends where they are and pull its end off the shape.
 */
function arrow(edge: LaidOutEdge & { op: EdgeOp }, from: Box, to: Box): ExcalidrawElement[] {
  const fixedStart = fixedPoint(edge.points[0]!, from);
  const fixedEnd = fixedPoint(edge.points[edge.points.length - 1]!, to);
  let pts = edge.points.map((p) => [...p] as Point);
  pts[0] = towards(pts[0]!, pts[1]!, BINDING_GAP);
  pts[pts.length - 1] = towards(pts[pts.length - 1]!, pts[pts.length - 2]!, BINDING_GAP);
  let labelAt: Point | undefined;
  if (edge.label) ({ points: pts, at: labelAt } = withLabelPoint(pts, [edge.label.x, edge.label.y]));
  const [startArrowhead, endArrowhead] = ARROWHEADS[edge.op];
  const labelId = `${edge.id}:label`;
  const el = {
    ...line(edge.id, pts, []),
    type: 'arrow',
    strokeStyle: edge.op === '..>' ? 'dashed' : 'solid',
    boundElements: edge.label ? [{ type: 'text', id: labelId }] : null,
    startBinding: { elementId: edge.from, focus: 0, gap: BINDING_GAP, fixedPoint: fixedStart },
    endBinding: { elementId: edge.to, focus: 0, gap: BINDING_GAP, fixedPoint: fixedEnd },
    startArrowhead,
    endArrowhead,
    elbowed: true,
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
  };
  if (!edge.label) return [el];
  const { width, height, text } = edge.label;
  const [cx, cy] = labelAt!;
  const box = { id: edge.id, x: cx - width / 2, y: cy - height / 2, width, height };
  return [el, boundText(labelId, box, text, { width, height }, EDGE_FONT_SIZE, { h: 'center', v: 'middle' }, [])];
}

export function emit(layout: Layout, ops: ReadonlyMap<string, EdgeOp>): Scene {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const arrowsOf = (id: string) => layout.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id);
  const groupsOf = (n: LaidOutNode) => {
    const out: string[] = [];
    for (let p = n.parent; p; p = byId.get(p)?.parent) if (byId.get(p)?.kind === 'group') out.push(`group:${p}`);
    return out;
  };
  // Depth first, so a container is drawn before (under) what it holds.
  const ordered: ExcalidrawElement[] = [];
  const visit = (n: LaidOutNode) => {
    ordered.push(...nodeElements(n, arrowsOf(n.id), groupsOf(n)));
    layout.nodes.filter((c) => c.parent === n.id).forEach(visit);
  };
  layout.nodes.filter((n) => !n.parent).forEach(visit);
  ordered.push(...layout.edges.flatMap((e) => arrow({ ...e, op: ops.get(e.id) ?? '->' }, byId.get(e.from)!, byId.get(e.to)!)));
  return {
    type: 'excalidraw',
    version: 2,
    source: SCENE_SOURCE,
    elements: ordered.map((el, i) => ({ ...el, index: fractionalIndex(i) })),
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  };
}
