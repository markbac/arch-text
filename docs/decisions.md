# Decisions

Architecture decision records for arch-text. Each one gives the context, the decision, and the evidence behind it. The first four come from the phase 1 spike ([#2](https://github.com/markbac/arch-text/issues/2)), whose code is in [`spike/`](../spike/README.md) and runs with `npm run all`.

All findings below were made with `@excalidraw/excalidraw` 0.18.0, React 19.0.0 and Chromium from Playwright 1.63.0, on Node 22. The spike was run again with 0.18.1 (a security release) and every finding still holds, and the golden files did not change.

## ADR-001: Emit Excalidraw element JSON directly

**Status:** accepted

### Context

The plan allowed using Excalidraw's skeleton API, `convertToExcalidrawElements`, to build elements, if it runs in Node. `build` should not need a browser, and its output must be deterministic so generated files diff cleanly.

### Findings

`spike/node-import.mjs` tries three ways:

1. **Plain import in Node:** fails. The package imports `roughjs/bin/rough` without a file extension, which Node's ESM loader rejects.
1. **Bundled for Node with esbuild:** fails at load time with `window is not defined`.
1. **Bundled, with a hand-written fake DOM (`spike/node-shim.mjs`):** runs, and the bindings are correct (`startBinding`, `endBinding` and `boundElements` all line up). But:
    - text widths come from whatever `measureText` the fake DOM supplies, so it measures nothing real;
    - even with `regenerateIds: false`, label and arrow IDs and every `seed` are random on each run, so output is not deterministic.

### Decision

The emitter writes element JSON itself, against the pinned Excalidraw version. `spike/make-scene.mjs` shows the shape of it: rectangles with bound text labels, an arrow with `startBinding`, `endBinding` and a bound label, and an image element with its file in `files`. IDs and seeds are derived from model IDs.

Every emitted scene is validated by loading it into the real Excalidraw in tests (see ADR-004), which also runs Excalidraw's `restoreElements` to fill in any defaults.

### Consequences

- `build` needs no browser and no fake DOM.
- We own the element schema, so a version bump of `@excalidraw/excalidraw` needs the golden files and the load-in-Excalidraw tests to pass before it lands.

## ADR-002: Measure text in Node from Excalidraw's font files

**Status:** accepted

### Context

Layout needs each label's size before ELK runs, and Node has no canvas. Excalidraw measures text with `canvas.measureText`.

### Findings

`spike/measure.mjs` measures 20 labels at 16, 20 and 28 px in two ways:

- **Node:** fontkit reads the font's `woff2` files from the installed package and sums glyph advances, with kerning.
- **Browser:** `canvas.measureText` in headless Chromium, with the same files declared using Excalidraw's own `unicode-range` values.

All 60 measurements agree to within 0.002 px. The labels include accented letters (`Café`, `Zürich`), digits, punctuation, very narrow and very wide glyphs, and a 28-character label.

Each font family is split into several `woff2` files by Unicode range (seven for Excalifont). The Node code loads every file in the family and, for each character, uses the file that has its glyph, which is what the browser does with `unicode-range`.

### Decision

The sizer measures with fontkit and the font files in `node_modules/@excalidraw/excalidraw/dist/prod/fonts/<Family>/`. Height is `fontSize × lineHeight × lines`, with each family's line height read from the package (1.25 for Excalifont).

### Consequences

- Boxes are sized exactly as Excalidraw will draw their labels, so labels neither overflow nor leave odd gaps.
- `fontkit` becomes a runtime dependency of the compiler.

## ADR-003: Make PNGs with `exportToBlob` in Chromium, not resvg

**Status:** accepted

### Context

The plan left open whether to make PNGs with Excalidraw's `exportToBlob` or by converting the exported SVG with resvg.

### Findings

`spike/export.mjs` makes both from the same scene. It asked for twice the size from each, but `exportToBlob` ignores `appState.exportScale`, so its PNG came out at normal size while resvg's is doubled; the scale has to be passed through `getDimensions` (found in phase 2). The differences below do not depend on size.

![exportToBlob on the left, resvg on the right](images/spike-png-routes.png)

- **resvg drops every label.** Excalidraw puts its fonts inside the SVG as `@font-face` rules with base64 data, and resvg does not read them.
- **resvg draws the embedded SVG icon wrongly** (a large clipped shape at the bottom).
- `exportToBlob` matches the editor, and its PNG carries the embedded scene.
- Speed is not a deciding factor: for this scene `exportToBlob` took about 30 ms and resvg about 15 ms, once Chromium was running.

### Decision

PNG comes from `exportToBlob` in the export page. resvg is not a dependency.

### Consequences

`export` needs Chromium for PNG as well as SVG, which it does anyway.

## ADR-004: Offline export through a local page, failing on any outside request

**Status:** accepted

### Context

Export must work with no network access, and must not quietly reach a CDN.

### Findings

`spike/export.mjs` and `spike/exporter.mjs`:

- The export page (`spike/export-page/`) is a Vite bundle that sets `window.EXCALIDRAW_ASSET_PATH` to its own folder before importing `@excalidraw/excalidraw`, and exposes `exportSvg` and `exportPng` on `window`. It passes the scene through `restoreElements` and `restoreAppState` first, as Excalidraw does when opening a file.
- The build copies the package's whole `fonts/` folder beside the page.
- Node serves the page from `127.0.0.1` on a random port. Playwright lets through only that origin and `data:` and `blob:` URLs, and aborts and records everything else.
- With the fonts in place: **zero blocked requests**, and only the one Excalifont file the scene needs is fetched.
- With the fonts folder removed: Excalidraw falls back to `https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/fonts/...`, and the block catches both requests. This is the silent CDN fallback the plan worried about.
- `exportEmbedScene: true` works for both formats: the scene reads back from the SVG and from the PNG with every element ID intact.
- The exported SVG inlines the fonts it uses as base64 `@font-face` rules. Opened on its own in a browser with all requests blocked, it renders correctly and makes no requests.

### Decision

- `export` serves the built page from `127.0.0.1` and blocks every other origin.
- **Any blocked request fails the export** with an error that lists the URLs. A warning is not enough, because the fallback otherwise goes unnoticed.
- The package ships every font folder from `@excalidraw/excalidraw`, copied at build time:

    | Folder | Files | Size | Excalidraw `fontFamily` | Use |
    |---|---|---|---|---|
    | `Excalifont` | 7 | 84 KB | 5 | Hand-drawn (default, `option font hand`) |
    | `Nunito` | 5 | 72 KB | 6 | Normal (`option font normal`) |
    | `ComicShanns` | 4 | 44 KB | 8 | Code (`option font code`) |
    | `Xiaolai` | 209 | 13 MB | (fallback) | Chinese, Japanese and Korean characters in any family |
    | `Lilita` | 2 | 20 KB | 7 | Not used by arch-text |
    | `Virgil` | 1 | 60 KB | 1 | Older hand-drawn font, for opening older scenes |
    | `Cascadia` | 1 | 72 KB | 3 | Older code font |
    | `Liberation` | 1 | 76 KB | 9 | Sans fallback |
    | `Assistant` | 4 | 84 KB | (UI) | Excalidraw's interface font |

    The total is 21 MB, almost all of it `Xiaolai`. Leaving it out would make any CJK label fail the export (through the block above), so it stays in.

### Consequences

- The release tarball and Docker image carry about 21 MB of fonts.
- The page must be served over HTTP, not opened as a `file://` URL, because Excalidraw loads fonts with `fetch`.

## ADR-005: Edges are elbow arrows

**Status:** accepted (phase 3)

### Context

ELK routes edges orthogonally, with bends. In Excalidraw, a plain arrow with bends keeps its bends where they are when a shape it is bound to moves, and only its bound end is recomputed. Once the shape moves past the arrow's first bend, the recomputed end lands away from the shape.

### Findings

`test/editor.test.ts` opens every example in the full Excalidraw editor, moves each shape that has arrows 20 px down and 20 px right with the keyboard, and checks that each bound arrow end is on the moved shape's border. With plain arrows, two arrows in two examples ended 32.5 px off their shapes: both bend about 20 px after leaving the shape. With elbow arrows (`elbowed: true`, and a `fixedPoint` on each binding giving where the end sits on the shape), every arrow in every example stays on its shape, and Excalidraw re-routes it. Excalidraw keeps ELK's route when the file is opened; it re-routes only an arrow whose shape is moved.

### Decision

Every edge is an elbow arrow, with fixed points taken from ELK's end points.

### Consequences

- Moving a shape in Excalidraw re-routes its arrows with Excalidraw's own router, so an edited diagram may route differently from a rebuilt one.
- Excalidraw draws elbow arrows with slightly rounded corners.

## ADR-006: Arrow labels are placed through the arrow's points

**Status:** accepted (phase 3)

### Context

Excalidraw draws an arrow's label at the arrow's middle point, and it moves the label there when it opens a file, whatever position the file gives. ELK, meanwhile, makes room for each label somewhere along its edge, not necessarily in the middle.

### Decision

ELK places labels inline (on the edge). The emitter adds a point to the arrow where ELK put the label, on the line, and pads the shorter side with points on the line until that point is the middle one. In a top-to-bottom layout, ELK reserves room beside vertical edges rather than on them, so there shapes are also kept at least half the widest label's width away from edges.

### Consequences

- Labels land where ELK made room, and `test/build.test.ts` checks that no label overlaps a shape or another label.
- Arrows with labels carry a few extra points on straight stretches; Excalidraw shows them as handles when the arrow is selected.

## ADR-007: Choose each character's font file by Excalidraw's unicode ranges

**Status:** accepted (phase 4)

### Context

ADR-002 measures text from Excalidraw's font files, using for each character the first file, in file name order, that has its glyph. That was checked against the browser for Excalifont only. Phase 4 adds Nunito and Comic Shanns, the other two fonts in Excalidraw's picker.

### Findings

Compared with `canvas.measureText` in the real editor, Nunito was off by 0.32 px at 16 px for `A, B & C -> D`. Nunito's Cyrillic file has the basic Latin punctuation too, and it comes first by name, but the browser never uses it for those characters. Excalidraw declares a `unicode-range` for every file, and the browser picks by range: where ranges overlap, the last file declared is tried first, as CSS specifies.

### Decision

`scripts/font-ranges.mjs` reads the ranges Excalidraw declares and writes them to `src/font-ranges.ts`. Measurement picks each character's file as the browser does: the last declared file whose range covers the character and that has the glyph.

### Consequences

- All three fonts match the browser to within 0.05 px; `test/editor.test.ts` checks a set of labels at 16, 20 and 28 px in each. Headless Chromium on Linux rounds each glyph's advance to a whole pixel, so there the check skips itself; CI runs it on Windows.
- `test/build.test.ts` fails if `src/font-ranges.ts` no longer matches the installed package, so an Excalidraw upgrade cannot change measurement silently. Run the script again after upgrading.

## ADR-008: Style layers merge property by property, class rules in source order

**Status:** accepted (phase 4, [#11](https://github.com/markbac/arch-text/issues/11))

### Context

An element's look can come from options, rules for its kind, rules for its classes and its own attributes, and two classes can set the same property.

### Decision

The layers apply in that order, each overriding only the properties it sets. Class rules apply in the order they are written in the file, not the order the classes are listed on the element, as in CSS: the order of `[class: a, b]` is easy to vary between elements, while one place in the file decides which rule wins. Edges take only the edge properties of a class rule, so one class can style elements and edges.

Every property maps one to one onto an Excalidraw property (`fill` is `backgroundColor`, `rough` is `roughness`, and so on), and named colours use Excalidraw's palette in the shade its colour picker chooses, so a diagram reopened in Excalidraw shows the same values in its own panels.

### Consequences

- A precedence table in `test/style.test.ts` covers each layer and the two-class case.
- The defaults are unchanged from phase 3, so unstyled diagrams build exactly as before.

## ADR-009: Icons are grouped copies; arrows bind to the node's own box

**Status:** accepted (phase 4, [#6](https://github.com/markbac/arch-text/issues/6))

### Context

Arrows must stay bound when nodes move, labels must stay bound to their nodes, and a library item can be used many times in one diagram.

### Decision

- Each use of a library item is a copy with IDs made from the node's ID (`firmware:icon:0` ...), so output stays deterministic and copies never share IDs. Bindings inside the item are pointed at the copy.
- The node's box, its label and its icon form one Excalidraw group (`<id>:shape`), the same as the parts of actors and datastores, so they move together.
- Arrows bind to the node's box. With `icon-only`, and for actors, the box is invisible, so arrows never bind to the icon, which may be an image or many elements.
- Excalidraw draws a bound label straight after its container, whatever the file's order. For actors and datastores, whose parts may now be filled, the invisible box and its label come after the parts, or a filled cylinder would hide its label.
- SVG files are embedded as Excalidraw's editor stores them (its `normalizeSVG`: just the `<svg>` element, with `width`, `height` and `viewBox` added where missing). That also fixes the clipped `viewBox`-only icons found in the spike, and the editor does not rewrite and re-version the file when the scene is opened.

### Consequences

- `test/editor.test.ts` opens every example, including the icon ones, in the real editor and moves each shape with arrows; it also saves the scene and checks every style property and image is unchanged, and checks that the editor keeps a set of SVGs byte for byte.
- The golden files for examples with actors and datastores changed order (not content) in phase 4.

## Other findings from the spike

These do not need an ADR, but later issues depend on them.

- **Bound arrows follow in the real editor ([#5](https://github.com/markbac/arch-text/issues/5)).** `spike/binding.mjs` loads the hand-written scene into the full Excalidraw editor, drags `Platform` 150 px down with the mouse, and reads the scene back. The arrow stays bound at both ends, its end lies on `Platform`'s left edge, and its label moves with it.

    ![The arrow still attached after dragging Platform](images/spike-binding-drag.png)

- **SVG icons need a width and height ([#6](https://github.com/markbac/arch-text/issues/6)).** An SVG with only a `viewBox` is drawn clipped and too large, in both SVG and PNG exports. Set `UNSIZED=1` when running `spike/make-scene.mjs` to reproduce it. The icon loader adds `width` and `height` from the `viewBox` when they are missing (ADR-009).
- **npm skipped Rollup's native binary ([#9](https://github.com/markbac/arch-text/issues/9)).** In this environment `npm install` left out `@rollup/rollup-linux-x64-gnu`, which Vite needs, and the lockfile had no entry for it ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). The spike lists it under `optionalDependencies` so it installs on Linux and is skipped elsewhere. CI on Windows will need the matching Windows package listed the same way.
- **Timing.** For the two-box scene, once Chromium was running: SVG about 270 ms, PNG about 30 ms. The SVG ran first; I did not measure how much of its time is one-off font loading.
