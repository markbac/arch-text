// The build pipeline: parse, resolve, size and lay out, emit.
import { type Diagnostic, hasErrors } from './diagnostics.js';
import { emit, type Scene } from './emit.js';
import { layout } from './layout.js';
import { resolve } from './model.js';
import { parse } from './parser.js';

export interface BuildResult {
  /** The scene, or undefined when there are errors. */
  scene?: Scene;
  diagnostics: Diagnostic[];
}

/** Compiles `.archt` source to an Excalidraw scene. Never throws on errors in the source. */
export async function build(source: string): Promise<BuildResult> {
  const parsed = parse(source);
  const resolved = resolve(parsed.statements);
  const diagnostics = [...parsed.diagnostics, ...resolved.diagnostics].sort((a, b) => a.range.line - b.range.line || a.range.col - b.range.col);
  if (hasErrors(diagnostics)) return { diagnostics };
  return { scene: emit(await layout(resolved.model)), diagnostics };
}

/** The scene as file text: two-space JSON with a final newline, the same on every platform. */
export function serialise(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}
