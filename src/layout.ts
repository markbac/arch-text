// Sizes elements from their labels and shapes, and lays the whole tree out with ELK in one pass
// (hierarchical layered layout), so edges between nested elements are routed together.
import { createRequire } from 'node:module';
import type { ELK as ElkInstance, ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { LoadedIcon } from './icons.js';
import type { Direction, Model, ModelEdge, NodeKind } from './model.js';
import type { Look } from './style.js';
import { FONTS, measure, type TextSize } from './text.js';

// elkjs is CommonJS; TypeScript's NodeNext typing of its default export is wrong, so load it with require.
const ELK = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js') as new () => ElkInstance;

/** Excalidraw keeps bound text this far inside its container. */
export const BOUND_TEXT_PADDING = 5;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
const PAD_X = 24;
const PAD_Y = 20;
/** Space inside a container around its children; the top also holds the title. */
const CONTAINER_PAD = 20;
const GROUP_PAD = 16;
/**
 * The lane each arrow gets along a hub's side. Wide enough for the hub to reach across what it
 * connects to, so its arrows drop straight to their ends rather than fanning out sideways.
 */
const PORT_GAP = 120;
/** Arrows on one side that make a shape a hub: widened, with its arrows spread across the side. */
const HUB = 4;
/** A hub is at most this many times longer than it is deep. */
const HUB_ASPECT = 4;

/** The stick figure for an actor, drawn at the top of its box. */
export const ACTOR = { width: 40, height: 70, head: 20, labelGap: 6 } as const;

/**
 * Icon boxes, in px: `inside` a shape above its label, the whole node with `icon-only` (and for an
 * actor, in place of the stick figure), and in the `corner` of a container beside its title.
 * An icon is scaled to fit its box, keeping its aspect ratio.
 */
export const ICON = { inside: 40, only: 64, corner: 24, top: 12, gap: 6, cornerGap: 8 } as const;

/** Where an element's icon goes. */
export type IconPlace = 'inside' | 'only' | 'corner';

/** The size of an icon fitted into a square box of side `box`. */
export function fit(icon: { width: number; height: number }, box: number): { width: number; height: number } {
  const s = Math.min(box / icon.width, box / icon.height);
  return { width: r(icon.width * s), height: r(icon.height * s) };
}

export type Point = [number, number];

export interface LaidOutNode {
  id: string;
  kind: NodeKind;
  name?: string;
  parent?: string;
  /** True when the element holds others, so its label goes at the top. */
  container: boolean;
  /** Absolute position and size. */
  x: number;
  y: number;
  width: number;
  height: number;
  label?: TextSize;
  /** Height of a datastore's top ellipse. */
  cap?: number;
  look: Look;
  /** The icon's absolute box, and where it sits. */
  icon?: { x: number; y: number; width: number; height: number; place: IconPlace };
}

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  /** Absolute points from source border to target border. */
  points: Point[];
  /** The label and its centre, where ELK made room for it. */
  label?: { text: string; x: number; y: number } & TextSize;
  look: Look;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/**
 * Spacing for the root and every container. Excalidraw always draws an arrow's label on the
 * line, but in a top-to-bottom layout ELK reserves room beside vertical edges, not on them. So
 * there, shapes keep at least half the widest label's width away from edges.
 */
const spacing = (direction: Direction, widestLabel: number): LayoutOptions => ({
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.edgeNode': String(direction === 'DOWN' ? Math.max(20, Math.ceil(widestLabel / 2) + 12) : 20),
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.spacing.edgeEdge': '15',
  'elk.spacing.edgeLabel': '6',
});

const rootOptions = (direction: Direction, widestLabel: number): LayoutOptions => ({
  'elk.algorithm': 'layered',
  'elk.direction': direction,
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  'elk.edgeLabels.placement': 'CENTER',
  // On the edge, with room made for it: Excalidraw draws arrow labels on the line.
  'elk.edgeLabels.inline': 'true',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  ...spacing(direction, widestLabel),
});

/** Rounds to 2 decimal places, so output does not carry floating-point noise. */
const r = (v: number) => Math.round(v * 100) / 100;

/** Where an element's icon goes, if it has one. */
export function iconPlace(kind: NodeKind, container: boolean, look: Look): IconPlace {
  if (container || kind === 'boundary') return 'corner';
  return look.iconOnly || kind === 'actor' ? 'only' : 'inside';
}

/** The size of a leaf element, from its label, shape and icon (already fitted). */
function leafSize(
  kind: NodeKind,
  label: TextSize | undefined,
  icon?: { width: number; height: number; place: IconPlace },
): { width: number; height: number; cap?: number } {
  const lw = label?.width ?? 0;
  const lh = label?.height ?? 0;
  if (icon?.place === 'only') {
    return { width: Math.ceil(Math.max(icon.width, lw + 2 * BOUND_TEXT_PADDING)), height: Math.ceil(icon.height + ICON.gap + lh + BOUND_TEXT_PADDING) };
  }
  if (icon?.place === 'inside') {
    const width = Math.max(MIN_WIDTH, Math.ceil(lw + 2 * PAD_X), Math.ceil(icon.width + 2 * PAD_X));
    const height = Math.max(MIN_HEIGHT, Math.ceil(ICON.top + icon.height + ICON.gap + lh + BOUND_TEXT_PADDING));
    if (kind === 'datastore') {
      const cap = Math.round(Math.min(30, width * 0.18));
      return { width, height: height + cap, cap };
    }
    return { width, height };
  }
  if (icon?.place === 'corner') {
    // A boundary with nothing in it: room for the title and the icon beside it.
    return {
      width: Math.max(MIN_WIDTH, Math.ceil(lw + 2 * PAD_X + icon.width + ICON.cornerGap)),
      height: Math.max(MIN_HEIGHT, Math.ceil(lh + 2 * PAD_Y), Math.ceil(icon.height + 2 * PAD_Y)),
    };
  }
  if (kind === 'actor') {
    return { width: Math.ceil(Math.max(ACTOR.width, lw + 2 * BOUND_TEXT_PADDING)), height: Math.ceil(ACTOR.height + ACTOR.labelGap + lh + BOUND_TEXT_PADDING) };
  }
  const width = Math.max(MIN_WIDTH, Math.ceil(lw + 2 * PAD_X));
  const height = Math.max(MIN_HEIGHT, Math.ceil(lh + 2 * PAD_Y));
  if (kind === 'datastore') {
    const cap = Math.round(Math.min(30, width * 0.18));
    return { width, height: height + cap, cap };
  }
  return { width, height };
}

/** Lays out the model. `icons` are the loaded icons by element ID, at their natural size. */
export async function layout(model: Model, icons: ReadonlyMap<string, Pick<LoadedIcon, 'width' | 'height'>> = new Map()): Promise<Layout> {
  const labels = new Map(model.nodes.map((n) => [n.id, n.name === undefined ? undefined : measure(n.name, n.look.fontSize, FONTS[n.look.font])]));
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { width: number; height: number; cap?: number }>();
  const fitted = new Map(
    model.nodes.flatMap((n) => {
      const icon = icons.get(n.id);
      if (!icon) return [];
      const place = iconPlace(n.kind, n.children.length > 0, n.look);
      return [[n.id, { ...fit(icon, place === 'only' ? ICON.only : place === 'corner' ? ICON.corner : ICON.inside), place }] as const];
    }),
  );

  const drawn = model.options.bundle ? bundle(model.edges) : model.edges.map(({ id, from, to, label, look }) => ({ id, from, to, label, look }));
  const edgeLabels = new Map(drawn.map((e) => [e.id, e.label === undefined ? undefined : { text: e.label, ...measure(e.label, e.look.fontSize, FONTS[e.look.font]) }]));
  const widestLabel = Math.max(0, ...[...edgeLabels.values()].map((l) => l?.width ?? 0));

  // Arrows entering and leaving each element, as ELK will see them: on the side facing the flow.
  let ends = new Map<string, { in: number; out: number }>();
  const countEnds = (flipped: ReadonlySet<string>) => {
    ends = new Map();
    const at = (id: string) => ends.get(id) ?? (ends.set(id, { in: 0, out: 0 }), ends.get(id)!);
    for (const e of drawn) {
      const [from, to] = flipped.has(e.id) ? [e.to, e.from] : [e.from, e.to];
      at(from).out++;
      at(to).in++;
    }
  };

  const toElk = (id: string): ElkNode => {
    const n = byId.get(id)!;
    const label = labels.get(id);
    const icon = fitted.get(id);
    if (!n.children.length) {
      const size = { ...leafSize(n.kind, label, icon) };
      // A hub's arrows each get their own lane: it is widened, and they are spread right across
      // the side they meet, so they run straight to their ends instead of leaving together from
      // the middle and running side by side. ELK places a few arrows well as it is.
      const e = ends.get(id);
      const most = Math.max(e?.in ?? 0, e?.out ?? 0);
      const hub = most >= HUB && n.kind !== 'actor' && icon?.place !== 'only';
      if (hub) {
        const [along, across] = model.direction === 'DOWN' ? (['width', 'height'] as const) : (['height', 'width'] as const);
        size[along] = Math.max(size[along], (most + 1) * PORT_GAP);
        // Grown both ways, so it reads as the main part it is rather than a bar.
        size[across] = Math.max(size[across], Math.round(size[along] / HUB_ASPECT));
      }
      sizes.set(id, size);
      return { id, width: size.width, height: size.height, ...(hub ? { layoutOptions: { 'elk.portAlignment.default': 'JUSTIFIED' } } : {}) };
    }
    const isGroup = n.kind === 'group';
    const top = isGroup ? GROUP_PAD : Math.ceil(BOUND_TEXT_PADDING + Math.max(label?.height ?? 0, icon?.height ?? 0) + CONTAINER_PAD / 2);
    const side = isGroup ? GROUP_PAD : CONTAINER_PAD;
    // Room for the icon on both sides, so a centred title never runs under it.
    const minWidth = Math.ceil((label?.width ?? 0) + 2 * (BOUND_TEXT_PADDING + side + (icon ? icon.width + ICON.cornerGap : 0)));
    return {
      id,
      layoutOptions: {
        ...spacing(model.direction, widestLabel),
        'elk.padding': `[top=${top},left=${side},bottom=${side},right=${side}]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${minWidth}, ${top + side})`,
      },
      children: n.children.map(toElk),
    };
  };

  // Edges laid out from target to source, then drawn the right way round. See `backEdges`.
  const graphFor = (flipped: ReadonlySet<string>): ElkNode => (countEnds(flipped), {
    id: 'root',
    layoutOptions: rootOptions(model.direction, widestLabel),
    children: model.nodes.filter((n) => !n.parent).map((n) => toElk(n.id)),
    edges: drawn.map((e) => {
      const label = edgeLabels.get(e.id);
      const [from, to] = flipped.has(e.id) ? [e.to, e.from] : [e.from, e.to];
      return {
        id: e.id,
        sources: [from],
        targets: [to],
        labels: label ? [{ id: `${e.id}:label`, text: label.text, width: Math.ceil(label.width), height: Math.ceil(label.height) }] : [],
      };
    }),
  });
  const elk = new ELK();
  let flipped = new Set<string>();
  let out = await elk.layout(graphFor(flipped));
  let abs = positions(out);
  // An edge that points against the flow is reversed by ELK for layering, but routed out of the
  // far side of its source and back round, often round a whole container. Laying it out from
  // target to source instead gives it the short route the flow allows.
  const back = backEdges(drawn, abs, model.direction);
  if (back.size) {
    flipped = back;
    out = await elk.layout(graphFor(flipped));
    abs = positions(out);
  }

  const nodes: LaidOutNode[] = model.nodes.map((n) => {
    const p = abs.get(n.id)!;
    const label = labels.get(n.id);
    const cap = sizes.get(n.id)?.cap;
    const icon = fitted.get(n.id);
    let iconBox: LaidOutNode['icon'];
    if (icon) {
      const lh = label?.height ?? 0;
      const x = icon.place === 'corner' ? p.x + p.width - BOUND_TEXT_PADDING - ICON.cornerGap / 2 - icon.width : p.x + (p.width - icon.width) / 2;
      const y = icon.place === 'only' ? p.y : icon.place === 'corner' ? p.y + BOUND_TEXT_PADDING + Math.max(0, (lh - icon.height) / 2) : p.y + (cap ?? 0) + ICON.top;
      iconBox = { x: r(x), y: r(y), width: icon.width, height: icon.height, place: icon.place };
    }
    return {
      id: n.id,
      kind: n.kind,
      ...(n.name !== undefined ? { name: n.name } : {}),
      ...(n.parent ? { parent: n.parent } : {}),
      container: n.children.length > 0,
      x: r(p.x),
      y: r(p.y),
      width: r(p.width),
      height: r(p.height),
      ...(label ? { label } : {}),
      ...(cap !== undefined ? { cap } : {}),
      look: n.look,
      ...(iconBox ? { icon: iconBox } : {}),
    };
  });

  const elkEdges = new Map((out.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge & { container?: string }]));
  const edges: LaidOutEdge[] = drawn.map((e) => {
    const elkEdge = elkEdges.get(e.id);
    const sections = elkEdge?.sections ?? [];
    if (!sections.length) throw new Error(`ELK returned no route for edge ${e.id}`);
    const o = abs.get(elkEdge?.container ?? 'root') ?? abs.get('root')!;
    const points: Point[] = [];
    for (const s of sections) {
      for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) {
        const pt: Point = [r(o.x + p.x), r(o.y + p.y)];
        const last = points[points.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) points.push(pt);
      }
    }
    if (flipped.has(e.id)) points.reverse();
    const label = edgeLabels.get(e.id);
    const placed = elkEdge?.labels?.[0];
    const at = placed ? { x: r(o.x + (placed.x ?? 0) + (placed.width ?? 0) / 2), y: r(o.y + (placed.y ?? 0) + (placed.height ?? 0) / 2) } : undefined;
    return { id: e.id, from: e.from, to: e.to, points, ...(label && at ? { label: { ...label, ...at } } : {}), look: e.look };
  });
  separateLabels(edges, obstacles(nodes));
  return { nodes, edges };
}

