// Mounts the full Excalidraw editor so a test can drag shapes with the mouse and read the scene back.
import '@excalidraw/excalidraw/index.css';

window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Excalidraw } = await import('@excalidraw/excalidraw');

window.loadScene = (scene) =>
  new Promise((resolve) => {
    createRoot(document.getElementById('root')).render(
      React.createElement(Excalidraw, {
        initialData: { elements: scene.elements, files: scene.files, appState: { ...scene.appState, scrollX: 100, scrollY: 100, zoom: { value: 1 } } },
        excalidrawAPI: (api) => { window.api = api; setTimeout(resolve, 300); },
      }),
    );
  });
