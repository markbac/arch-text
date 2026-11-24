// Sizes elements from their labels and shapes, and lays the whole tree out with ELK in one pass
// (hierarchical layered layout), so edges between nested elements are routed together.
import { createRequire } from 'node:module';
import type { ELK as ElkInstance, ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { LoadedIcon } from './icons.js';
import type { Direction, Model, NodeKind } from './model.js';
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

  const edgeLabels = new Map(model.edges.map((e) => [e.id, e.label === undefined ? undefined : { text: e.label, ...measure(e.label, e.look.fontSize, FONTS[e.look.font]) }]));
  const widestLabel = Math.max(0, ...[...edgeLabels.values()].map((l) => l?.width ?? 0));

  const toElk = (id: string): ElkNode => {
    const n = byId.get(id)!;
    const label = labels.get(id);
    const icon = fitted.get(id);
    if (!n.children.length) {
      const size = leafSize(n.kind, label, icon);
      sizes.set(id, size);
      return { id, width: size.width, height: size.height };
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

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: rootOptions(model.direction, widestLabel),
    children: model.nodes.filter((n) => !n.parent).map((n) => toElk(n.id)),
    edges: model.edges.map((e) => {
      const label = edgeLabels.get(e.id);
      return {
        id: e.id,
        sources: [e.from],
        targets: [e.to],
        labels: label ? [{ id: `${e.id}:label`, text: label.text, width: Math.ceil(label.width), height: Math.ceil(label.height) }] : [],
      };
    }),
  };
  const out = await new ELK().layout(graph);

  // ELK positions are relative to the parent; edge points are relative to the edge's container.
  const abs = new Map<string, { x: number; y: number; width: number; height: number }>([['root', { x: 0, y: 0, width: 0, height: 0 }]]);
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y, width: c.width ?? 0, height: c.height ?? 0 });
      walk(c, x, y);
    }
  };
  walk(out, 0, 0);

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
  const edges: LaidOutEdge[] = model.edges.map((e) => {
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
    const label = edgeLabels.get(e.id);
    const placed = elkEdge?.labels?.[0];
    const at = placed ? { x: r(o.x + (placed.x ?? 0) + (placed.width ?? 0) / 2), y: r(o.y + (placed.y ?? 0) + (placed.height ?? 0) / 2) } : undefined;
    return { id: e.id, from: e.from, to: e.to, points, ...(label && at ? { label: { ...label, ...at } } : {}), look: e.look };
  });
  return { nodes, edges };
}
