// Turns parsed statements into a model: a tree of elements with unique IDs, resolved edges,
// and diagram options. Names in edges resolve nearest first (docs/notation.md).
import { Codes, type Diagnostic, error, type Range, warning } from './diagnostics.js';
import { distance, slug, unique } from './ids.js';
import type { Attrs, EdgeOp, EdgeStatement, ElementKind, Ref, Statement } from './parser.js';

export type NodeKind = ElementKind | 'group';

export interface ModelNode {
  id: string;
  kind: NodeKind;
  name?: string;
  /** The enclosing element's ID; undefined at the top level. */
  parent?: string;
  children: string[];
  attrs: Attrs;
}

export interface ModelEdge {
  id: string;
  from: string;
  to: string;
  op: EdgeOp;
  label?: string;
  attrs: Attrs;
}

export type Direction = 'RIGHT' | 'DOWN';

export interface Model {
  title?: string;
  direction: Direction;
  /** Every element in document order, so a parent always comes before its children. */
  nodes: ModelNode[];
  edges: ModelEdge[];
}

/** Attributes that later phases give meaning to (styling, icons, classes). */
const LATER_ATTRS = new Set([
  'icon', 'icon-only', 'class', 'fill', 'fill-style', 'stroke', 'stroke-width', 'stroke-style',
  'rough', 'rounded', 'opacity', 'font', 'font-size', 'text-color', 'text-align', 'color',
]);
/** Attributes with a meaning now. `doc` is stored for later use and not drawn. */
const KNOWN_ATTRS = new Set(['doc']);
const LATER_OPTIONS = new Set(['sketch', 'font', 'colors']);
const DIRECTIONS: Record<string, Direction> = { right: 'RIGHT', down: 'DOWN' };

/** Names match ignoring case and repeated whitespace, as in bpmn-text. */
const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase();

function checkAttrs(attrs: Attrs, range: Range, diagnostics: Diagnostic[]): void {
  const later = [...attrs.keys()].filter((k) => LATER_ATTRS.has(k));
  const unknown = [...attrs.keys()].filter((k) => !LATER_ATTRS.has(k) && !KNOWN_ATTRS.has(k));
  if (later.length) {
    diagnostics.push(warning(Codes.notYet, `${later.map((k) => `\`${k}\``).join(', ')} ${later.length > 1 ? 'are' : 'is'} not supported yet, so ${later.length > 1 ? 'they are' : 'it is'} ignored.`, range));
  }
  for (const k of unknown) diagnostics.push(warning(Codes.unknownAttr, `\`${k}\` is not an attribute arch-text knows, so it is ignored.`, range, 'Check the spelling; see docs/notation.md for the attributes.'));
}

