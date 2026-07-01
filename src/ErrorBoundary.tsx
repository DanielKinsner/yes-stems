import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null; info: string };

// Global safety net: a render crash anywhere below <App /> is caught here instead of
// white-screening the window. Shows the error plus a one-click "copy diagnostics" button.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    // Surface to the devtools console as well for local debugging.
    console.error("YES Stems render error:", error, info.componentStack);
  }

  private diagnostics() {
    const { error, info } = this.state;
    return [
      `YES Stems — render error`,
      `Time: ${new Date().toISOString()}`,
      `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
      ``,
      `${error?.name ?? "Error"}: ${error?.message ?? "unknown"}`,
      error?.stack ?? "",
      info ? `\nComponent stack:${info}` : "",
    ].join("\n");
  }

  private copyDiagnostics = () => {
    const text = this.diagnostics();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
  };

  private reload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="error-boundary" role="alert">
        <div className="error-card">
          <h2>Something went wrong</h2>
          <p>
            YES Stems hit an unexpected error while rendering. Your audio and files are untouched —
            nothing left your machine.
          </p>
          <pre className="error-detail">
            {this.state.error.name}: {this.state.error.message}
          </pre>
          <div className="error-actions">
            <button type="button" className="error-btn primary" onClick={this.copyDiagnostics}>
              Copy diagnostics
            </button>
            <button type="button" className="error-btn" onClick={this.reload}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
