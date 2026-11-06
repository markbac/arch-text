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
  /** An indented line: blocks are not supported yet. */
  indent: 'AT002',
  /** A statement that needs a name has none. */
  missingName: 'AT003',
  /** A keyword or edge kind that is planned but not supported yet. */
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
