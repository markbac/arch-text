// Turns parsed statements into a model: a tree of elements with unique IDs, resolved edges,
// and diagram options. Names in edges resolve nearest first (docs/notation.md).
import { Codes, type Diagnostic, error, type Range, warning } from './diagnostics.js';
import { distance, slug, unique } from './ids.js';
import type { Attrs, EdgeOp, EdgeStatement, ElementKind, Ref, Statement } from './parser.js';
import { checkLabel, classesOf, DEFAULT_OPTIONS, FONT_NAMES, type Look, lookFor, type Options, readAttrs, readRule, SKETCH, type StyleRule } from './style.js';
import type { FontName } from './text.js';

export type NodeKind = ElementKind | 'group';

export interface ModelNode {
  id: string;
  kind: NodeKind;
  name?: string;
  /** The enclosing element's ID; undefined at the top level. */
  parent?: string;
  children: string[];
  attrs: Attrs;
  /** How it is drawn, after options, style rules and its own attributes. */
  look: Look;
  range: Range;
}

export interface ModelEdge {
  id: string;
  from: string;
  to: string;
  op: EdgeOp;
  label?: string;
  attrs: Attrs;
  look: Look;
  range: Range;
}

/** An icon library named by `use icons`. */
export interface Library {
  path: string;
  range: Range;
}

export type Direction = 'RIGHT' | 'DOWN';

export interface Model {
  title?: string;
  direction: Direction;
  /** Every element in document order, so a parent always comes before its children. */
  nodes: ModelNode[];
  edges: ModelEdge[];
  options: Options;
  /** Icon libraries in the order they were named. */
  libraries: Library[];
}

const DIRECTIONS: Record<string, Direction> = { right: 'RIGHT', down: 'DOWN' };

/** Operators with their only arrowhead at the start, and the operator for the edge turned round. */
const REVERSED: Partial<Record<EdgeOp, EdgeOp>> = { '<-': '->', '<..': '..>', '<==': '==>' };

/** Names match ignoring case and repeated whitespace, as in bpmn-text. */
const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase();

/** Sets an option from `option <key> <value>`, or reports why it cannot. */
function setOption(model: Model, key: string, value: string, range: Range, diagnostics: Diagnostic[]): void {
  const v = value.toLowerCase();
  const bad = (choices: string) => diagnostics.push(error(Codes.badOption, `\`${key}\` is ${choices}, not \`${value}\`.`, range));
  if (key === 'direction') {
    const d = DIRECTIONS[v];
    if (d) model.direction = d;
    else bad('`right` or `down`');
  } else if (key === 'sketch') {
    if (v in SKETCH) model.options.roughness = SKETCH[v]!;
    else bad('`clean`, `artist` or `cartoon`');
  } else if (key === 'font') {
    if ((FONT_NAMES as readonly string[]).includes(v)) model.options.font = v as FontName;
    else bad('`hand`, `normal` or `code`');
  } else if (key === 'colors' || key === 'colours') {
    if (v === 'none' || v === 'types') model.options.colors = v;
    else bad('`none` or `types`');
  } else if (key === 'edges') {
    if (v === 'bundle' || v === 'separate') model.options.bundle = v === 'bundle';
    else bad('`separate` or `bundle`');
  } else diagnostics.push(error(Codes.badOption, `There is no option called \`${key}\`.`, range, 'The options are direction, sketch, font, colors and edges.'));
}

export function resolve(statements: readonly Statement[]): { model: Model; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const model: Model = { direction: 'RIGHT', nodes: [], edges: [], options: { ...DEFAULT_OPTIONS }, libraries: [] };
  const rules: StyleRule[] = [];

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
      else if (st.kind === 'option') setOption(model, st.key, st.value, st.range, diagnostics);
      else if (st.kind === 'use') {
        if (st.what === 'icons') model.libraries.push({ path: st.path, range: st.range });
        else diagnostics.push(error(Codes.badLibrary, `arch-text can use icons, not \`${st.what}\`.`, st.range, 'Write `use icons <file.excalidrawlib>`.'));
      } else if (st.kind === 'style') {
        const rule = readRule(st.selector, st.attrs, st.range, diagnostics);
        if (rule) rules.push(rule);
      }
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
  const own = elements.map(({ st }) => {
    checkLabel(st.name, st.range, diagnostics);
    return readAttrs(st.attrs, st.type === 'group' ? 'group' : 'element', st.range, diagnostics);
  });
  elements.forEach(({ st, parent }, i) => {
    model.nodes.push({
      id: ids[i]!,
      kind: st.type,
      ...(st.name !== undefined ? { name: st.name } : {}),
      ...(parent !== undefined ? { parent: ids[parent]! } : {}),
      children: [],
      attrs: st.attrs,
      look: undefined as unknown as Look,
      range: st.range,
    });
  });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) if (n.parent) byId.get(n.parent)!.children.push(n.id);
  // Looks depend on which elements are containers, so they come once the tree is complete.
  model.nodes.forEach((n, i) => {
    n.look = lookFor(n.kind, n.children.length > 0, classesOf(n.attrs), own[i]!, rules, model.options);
    if (n.look.iconOnly && !n.look.icon) {
      diagnostics.push(warning(Codes.notApplicable, '`icon-only` needs an `icon`, so it is ignored.', n.range, 'For example: `[icon: chip, icon-only]`.'));
      n.look.iconOnly = false;
    } else if (n.look.iconOnly && (n.children.length > 0 || n.kind === 'boundary')) {
      diagnostics.push(warning(Codes.notApplicable, `\`icon-only\` does not apply to a ${n.children.length ? 'container' : 'boundary'}, so its icon goes in the top corner.`, n.range));
      n.look.iconOnly = false;
    }
  });

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
    checkLabel(st.label, st.range, diagnostics);
    const ownLook = readAttrs(st.attrs, 'edge', st.range, diagnostics);
    const scopeId = scope !== undefined ? ids[scope] : undefined;
    const ends = st.refs.map((r) => {
      const n = lookup(r, scopeId);
      if (n?.kind === 'group') {
        diagnostics.push(error(Codes.groupEdge, 'Edges cannot start or end on a group, because a group is not drawn.', r.range, 'Connect to an element inside the group, or make it a boundary.'));
        return undefined;
      }
      return n;
    });
    st.ops.forEach((written, k) => {
      // An edge with its only arrowhead at the start, such as `A <- B`, is the edge `B -> A`.
      const reversed = REVERSED[written];
      const op = reversed ?? written;
      const from = reversed ? ends[k + 1] : ends[k];
      const to = reversed ? ends[k] : ends[k + 1];
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
      // The operator's line, dashed for `..` and thick for `==`, sits between the defaults and the
      // rules, so a rule or an attribute can still change it.
      const look = lookFor('edge', false, classesOf(st.attrs), ownLook, rules, model.options, op.includes('.') ? { strokeStyle: 'dashed' } : op.includes('=') ? { strokeWidth: 4 } : {});
      model.edges.push({
        id: unique(`${from.id}->${to.id}`, edgeIds),
        from: from.id,
        to: to.id,
        op,
        ...(st.label !== undefined ? { label: st.label } : {}),
        attrs: st.attrs,
        look,
        range: st.range,
      });
    });
  }

  return { model, diagnostics };
}