export function resolve(statements: readonly Statement[]): { model: Model; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const model: Model = { direction: 'RIGHT', nodes: [], edges: [] };

  // Flatten the tree, remembering each element's parent and each edge's enclosing element.
  const elements: { st: Extract<Statement, { kind: 'element' }>; parent?: number }[] = [];
  const edges: { st: EdgeStatement; scope?: number }[] = [];
  const walk = (list: readonly Statement[], parent?: number) => {
    for (const st of list) {
      if (st.kind === 'element') {
        elements.push({ st, ...(parent !== undefined ? { parent } : {}) });
        walk(st.children, elements.length - 1);
      } else if (st.kind === 'edge') edges.push({ st, ...(parent !== undefined ? { scope: parent } : {}) });
      else if (st.kind === 'title') model.title = st.value;
      else if (st.kind === 'option') {
        if (st.key === 'direction') {
          const d = DIRECTIONS[st.value];
          if (d) model.direction = d;
          else diagnostics.push(error(Codes.badOption, `\`direction\` is \`right\` or \`down\`, not \`${st.value}\`.`, st.range));
        } else if (LATER_OPTIONS.has(st.key)) diagnostics.push(warning(Codes.notYet, `\`option ${st.key}\` is not supported yet, so it is ignored.`, st.range));
        else diagnostics.push(error(Codes.badOption, `There is no option called \`${st.key}\`.`, st.range, 'The options are direction, sketch, font and colors.'));
      } else if (st.kind === 'use') diagnostics.push(warning(Codes.notYet, `\`use ${st.what}\` is not supported yet, so it is ignored.`, st.range));
      else if (st.kind === 'style') diagnostics.push(warning(Codes.notYet, '`style` is not supported yet, so it is ignored.', st.range));
    }
  };
  walk(statements);

  // IDs: explicit ones first, so a generated ID never takes one somebody wrote.
  const taken = new Set<string>();
  const firstWithId = new Map<string, number>();
  elements.forEach(({ st }, i) => {
    if (!st.id) return;
    if (firstWithId.has(st.id)) diagnostics.push(error(Codes.duplicateId, `The ID \`@${st.id}\` is used more than once.`, st.range, 'Give each element its own ID.'));
    else firstWithId.set(st.id, i);
    taken.add(st.id);
  });
  const ids = elements.map(({ st }, i) => {
    if (st.id && firstWithId.get(st.id) === i) return st.id;
    // A repeated ID (already reported) still needs a unique one so the rest can be checked.
    return unique(st.id ?? slug(st.name ?? 'group'), taken);
  });
  elements.forEach(({ st, parent }, i) => {
    checkAttrs(st.attrs, st.range, diagnostics);
    model.nodes.push({
      id: ids[i]!,
      kind: st.type,
      ...(st.name !== undefined ? { name: st.name } : {}),
      ...(parent !== undefined ? { parent: ids[parent]! } : {}),
      children: [],
      attrs: st.attrs,
    });
  });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) if (n.parent) byId.get(n.parent)!.children.push(n.id);

  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) out.push(p);
    return out;
  };
  const subtree = (id: string | undefined): ModelNode[] => {
    if (id === undefined) return model.nodes;
    const out: ModelNode[] = [];
    const add = (n: ModelNode) => {
      out.push(n);
      n.children.forEach((c) => add(byId.get(c)!));
    };
    byId.get(id)!.children.forEach((c) => add(byId.get(c)!));
    return out;
  };

  /** Resolves a reference from inside `scope`: its own block first, then each enclosing block, then everywhere. */
  const lookup = (ref: Ref, scope: string | undefined): ModelNode | undefined => {
    if (ref.id !== undefined) {
      const n = byId.get(ref.id);
      if (n) return n;
    } else {
      for (const s of [scope, ...(scope ? ancestors(scope) : []), undefined].filter((v, i, a) => a.indexOf(v) === i)) {
        const matches = subtree(s).filter((n) => n.name !== undefined && sameName(n.name, ref.name!));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
          diagnostics.push(
            error(Codes.ambiguousReference, `More than one element is called "${ref.name}" here.`, ref.range, `Give the one you mean an ID, such as \`@${slug(ref.name!)}-1\`, and refer to it by that.`),
          );
          return undefined;
        }
      }
    }
    const shown = ref.id !== undefined ? `@${ref.id}` : ref.name!;
    const candidates = model.nodes.flatMap((n) => [...(n.name ? [n.name] : []), `@${n.id}`]);
    const best = candidates.map((c) => ({ c, d: distance(c.toLowerCase(), shown.toLowerCase()) })).sort((a, b) => a.d - b.d)[0];
    const hint = best && best.d <= Math.max(2, Math.floor(shown.length / 3)) ? `Did you mean "${best.c}"?` : 'Declare it first, for example with `system`.';
    diagnostics.push(error(Codes.unknownReference, `Nothing is called "${shown}".`, ref.range, hint));
    return undefined;
  };

  const edgeIds = new Set<string>();
  for (const { st, scope } of edges) {
    checkAttrs(st.attrs, st.range, diagnostics);
    const scopeId = scope !== undefined ? ids[scope] : undefined;
    const ends = st.refs.map((r) => {
      const n = lookup(r, scopeId);
      if (n?.kind === 'group') {
        diagnostics.push(error(Codes.groupEdge, 'Edges cannot start or end on a group, because a group is not drawn.', r.range, 'Connect to an element inside the group, or make it a boundary.'));
        return undefined;
      }
      return n;
    });
    st.ops.forEach((op, k) => {
      const from = ends[k];
      const to = ends[k + 1];
      if (!from || !to) return;
      if (from === to) {
        diagnostics.push(warning(Codes.selfEdge, 'Edges from an element to itself are not supported yet, so this one is left out.', st.range));
        return;
      }
      if (ancestors(from.id).includes(to.id) || ancestors(to.id).includes(from.id)) {
        diagnostics.push(
          warning(Codes.containerEdge, 'Edges between a container and something inside it are not supported, so this one is left out.', st.range, 'Connect to the element inside, or to something outside the container.'),
        );
        return;
      }
      model.edges.push({ id: unique(`${from.id}->${to.id}`, edgeIds), from: from.id, to: to.id, op, ...(st.label !== undefined ? { label: st.label } : {}), attrs: st.attrs });
    });
  }

  return { model, diagnostics };
}
