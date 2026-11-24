// The build pipeline: parse, resolve (with styles), load icons, size and lay out, emit.
import path from 'node:path';
import { type Diagnostic, hasErrors } from './diagnostics.js';
import { emit, type Scene } from './emit.js';
import { loadIcons } from './icons.js';
import { layout } from './layout.js';
import { resolve } from './model.js';
import { parse } from './parser.js';

export interface BuildOptions {
  /**
   * The source file's path. Icon libraries and image files are found relative to its folder;
   * without it, relative to the current folder.
   */
  file?: string;
}

export interface BuildResult {
  /** The scene, or undefined when there are errors. */
  scene?: Scene;
  diagnostics: Diagnostic[];
}

const byPosition = (a: Diagnostic, b: Diagnostic) => a.range.line - b.range.line || a.range.col - b.range.col;

/** Compiles `.archt` source to an Excalidraw scene. Never throws on errors in the source. */
export async function build(source: string, options: BuildOptions = {}): Promise<BuildResult> {
  const parsed = parse(source);
  const resolved = resolve(parsed.statements);
  let diagnostics = [...parsed.diagnostics, ...resolved.diagnostics].sort(byPosition);
  if (hasErrors(diagnostics)) return { diagnostics };
  const icons = loadIcons(resolved.model, options.file ? path.dirname(path.resolve(options.file)) : process.cwd());
  diagnostics = [...diagnostics, ...icons.diagnostics].sort(byPosition);
  if (hasErrors(diagnostics)) return { diagnostics };
  const ops = new Map(resolved.model.edges.map((e) => [e.id, e.op]));
  return { scene: emit(await layout(resolved.model, icons.byNode), ops, icons), diagnostics };
}

/** The scene as file text: two-space JSON with a final newline, the same on every platform. */
export function serialise(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}
