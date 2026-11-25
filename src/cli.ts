#!/usr/bin/env node
// arch-text command line: `build` (.archt to .excalidraw) and `export` (.excalidraw to SVG or PNG).
// Exit codes: 0 success (warnings allowed), 1 input or export errors, 2 usage errors.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { glob } from 'tinyglobby';
import { build, serialise } from './build.js';
import type { Diagnostic } from './diagnostics.js';
import type { Scene } from './emit.js';
import { ExportError, type Exporter, type ExportOptions, openExporter } from './exporter.js';

const VERSION = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const HELP = `arch-text ${VERSION}: architecture diagrams as text, compiled to Excalidraw

Usage:
  arch-text build <input.archt>... [-o <file|dir>]
  arch-text export <input.excalidraw>... -f svg|png [-o <file|dir>] [options]
  arch-text render <input.archt>... [-f svg,png,excalidraw] [--check] [options]

Commands:
  build     Compile .archt files to .excalidraw scenes. With one input and no -o,
            the scene goes to standard output; with several, each is written
            beside its input.
  export    Export .excalidraw scenes to SVG or PNG, offline, with headless Chromium.
            The scene is embedded, so exports reopen in Excalidraw for editing.
            Without -o, each is written beside its input.
  render    Build and export in one step, writing each output beside its .archt
            file, and only when it changed. With --check, write nothing and exit 1
            if any output is missing or out of date: for CI in a docs repository.

Options:
  -o, --output <path>   Output file, or a directory for several inputs (created if missing)
  -f, --format <fmt>    export: svg or png (default: from the -o extension, else svg)
                        render: a comma-separated list of svg, png and excalidraw
                        (default svg)
      --check           render: report outputs that are out of date, write nothing
      --scale <n>       export: PNG pixel ratio (default 1)
      --padding <px>    export: space around the drawing (default 16)
      --no-background   export: transparent background
      --dark            export: Excalidraw's dark mode
  -h, --help            Show this help
  -v, --version         Show the version

Inputs may be glob patterns, such as "docs/**/*.archt" (quote them).

Environment:
  ARCH_TEXT_CHROMIUM    Chromium or Chrome binary for export (default: Playwright's copy)
  NO_COLOR              Turn off colour

Exit codes: 0 success (warnings allowed), 1 errors in an input or export, or outputs
out of date with render --check, 2 usage errors.`;

class UsageError extends Error {}

const useColour = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint('31');
const yellow = paint('33');
const dim = paint('2');
const bold = paint('1');

/** `file:line:col: error AT008: message`, the source line with a caret under the range, and the hint. */
export function formatDiagnostic(file: string, source: string, d: Diagnostic): string {
  const { line, col, endCol } = d.range;
  const text = source.split(/\r?\n/)[line - 1] ?? '';
  const gutter = String(line).length;
  const sev = d.severity === 'error' ? red(bold('error')) : yellow(bold('warning'));
  const caret = (d.severity === 'error' ? red : yellow)('^'.repeat(Math.max(1, endCol - col)));
  return [
    `${bold(`${file}:${line}:${col}`)}: ${sev} ${d.code}: ${d.message}`,
    `${dim(`${' '.repeat(gutter)} |`)}`,
    `${dim(`${line} |`)} ${text}`,
    `${dim(`${' '.repeat(gutter)} |`)} ${' '.repeat(col - 1)}${caret}`,
    ...(d.hint ? [`${dim(`${' '.repeat(gutter)} =`)} ${d.hint}`] : []),
  ].join('\n');
}

async function expandInputs(patterns: string[]): Promise<string[]> {
  if (!patterns.length) throw new UsageError('No input files given.');
  const files: string[] = [];
  for (const p of patterns) {
    if (fs.existsSync(p)) {
      files.push(p);
      continue;
    }
    // Glob from the pattern's fixed leading folders: tinyglobby crawls from the root for absolute patterns.
    const parts = p.replace(/\\/g, '/').split('/');
    const firstWild = parts.findIndex((s) => /[*?[\]{}]/.test(s));
    const base = parts.slice(0, firstWild).join('/') || (p.startsWith('/') ? '/' : '.');
    const rest = parts.slice(firstWild).join('/');
    const matches = firstWild === -1 ? [] : (await glob(rest, { cwd: base, onlyFiles: true })).map((m) => path.join(base, m)).sort();
    if (!matches.length) throw new UsageError(`No files match "${p}".`);
    files.push(...matches);
  }
  return [...new Set(files)];
}

/** Where each input's output goes: a file, a directory, or standard output (undefined). */
function outputPaths(inputs: string[], output: string | undefined, ext: string): (string | undefined)[] {
  const isDir = output !== undefined && (inputs.length > 1 || /[\\/]$/.test(output) || (fs.existsSync(output) && fs.statSync(output).isDirectory()));
  if (output === undefined) {
    if (ext === '.excalidraw' && inputs.length === 1) return [undefined];
    return inputs.map((f) => path.join(path.dirname(f), path.basename(f, path.extname(f)) + ext));
  }
  if (!isDir) return [output];
  fs.mkdirSync(output, { recursive: true });
  return inputs.map((f) => path.join(output, path.basename(f, path.extname(f)) + ext));
}

function write(file: string | undefined, data: string | Buffer): void {
  if (file === undefined) {
    process.stdout.write(data);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, data);
}

