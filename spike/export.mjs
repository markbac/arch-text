// Steps 4 and 5 of the spike: export a scene offline to SVG and PNG, check the embedded scene,
// and compare PNG from exportToBlob with PNG from resvg.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { openExporter } from './exporter.mjs';

const name = process.argv[2] ?? 'two-boxes';
const scene = JSON.parse(fs.readFileSync(`scenes/${name}.excalidraw`, 'utf8'));
fs.mkdirSync('out', { recursive: true });

const ex = await openExporter();
const t0 = Date.now();
const svg = await ex.svg(scene, { scale: 1 });
const t1 = Date.now();
const png = await ex.png(scene, { scale: 2 });
const t2 = Date.now();
fs.writeFileSync(`out/${name}.svg`, svg);
fs.writeFileSync(`out/${name}.blob.png`, png);

const ids = scene.elements.map((e) => e.id).sort().join();
const svgBack = (await ex.readBack(svg, 'image/svg+xml')).sort().join();
const pngBack = (await ex.readBack(png.toString('base64'), 'image/png')).sort().join();
console.log(`SVG ${svg.length} bytes in ${t1 - t0} ms; PNG ${png.length} bytes in ${t2 - t1} ms`);
console.log('SVG inlines fonts:', /@font-face/.test(svg) && /data:font\/woff2|data:application\/font-woff2|base64/.test(svg));
console.log('SVG font families used:', [...new Set([...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]))].join(' | '));
console.log('Embedded scene read back from SVG:', svgBack === ids, '| from PNG:', pngBack === ids);
console.log('Font files fetched:', [...ex.fonts].length, [...ex.fonts].map((f) => f.split('/')[2]).filter((v, i, a) => a.indexOf(v) === i).join(', '));
console.log('Blocked external requests:', ex.blocked.length, ex.blocked.slice(0, 5));
await ex.close();

// resvg: render the same SVG at 2x. It only sees fonts we hand it, and the SVG inlines its own.
const t3 = Date.now();
const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: false } });
const rpng = resvg.render().asPng();
fs.writeFileSync(`out/${name}.resvg.png`, rpng);
console.log(`resvg PNG ${rpng.length} bytes in ${Date.now() - t3} ms`);
