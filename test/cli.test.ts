import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';

let dir: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-text-cli-'));
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((stdout += String(s)), true));
  vi.spyOn(console, 'log').mockImplementation((...a) => void (stdout += `${a.join(' ')}\n`));
  vi.spyOn(console, 'error').mockImplementation((...a) => void (stderr += `${a.join(' ')}\n`));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (...p: string[]) => path.join(dir, ...p);
const writeFile = (name: string, text: string) => fs.writeFileSync(at(name), text);
const GOOD = 'system A\nsystem B\nA -> B: calls\n';

describe('arch-text build', () => {
  it('writes a scene to standard output with one input and no -o', async () => {
    writeFile('a.archt', GOOD);
    expect(await main(['build', at('a.archt')])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ type: 'excalidraw', version: 2 });
  });

  it('writes to the -o file', async () => {
    writeFile('a.archt', GOOD);
    expect(await main(['build', at('a.archt'), '-o', at('out', 'a.excalidraw')])).toBe(0);
    expect(JSON.parse(fs.readFileSync(at('out', 'a.excalidraw'), 'utf8')).type).toBe('excalidraw');
  });

  it('builds a glob of inputs into a directory', async () => {
    writeFile('a.archt', GOOD);
    writeFile('b.archt', GOOD);
    expect(await main(['build', `${dir.replace(/\\/g, '/')}/*.archt`, '-o', at('out')])).toBe(0);
    expect(fs.readdirSync(at('out')).sort()).toEqual(['a.excalidraw', 'b.excalidraw']);
  });

  it('exits 1 with a code frame for errors, and writes nothing for that file', async () => {
    writeFile('bad.archt', 'system A\nA -> Bee\n');
    expect(await main(['build', at('bad.archt'), '-o', at('bad.excalidraw')])).toBe(1);
    expect(stderr).toContain('bad.archt:2:6: error AT008: Nothing is called "Bee".');
    expect(stderr).toContain('2 | A -> Bee\n  |      ^^^');
    expect(fs.existsSync(at('bad.excalidraw'))).toBe(false);
  });

  it('exits 0 with warnings', async () => {
    writeFile('warn.archt', 'system A\nA -> A\n');
    expect(await main(['build', at('warn.archt'), '-o', at('warn.excalidraw')])).toBe(0);
    expect(stderr).toContain('warning AT010');
  });

  it('exits 2 for usage errors', async () => {
    expect(await main(['build'])).toBe(2);
    expect(await main(['build', at('missing-*.archt')])).toBe(2);
    expect(await main(['build', '--nope', 'x'])).toBe(2);
    expect(await main(['frobnicate'])).toBe(2);
    expect(stderr).toContain('Run `arch-text --help` for usage.');
  });
});

describe('arch-text export', () => {
  beforeEach(async () => {
    writeFile('a.archt', GOOD);
    await main(['build', at('a.archt'), '-o', at('a.excalidraw')]);
  });

  it('exports SVG and PNG, taking the format from -o', async () => {
    expect(await main(['export', at('a.excalidraw'), '-o', at('a.svg')])).toBe(0);
    expect(fs.readFileSync(at('a.svg'), 'utf8')).toMatch(/^<svg/);
    expect(await main(['export', at('a.excalidraw'), '-f', 'png', '--scale', '2', '-o', at('a.png')])).toBe(0);
    expect(fs.readFileSync(at('a.png')).subarray(1, 4).toString()).toBe('PNG');
  });

  it('writes beside the input without -o', async () => {
    expect(await main(['export', at('a.excalidraw'), '-f', 'png'])).toBe(0);
    expect(fs.existsSync(at('a.png'))).toBe(true);
  });

  it('exits 1 for a file that is not a scene', async () => {
    writeFile('junk.excalidraw', '{"hello": 1}');
    expect(await main(['export', at('junk.excalidraw'), '-o', at('junk.svg')])).toBe(1);
    expect(stderr).toContain('cannot read it as an .excalidraw file');
  });

  it('exits 2 for a bad format or scale', async () => {
    expect(await main(['export', at('a.excalidraw'), '-f', 'gif'])).toBe(2);
    expect(await main(['export', at('a.excalidraw'), '--scale', '0'])).toBe(2);
  });
});

