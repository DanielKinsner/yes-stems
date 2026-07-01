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
  root.setProperty("--sx", String(window.innerWidth / DESIGN_WIDTH));
  root.setProperty("--sy", String(window.innerHeight / DESIGN_HEIGHT));
}

applyFillScale();
window.addEventListener("resize", applyFillScale);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