async function runBuild(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { output: { type: 'string', short: 'o' } } });
  const inputs = await expandInputs(positionals);
  const outputs = outputPaths(inputs, values.output, '.excalidraw');
  let failed = false;
  for (const [i, file] of inputs.entries()) {
    const source = fs.readFileSync(file, 'utf8');
    const { scene, diagnostics } = await build(source, { file });
    for (const d of diagnostics) console.error(formatDiagnostic(file, source, d));
    if (!scene) {
      failed = true;
      continue;
    }
    write(outputs[i], serialise(scene));
    if (outputs[i] !== undefined) console.error(dim(`${file} -> ${outputs[i]}`));
  }
  return failed ? 1 : 0;
}

function number(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${name} needs a positive number, not "${value}".`);
  return n;
}

const EXPORT_ARGS = {
  format: { type: 'string', short: 'f' },
  scale: { type: 'string' },
  padding: { type: 'string' },
  'no-background': { type: 'boolean' },
  dark: { type: 'boolean' },
} as const;

/** The export options shared by `export` and `render`. */
function exportOptions(values: { scale?: string; padding?: string; 'no-background'?: boolean; dark?: boolean }): ExportOptions {
  const options = {
    scale: number('scale', values.scale, 1),
    padding: values.padding === undefined ? 16 : Number(values.padding),
    background: !values['no-background'],
    dark: values.dark === true,
  };
  if (!Number.isFinite(options.padding) || options.padding < 0) throw new UsageError(`--padding needs a number of px, not "${values.padding}".`);
  return options;
}

async function runExport(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { output: { type: 'string', short: 'o' }, ...EXPORT_ARGS } });
  const fromExt = values.output && /\.(svg|png)$/i.exec(values.output)?.[1]?.toLowerCase();
  const format = (values.format ?? fromExt ?? 'svg').toLowerCase();
  if (format !== 'svg' && format !== 'png') throw new UsageError(`--format must be svg or png, not "${values.format}".`);
  const options = exportOptions(values);

  const inputs = await expandInputs(positionals);
  const outputs = outputPaths(inputs, values.output, `.${format}`);
  const scenes: Scene[] = [];
  for (const file of inputs) {
    try {
      const scene = JSON.parse(fs.readFileSync(file, 'utf8')) as Scene;
      if (scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) throw new Error('not an Excalidraw scene');
      scenes.push(scene);
    } catch (e) {
      console.error(`${bold(file)}: ${red(bold('error'))}: cannot read it as an .excalidraw file (${(e as Error).message}).`);
      return 1;
    }
  }

  let ex: Exporter | undefined;
  try {
    ex = await openExporter();
    for (const [i, scene] of scenes.entries()) {
      write(outputs[i], format === 'svg' ? await ex.svg(scene, options) : await ex.png(scene, options));
      console.error(dim(`${inputs[i]} -> ${outputs[i]}`));
    }
    return 0;
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    console.error(`${red(bold('error'))}: ${e.message}`);
    return 1;
  } finally {
    await ex?.close();
  }
}

const RENDER_FORMATS = ['svg', 'png', 'excalidraw'] as const;
type RenderFormat = (typeof RENDER_FORMATS)[number];

/** Whether `file` already holds exactly `data`. */
function same(file: string, data: string | Buffer): boolean {
  if (!fs.existsSync(file)) return false;
  const existing = fs.readFileSync(file);
  return existing.equals(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
}

async function runRender(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { ...EXPORT_ARGS, check: { type: 'boolean' } } });
  const formats = [...new Set((values.format ?? 'svg').toLowerCase().split(',').map((f) => f.trim()).filter(Boolean))];
  const bad = formats.filter((f) => !(RENDER_FORMATS as readonly string[]).includes(f));
  if (!formats.length || bad.length) throw new UsageError(`--format takes svg, png and excalidraw, separated by commas, not "${values.format}".`);
  const options = exportOptions(values);
  const check = values.check === true;
  const inputs = await expandInputs(positionals);

  let failed = false;
  const stale: string[] = [];
  let ex: Exporter | undefined;
  try {
    for (const file of inputs) {
      const source = fs.readFileSync(file, 'utf8');
      const { scene, diagnostics } = await build(source, { file });
      for (const d of diagnostics) console.error(formatDiagnostic(file, source, d));
      if (!scene) {
        failed = true;
        continue;
      }
      const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
      for (const format of formats as RenderFormat[]) {
        const out = `${base}.${format}`;
        if (format !== 'excalidraw') ex ??= await openExporter();
        const data = format === 'excalidraw' ? serialise(scene) : format === 'svg' ? await ex!.svg(scene, options) : await ex!.png(scene, options);
        if (same(out, data)) continue;
        if (check) {
          stale.push(out);
          console.error(`${fs.existsSync(out) ? 'out of date' : 'missing'}: ${out}`);
        } else {
          write(out, data);
          console.error(dim(`${file} -> ${out}`));
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    console.error(`${red(bold('error'))}: ${e.message}`);
    return 1;
  } finally {
    await ex?.close();
  }
  if (stale.length) {
    console.error(`${red(bold('error'))}: ${stale.length} diagram output${stale.length > 1 ? 's are' : ' is'} out of date. Run \`arch-text render\` without --check to update them.`);
    return 1;
  }
  return failed ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === '-h' || command === '--help' || rest.includes('-h') || rest.includes('--help')) {
      (command === undefined ? console.error : console.log)(HELP);
      return command === undefined ? 2 : 0;
    }
    if (command === '-v' || command === '--version') {
      console.log(VERSION);
      return 0;
    }
    if (command === 'build') return await runBuild(rest);
    if (command === 'export') return await runExport(rest);
    if (command === 'render') return await runRender(rest);
    throw new UsageError(`Unknown command "${command}". Use build, export or render.`);
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`${red(bold('error'))}: ${(e as Error).message}\nRun \`arch-text --help\` for usage.`);
      return 2;
    }
    throw e;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
