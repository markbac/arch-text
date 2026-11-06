// Sizes nodes from their labels and lays the graph out with ELK.
// Phase 2: a flat graph of systems, left to right, with orthogonal edges.
import { createRequire } from 'node:module';
import type { ELK as ElkInstance, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';
import type { Model } from './model.js';
import { measure, type TextSize } from './text.js';

// elkjs is CommonJS; TypeScript's NodeNext typing of its default export is wrong, so load it with require.
const ELK = createRequire(import.meta.url)('elkjs/lib/elk.bundled.js') as new () => ElkInstance;

export const NODE_FONT_SIZE = 20;
export const EDGE_FONT_SIZE = 16;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
const PAD_X = 24;
const PAD_Y = 20;

export type Point = [number, number];

export interface LaidOutNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: TextSize;
}

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  /** Absolute points from source border to target border. */
  points: Point[];
  label?: { text: string } & TextSize;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.edgeLabel': '6',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/** Rounds to 2 decimal places, so output does not carry floating-point noise. */
const r = (v: number) => Math.round(v * 100) / 100;

export async function layout(model: Model): Promise<Layout> {
  const sized = model.nodes.map((n) => {
    const label = measure(n.name, NODE_FONT_SIZE);
    return {
      ...n,
      label,
      width: Math.max(MIN_WIDTH, Math.ceil(label.width + 2 * PAD_X)),
      height: Math.max(MIN_HEIGHT, Math.ceil(label.height + 2 * PAD_Y)),
    };
  });
  const edgeLabels = new Map(model.edges.map((e) => [e.id, e.label === undefined ? undefined : { text: e.label, ...measure(e.label, EDGE_FONT_SIZE) }]));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: sized.map((n) => ({ id: n.id, width: n.width, height: n.height })),
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

  const pos = new Map((out.children ?? []).map((c) => [c.id, c]));
  const nodes = sized.map((n) => {
    const p = pos.get(n.id)!;
    return { id: n.id, name: n.name, x: r(p.x ?? 0), y: r(p.y ?? 0), width: n.width, height: n.height, label: n.label };
  });
  const edges = model.edges.map((e) => {
    const section = out.edges?.find((x) => x.id === e.id)?.sections?.[0];
    if (!section) throw new Error(`ELK returned no route for edge ${e.id}`);
    const points: Point[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => [r(p.x), r(p.y)]);
    const label = edgeLabels.get(e.id);
    return { id: e.id, from: e.from, to: e.to, points, ...(label ? { label } : {}) };
  });
  return { nodes, edges };
}
