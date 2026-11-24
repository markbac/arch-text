/** A position range on one line: 1-based line and columns, `endCol` exclusive. */
export interface Range {
  line: number;
  col: number;
  endCol: number;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  range: Range;
  /** A suggested fix, shown after the message. */
  hint?: string;
}

/**
 * Diagnostic codes. Errors stop `build` writing output; warnings do not.
 * See the README for an example of each.
 */
export const Codes = {
  /** A tab in the indentation. */
  tab: 'AT001',
  /** An indented line with no block to belong to. */
  indent: 'AT002',
  /** A statement that needs a name has none. */
  missingName: 'AT003',
  /** No longer reported: it marked features planned for a later phase, all of which now exist. */
  notYet: 'AT004',
  /** A line that is not a statement. */
  unknownStatement: 'AT005',
  /** A string with no closing quote. */
  unterminatedString: 'AT006',
  /** Two elements with the same explicit `@id`. */
  duplicateId: 'AT007',
  /** An edge endpoint that names no element. */
  unknownReference: 'AT008',
  /** An edge endpoint whose name matches more than one element. */
  ambiguousReference: 'AT009',
  /** An edge from an element to itself (skipped). */
  selfEdge: 'AT010',
  /** Text after the end of a statement. */
  trailingText: 'AT011',
  /** Elements indented under an actor or datastore. */
  noChildren: 'AT012',
  /** An attribute arch-text does not know (ignored). */
  unknownAttr: 'AT013',
  /** A line indented to a level no enclosing block uses. */
  dedent: 'AT014',
  /** A chain such as `A -> B -> C` with a label. */
  chainLabel: 'AT015',
  /** A group with nothing in it. */
  emptyGroup: 'AT016',
  /** An edge to or from a group, which is not drawn. */
  groupEdge: 'AT017',
  /** An edge between a container and something inside it (skipped). */
  containerEdge: 'AT018',
  /** An unknown option, or a value an option does not take. */
  badOption: 'AT019',
  /** `title`, `option`, `use` or `style` inside a block. */
  notTopLevel: 'AT020',
  /** A `[` with no closing `]`. */
  unclosedAttrs: 'AT021',
  /** Bold, italic or underline markup in a label, which Excalidraw draws as typed. */
  richText: 'AT022',
  /** An attribute value that the attribute does not take (ignored). */
  badValue: 'AT023',
  /** An attribute where it has no meaning, such as `fill` on an edge (ignored). */
  notApplicable: 'AT024',
  /** A `style` rule for something that cannot be styled. */
  badSelector: 'AT025',
  /** A `use` statement whose file cannot be read, or that uses something other than icons. */
  badLibrary: 'AT026',
  /** An `icon` naming no library item or no image file. */
  unknownIcon: 'AT027',
} as const;

export function error(code: string, message: string, range: Range, hint?: string): Diagnostic {
  return { code, severity: 'error', message, range, ...(hint ? { hint } : {}) };
}

export function warning(code: string, message: string, range: Range, hint?: string): Diagnostic {
  return { code, severity: 'warning', message, range, ...(hint ? { hint } : {}) };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
