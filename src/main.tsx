import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

// The UI is authored at a fixed 1440x820 design canvas and scaled to fill the actual
// window (1920x1080 by default). Compute the non-uniform scale from the window size and
// expose it to CSS as --sx/--sy so .app-shell fills the window at any resolution.
const DESIGN_WIDTH = 1440;
const DESIGN_HEIGHT = 820;

function applyFillScale() {
  const root = document.documentElement.style;
  // Fall back to the design size (scale 1) if the window reports a 0 dimension, so the app is
  // never scaled to nothing (some hosts report innerWidth/innerHeight of 0 before first layout).
  const width = window.innerWidth || DESIGN_WIDTH;
  const height = window.innerHeight || DESIGN_HEIGHT;
  root.setProperty("--sx", String(width / DESIGN_WIDTH));
  root.setProperty("--sy", String(height / DESIGN_HEIGHT));
}

applyFillScale();
window.addEventListener("resize", applyFillScale);
// Re-measure after the first paint in case the window reported a 0 size at startup.
requestAnimationFrame(applyFillScale);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
