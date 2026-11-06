# arch-text

**Write architecture diagrams as text and get laid-out Excalidraw scenes, SVG and PNG.**

arch-text compiles a small text notation into an [Excalidraw](https://excalidraw.com) scene, laid out automatically with [ELK](https://eclipse.dev/elk/), with arrows bound to their shapes so they stay attached when you move things. It exports SVG and PNG headlessly and fully offline, and both keep the scene inside them, so they reopen in Excalidraw for editing. It is the architecture-diagram sibling of [bpmn-text](https://github.com/markbac/bpmn-text).

```archt
title "Three systems"

system Meter
system HES
system Platform

Meter -> HES: DLMS/COSEM
HES -> Platform: Events
```

![The example above, exported to PNG](docs/images/three-systems.png)

> **Status: walking skeleton.** This version supports `title`, `system` and `->` edges with labels, which is enough to run the whole pipeline end to end. Components, actors, datastores, nested boundaries, groups, styling and icons follow; see the [plan](https://github.com/markbac/arch-text/issues/1) for the full notation and the phases.

## Install

Releases are not published yet. To run it from a clone (Node.js 20 or 22):

```bash
git clone https://github.com/markbac/arch-text
cd arch-text
npm ci
npm run build
npx playwright-core install chromium
```

`build` needs no browser. `export` needs Chromium: either Playwright's copy, installed by the last command, or any Chromium or Chrome binary named in `ARCH_TEXT_CHROMIUM`.

## Command line

```bash
node dist/cli.js build diagram.archt -o diagram.excalidraw      # or to stdout without -o
node dist/cli.js build "docs/**/*.archt" -o out/                # several files into a folder
node dist/cli.js export diagram.excalidraw -o diagram.svg       # format from the extension
node dist/cli.js export diagram.excalidraw -f png --scale 2     # writes diagram.png beside it
node dist/cli.js export "out/*.excalidraw" -f png -o out/       # several files into a folder
```

| Option | Command | Meaning |
|---|---|---|
| `-o, --output <path>` | both | Output file, or a folder for several inputs |
| `-f, --format svg\|png` | export | Output format (default: from the `-o` extension, else `svg`) |
| `--scale <n>` | export | PNG pixel ratio (default 1) |
| `--padding <px>` | export | Space around the drawing (default 16) |
| `--no-background` | export | Transparent background |

Exit codes: 0 when everything is fine (warnings allowed), 1 when an input has errors or an export fails, 2 for usage errors. Colours are used on a terminal unless `NO_COLOR` is set.

Export runs Excalidraw's own `exportToSvg` and `exportToBlob` in headless Chromium, against a local page that carries all of Excalidraw's fonts. Any attempt to fetch from outside the machine fails the export, so a missing font can never be swapped silently for a download. The reasons are in [docs/decisions.md](docs/decisions.md).

## Library

```ts
import { build, openExporter, serialise } from 'arch-text';

const { scene, diagnostics } = await build(source); // scene is undefined when there are errors
const exporter = await openExporter(); // starts Chromium once
const svg = await exporter.svg(scene!);
const png = await exporter.png(scene!, { scale: 2 });
await exporter.close();
```

## Diagnostics

| Code | Severity | Meaning |
|---|---|---|
| AT001 | error | Indentation uses a tab |
| AT002 | error | Indented line: blocks are not supported yet |
| AT003 | error | A statement needs a name (`system`, `title`, `@id`, edge ends) |
| AT004 | error | A keyword or edge kind that is planned but not supported yet |
| AT005 | error | A line that is not a statement |
| AT006 | error | A string with no closing quote |
| AT007 | error | The same `@id` on two elements |
| AT008 | error | An edge end that names nothing (with the closest name as a hint) |
| AT009 | error | An edge end whose name matches more than one element |
| AT010 | warning | An edge from an element to itself, which is left out |
| AT011 | error | Text after the end of a statement |

## Development

```bash
npm run lint
npm run typecheck
npm run build          # compiler to dist/, export page to dist/export-page/
npm test               # needs the build and Chromium
npm run test:update    # rewrite test/golden/ after an intended output change
```

The tests compare every example in `examples/` with its golden `.excalidraw` and `.svg` files in `test/golden/`, so any change to layout or output fails until the golden files are updated on purpose.

## Licence

[MIT](LICENSE)