type Box = { x: number; y: number; width: number; height: number };
type DrawnEdge = Pick<LaidOutEdge, 'id' | 'from' | 'to' | 'look'> & { label?: string };

/** Absolute boxes by ID: ELK positions are relative to the parent. */
function positions(out: ElkNode): Map<string, Box> {
  const abs = new Map<string, Box>([['root', { x: 0, y: 0, width: 0, height: 0 }]]);
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y, width: c.width ?? 0, height: c.height ?? 0 });
      walk(c, x, y);
    }
  };
  walk(out, 0, 0);
  return abs;
}

/** Edges whose source ends up after their target in the direction of flow. */
function backEdges(edges: readonly DrawnEdge[], abs: ReadonlyMap<string, Box>, direction: Direction): Set<string> {
  const along = (b: Box) => (direction === 'DOWN' ? b.y + b.height / 2 : b.x + b.width / 2);
  return new Set(edges.filter((e) => along(abs.get(e.from)!) > along(abs.get(e.to)!) + 1).map((e) => e.id));
}

/**
 * With `option edges bundle`: edges with the same ends, operator and look become one, with the
 * first edge's ID and their labels one under another.
 */
function bundle(edges: readonly ModelEdge[]): DrawnEdge[] {
  const groups = new Map<string, ModelEdge[]>();
  for (const e of edges) {
    const key = JSON.stringify([e.from, e.to, e.op, e.look]);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].map((g) => {
    const labels = [...new Set(g.flatMap((e) => (e.label === undefined ? [] : [e.label])))];
    const { id, from, to, look } = g[0]!;
    return { id, from, to, look, ...(labels.length ? { label: labels.join('\n') } : {}) };
  });
}

