// The full Excalidraw editor, for tests that open a scene and move shapes as a person would.
import '@excalidraw/excalidraw/index.css';

window.EXCALIDRAW_ASSET_PATH = new URL('./', window.location.href).href;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Excalidraw } = await import('@excalidraw/excalidraw');

window.api = await new Promise((resolve) => {
  createRoot(document.getElementById('root')).render(
    React.createElement(Excalidraw, { excalidrawAPI: (api) => setTimeout(() => resolve(api), 200) }),
  );
});
window.editorReady = true;
