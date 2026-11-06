# Phase 1 spike

Throwaway code for [#2](https://github.com/markbac/arch-text/issues/2): can Excalidraw's skeleton API run in Node, can text be measured without a browser, and can export run headlessly with no network? The answers and decisions are in [`docs/decisions.md`](../docs/decisions.md).

## Running it

Needs Node 22 and a Playwright Chromium. Set `ARCH_TEXT_CHROMIUM` to a Chromium binary if Playwright's own copy is not installed.

```bash
cd spike
npm install
npm run all
```

`npm run all` builds both pages, writes the test scene, then runs each check in turn. Outputs go to `out/`.

## Files

| File | Step | What it does |
|---|---|---|
| `node-import.mjs`, `node-shim.mjs` | 2 | Tries `convertToExcalidrawElements` in plain Node, bundled, and bundled with a fake DOM |
| `fonts.mjs`, `measure.mjs` | 3 | Measures labels in Node with fontkit and compares with `canvas.measureText` in Chromium |
| `make-scene.mjs` | 4 | Writes `scenes/two-boxes.excalidraw` by hand: two boxes, a bound labelled arrow, an SVG icon |
| `export-page/`, `build-page.mjs` | 4 | The Vite export page and its build, which copies the fonts beside it |
| `exporter.mjs`, `export.mjs` | 4, 5 | Serves the page on `127.0.0.1`, blocks other requests, exports SVG and PNG, reads the embedded scene back, and makes a resvg PNG to compare |
| `binding-page/`, `build-binding-page.mjs`, `binding.mjs` | 6 | Loads the scene in the full editor, drags a box with the mouse, and checks the arrow follows |
| `browser.mjs` | | Launches Chromium, honouring `ARCH_TEXT_CHROMIUM` |
