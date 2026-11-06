// Turns parsed statements into a model: unique IDs and resolved edge endpoints.
import { Codes, type Diagnostic, error, warning } from './diagnostics.js';
import { distance, slug, unique } from './ids.js';
import type { Ref, Statement } from './parser.js';

export interface ModelNode {
  id: string;
  kind: 'system';
  name: string;
}

export interface ModelEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface Model {
  title?: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
}

export function resolve(statements: readonly Statement[]): { model: Model; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const model: Model = { nodes: [], edges: [] };
  const taken = new Set<string>();

  // Explicit IDs first, so a generated ID never takes a name someone wrote.
  const explicit = new Set<string>();
  for (const st of statements) {
    if (st.kind !== 'system' || !st.id) continue;
    if (explicit.has(st.id)) {
      diagnostics.push(error(Codes.duplicateId, `The ID \`@${st.id}\` is used more than once.`, st.range, 'Give each element its own ID.'));
    }
    explicit.add(st.id);
  }
  explicit.forEach((id) => taken.add(id));

  for (const st of statements) {
    if (st.kind === 'title') model.title = st.value;
    if (st.kind === 'system') {
      const id = st.id ?? unique(slug(st.name), taken);
      if (st.id && model.nodes.some((n) => n.id === st.id)) continue;
      model.nodes.push({ id, kind: 'system', name: st.name });
    }
  }

  const lookup = (ref: Ref): string | undefined => {
    const matches = ref.id !== undefined ? model.nodes.filter((n) => n.id === ref.id) : model.nodes.filter((n) => n.name === ref.name);
    if (matches.length === 1) return matches[0]!.id;
    const shown = ref.id !== undefined ? `@${ref.id}` : ref.name!;
    if (matches.length > 1) {
      diagnostics.push(
        error(Codes.ambiguousReference, `More than one element is called "${shown}".`, ref.range, `Give one an ID, such as \`system ${shown} @${slug(shown)}-2\`, and refer to it by that.`),
      );
      return undefined;
    }
    const candidates = model.nodes.flatMap((n) => [n.name, `@${n.id}`]);
    const best = candidates.map((c) => ({ c, d: distance(c.toLowerCase(), shown.toLowerCase()) })).sort((a, b) => a.d - b.d)[0];
    const hint = best && best.d <= Math.max(2, Math.floor(shown.length / 3)) ? `Did you mean "${best.c}"?` : 'Declare it first, for example with `system`.';
    diagnostics.push(error(Codes.unknownReference, `Nothing is called "${shown}".`, ref.range, hint));
    return undefined;
  };

  const edgeIds = new Set<string>();
  for (const st of statements) {
    if (st.kind !== 'edge') continue;
    const from = lookup(st.from);
    const to = lookup(st.to);
    if (!from || !to) continue;
    if (from === to) {
      diagnostics.push(warning(Codes.selfEdge, 'Edges from an element to itself are not supported yet, so this one is left out.', st.range));
      continue;
    }
    model.edges.push({ id: unique(`${from}->${to}`, edgeIds), from, to, ...(st.label ? { label: st.label } : {}) });
  }

  return { model, diagnostics };
}