/** The distance along a polyline to the point nearest `p`, and the point at a distance. */
function along(points: readonly Point[]) {
  const seg = points.slice(1).map((b, i) => {
    const a = points[i]!;
    return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const total = seg.reduce((t, s) => t + s.len, 0);
  const at = (d: number): Point => {
    let rest = Math.max(0, Math.min(total, d));
    for (const s of seg) {
      if (rest <= s.len || s === seg[seg.length - 1]) {
        const t = s.len === 0 ? 0 : Math.min(1, rest / s.len);
        return [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])];
      }
      rest -= s.len;
    }
    return points[0]!;
  };
  const offsetOf = (p: Point): number => {
    let best = { d: Infinity, off: 0 };
    let start = 0;
    for (const s of seg) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const t = s.len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / (s.len * s.len)));
      const d = Math.hypot(s.a[0] + t * dx - p[0], s.a[1] + t * dy - p[1]);
      if (d < best.d) best = { d, off: start + t * s.len };
      start += s.len;
    }
    return best.off;
  };
  return { total, at, offsetOf };
}

const LABEL_GAP = 4;

/**
 * Excalidraw draws an arrow's label on its line, so labels of edges that run side by side can land
 * on each other. Taking edges in order, a label that overlaps one already placed, or a shape, is
 * slid along its own line to the nearest place that is clear, keeping clear of the line's ends.
 */
