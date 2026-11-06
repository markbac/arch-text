// The export page: loads Excalidraw with fonts served from beside this page and exposes
// export functions on window for Playwright to call.
window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href;

const { exportToSvg, exportToBlob, restoreElements, restoreAppState, loadFromBlob } = await import('@excalidraw/excalidraw');

function prepare(scene, options) {
  const elements = restoreElements(scene.elements, null);
  const appState = {
    ...restoreAppState(scene.appState, null),
    exportBackground: options.background ?? true,
    exportEmbedScene: true,
    exportScale: options.scale ?? 1,
    exportWithDarkMode: options.dark ?? false,
  };
  return { elements, appState, files: scene.files ?? {}, exportPadding: options.padding ?? 16 };
}

window.archText = {
  async exportSvg(scene, options = {}) {
    const svg = await exportToSvg(prepare(scene, options));
    return svg.outerHTML;
  },
  async exportPng(scene, options = {}) {
    const blob = await exportToBlob({ ...prepare(scene, options), mimeType: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  },
};
// Reads the scene embedded in an exported SVG (text) or PNG (base64), as Excalidraw does on open.
window.archText.readBack = async (data, mimeType) => {
  const bytes = mimeType === 'image/png' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
  const scene = await loadFromBlob(new Blob([bytes], { type: mimeType }), null, null);
  return scene.elements.map((e) => e.id);
};
window.archTextReady = true;
