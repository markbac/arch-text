// A minimal fake DOM: just enough for @excalidraw/excalidraw to load in Node (spike step 2).
const noop = () => {};
const el = () => ({ style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop }, getContext: () => ctx });
const ctx = { measureText: (s) => ({ width: s.length * 10, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }), font: '' };
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = { createElement: el, documentElement: { style: {} }, body: el(), head: el(), addEventListener: noop, fonts: { add: noop, check: () => true, load: async () => [], status: 'loaded', addEventListener: noop, ready: Promise.resolve() }, querySelector: () => null };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', platform: 'linux' }, configurable: true });
globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' };
globalThis.devicePixelRatio = 1;
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, addListener: noop });
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.FontFace = class { constructor() {} load() { return Promise.resolve(this); } };
globalThis.addEventListener = noop;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.OffscreenCanvas = class { getContext() { return ctx; } };
for (const n of ['Element', 'HTMLElement', 'HTMLCanvasElement', 'SVGElement', 'Node', 'Image', 'HTMLImageElement', 'Blob', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'XMLSerializer', 'CustomEvent', 'Event', 'EventTarget'])
  if (!(n in globalThis)) globalThis[n] = class { constructor() {} };