describe('arch-text render', () => {
  const mtime = (f: string) => fs.statSync(at(f)).mtimeMs;

  it('writes an SVG beside each input by default', async () => {
    fs.mkdirSync(at('docs'));
    writeFile('a.archt', GOOD);
    writeFile('docs/b.archt', GOOD);
    expect(await main(['render', `${dir.replace(/\\/g, '/')}/**/*.archt`])).toBe(0);
    expect(fs.readFileSync(at('a.svg'), 'utf8')).toMatch(/^<svg/);
    expect(fs.existsSync(at('docs', 'b.svg'))).toBe(true);
    expect(fs.existsSync(at('a.excalidraw'))).toBe(false);
  });

  it('writes every format asked for, the same as build and export do', async () => {
    writeFile('a.archt', GOOD);
    expect(await main(['render', at('a.archt'), '-f', 'svg, png,excalidraw'])).toBe(0);
    expect(fs.readFileSync(at('a.png')).subarray(1, 4).toString()).toBe('PNG');
    await main(['build', at('a.archt'), '-o', at('built.excalidraw')]);
    expect(fs.readFileSync(at('a.excalidraw'), 'utf8')).toBe(fs.readFileSync(at('built.excalidraw'), 'utf8'));
  });

  it('leaves outputs that are already up to date untouched', async () => {
    writeFile('a.archt', GOOD);
    await main(['render', at('a.archt'), '-f', 'svg,png']);
    const before = [mtime('a.svg'), mtime('a.png')];
    const bytes = [fs.readFileSync(at('a.svg')), fs.readFileSync(at('a.png'))];
    stderr = '';
    expect(await main(['render', at('a.archt'), '-f', 'svg,png'])).toBe(0);
    expect([mtime('a.svg'), mtime('a.png')]).toEqual(before);
    expect([fs.readFileSync(at('a.svg')), fs.readFileSync(at('a.png'))]).toEqual(bytes);
    expect(stderr).not.toContain('->');
  });

  it('with --check, passes when outputs are up to date', async () => {
    writeFile('a.archt', GOOD);
    await main(['render', at('a.archt'), '-f', 'svg,png,excalidraw']);
    expect(await main(['render', at('a.archt'), '-f', 'svg,png,excalidraw', '--check'])).toBe(0);
  });

  it('with --check, lists missing and stale outputs, exits 1, and writes nothing', async () => {
    writeFile('a.archt', GOOD);
    await main(['render', at('a.archt')]);
    writeFile('a.archt', `${GOOD}system C\n`);
    const svg = fs.readFileSync(at('a.svg'));
    expect(await main(['render', at('a.archt'), '-f', 'svg,png', '--check'])).toBe(1);
    expect(stderr).toContain(`out of date: ${at('a.svg')}`);
    expect(stderr).toContain(`missing: ${at('a.png')}`);
    expect(stderr).toContain('2 diagram outputs are out of date');
    expect(fs.readFileSync(at('a.svg'))).toEqual(svg);
    expect(fs.existsSync(at('a.png'))).toBe(false);
  });

  it('exits 1 for an input with errors, still rendering the others', async () => {
    writeFile('bad.archt', 'system A\nA -> B\n');
    writeFile('good.archt', GOOD);
    expect(await main(['render', at('bad.archt'), at('good.archt')])).toBe(1);
    expect(stderr).toContain('AT008');
    expect(fs.existsSync(at('good.svg'))).toBe(true);
    expect(fs.existsSync(at('bad.svg'))).toBe(false);
  });

  it('exits 2 for a format it cannot write', async () => {
    writeFile('a.archt', GOOD);
    expect(await main(['render', at('a.archt'), '-f', 'svg,gif'])).toBe(2);
    expect(await main(['render', at('a.archt'), '-f', ','])).toBe(2);
  });
});

describe('arch-text', () => {
  it('prints help and the version', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('arch-text build <input.archt>');
    expect(await main(['--version'])).toBe(0);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+$/m);
  });

  it('exits 2 and prints help to stderr with no command', async () => {
    expect(await main([])).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});