/**
 * What an arrow label must keep clear of: every leaf shape, and of each drawn container its border
 * and its title. A group is not drawn. Arrows cross containers, so their insides stay free.
 */
function obstacles(nodes: readonly LaidOutNode[]): Box[] {
  const EDGE = 2;
  return nodes.flatMap((n): Box[] => {
    if (!n.container) return [n];
    if (n.kind === 'group') return [];
    const title = (n.label?.height ?? 0) + 2 * BOUND_TEXT_PADDING;
    return [
      { x: n.x, y: n.y, width: n.width, height: Math.max(EDGE, title) },
      { x: n.x, y: n.y + n.height - EDGE, width: n.width, height: 2 * EDGE },
      { x: n.x - EDGE, y: n.y, width: 2 * EDGE, height: n.height },
      { x: n.x + n.width - EDGE, y: n.y, width: 2 * EDGE, height: n.height },
    ];
  });
}

function separateLabels(edges: LaidOutEdge[], shapes: readonly Box[]): void {
  const placed: Box[] = [];
  const boxAt = (p: Point, l: TextSize): Box => ({ x: p[0] - l.width / 2 - LABEL_GAP, y: p[1] - l.height / 2 - LABEL_GAP, width: l.width + 2 * LABEL_GAP, height: l.height + 2 * LABEL_GAP });
  const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const clear = (b: Box) => !placed.some((o) => hit(b, o)) && !shapes.some((s) => hit(b, s));
  for (const e of edges) {
    if (!e.label) continue;
    const line = along(e.points);
    const home = line.offsetOf([e.label.x, e.label.y]);
    // Keep the label off the arrowheads and the shapes at either end.
    const margin = Math.min(line.total / 2, Math.max(e.label.width, e.label.height) / 2 + 12);
    let chosen: Point = line.at(home);
    const step = 4;
    for (let k = 0; k * step <= line.total; k++) {
      const tries = k === 0 ? [home] : [home + k * step, home - k * step];
      const ok = tries.filter((d) => d >= margin && d <= line.total - margin).map((d) => line.at(d)).find((p) => clear(boxAt(p, e.label!)));
      if (ok) {
        chosen = ok;
        break;
      }
    }
    e.label.x = r(chosen[0]);
    e.label.y = r(chosen[1]);
    placed.push(boxAt(chosen, e.label));
  }
}
