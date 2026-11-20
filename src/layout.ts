// Sizes elements from their labels and shapes, and lays the whole tree out with ELK in one pass
// (hierarchical layered layout), so edges between nested elements are routed together.
import { createRequire } from 'node:module';
import type { ELK as ElkInstance, ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { Direction, Model, NodeKind } from './model.js';
import { measure, type TextSize } from './text.js';

// elkjs is CommonJS; TypeScript's NodeNext typing of its default export is wrong, so load it with require.
const ELK = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js') as new () => ElkInstance;

export const NODE_FONT_SIZE = 20;
export const EDGE_FONT_SIZE = 16;
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
}

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  /** Absolute points from source border to target border. */
  points: Point[];
  /** The label and its centre, where ELK made room for it. */
  label?: { text: string; x: number; y: number } & TextSize;
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

/** The size of a leaf element, from its label and shape. */
function leafSize(kind: NodeKind, label: TextSize | undefined): { width: number; height: number; cap?: number } {
  const lw = label?.width ?? 0;
  const lh = label?.height ?? 0;
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

export async function layout(model: Model): Promise<Layout> {
  const labels = new Map(model.nodes.map((n) => [n.id, n.name === undefined ? undefined : measure(n.name, NODE_FONT_SIZE)]));
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { width: number; height: number; cap?: number }>();

  const edgeLabels = new Map(model.edges.map((e) => [e.id, e.label === undefined ? undefined : { text: e.label, ...measure(e.label, EDGE_FONT_SIZE) }]));
  const widestLabel = Math.max(0, ...[...edgeLabels.values()].map((l) => l?.width ?? 0));

  const toElk = (id: string): ElkNode => {
    const n = byId.get(id)!;
    const label = labels.get(id);
    if (!n.children.length) {
      const size = leafSize(n.kind, label);
      sizes.set(id, size);
      return { id, width: size.width, height: size.height };
    }
    const isGroup = n.kind === 'group';
    const top = isGroup ? GROUP_PAD : Math.ceil(BOUND_TEXT_PADDING + (label?.height ?? 0) + CONTAINER_PAD / 2);
    const side = isGroup ? GROUP_PAD : CONTAINER_PAD;
    const minWidth = Math.ceil((label?.width ?? 0) + 2 * (BOUND_TEXT_PADDING + side));
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
    return { id: e.id, from: e.from, to: e.to, points, ...(label && at ? { label: { ...label, ...at } } : {}) };
  });
  return { nodes, edges };
}
