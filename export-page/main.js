// The export page (ADR-004 in docs/decisions.md). It loads Excalidraw with fonts served from
// beside this page and exposes export functions on window for the Node exporter to call.
window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href;
// Otherwise Excalidraw records this page's origin, including its random port, in every export.
window.EXCALIDRAW_EXPORT_SOURCE = 'https://github.com/markbac/arch-text';

const { exportToSvg, exportToBlob, restoreElements, restoreAppState, loadFromBlob } = await import('@excalidraw/excalidraw');

// Restore the scene as Excalidraw does when opening a file, then apply the export options.
function prepare(scene, options) {
  return {
    elements: restoreElements(scene.elements, null),
    appState: {
      ...restoreAppState(scene.appState, null),
      exportBackground: options.background,
      exportEmbedScene: true,
      exportScale: options.scale,
      exportWithDarkMode: false,
    },
    files: scene.files ?? {},
    exportPadding: options.padding,
  };
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

window.archText = {
  async exportSvg(scene, options) {
    const svg = await exportToSvg(prepare(scene, options));
    return svg.outerHTML;
  },
  async exportPng(scene, options) {
    // exportToBlob ignores appState.exportScale; the scale has to come through getDimensions.
    const blob = await exportToBlob({
      ...prepare(scene, options),
      mimeType: 'image/png',
      getDimensions: (width, height) => ({ width: width * options.scale, height: height * options.scale, scale: options.scale }),
    });
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  },
  // Reads back the scene embedded in an SVG (text) or PNG (base64), as Excalidraw does on open.
  async readScene(data, mimeType) {
    const bytes = mimeType === 'image/png' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
    const scene = await loadFromBlob(new Blob([bytes], { type: mimeType }), null, null);
    return scene.elements.map((e) => ({ id: e.id, type: e.type }));
  },
};
window.archTextReady = true;
