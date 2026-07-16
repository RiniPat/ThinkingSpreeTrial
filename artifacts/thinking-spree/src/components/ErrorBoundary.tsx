import { Component, type ReactNode } from "react";

/**
 * Catches render/lifecycle errors anywhere below it so a crash shows a readable
 * message (and the actual error) instead of a blank white screen. Without this,
 * any thrown error unmounts the whole React tree — sidebar included.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surface it in the console for DevTools too.
    // eslint-disable-next-line no-console
    console.error("App crashed:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter',system-ui,sans-serif", background: "hsl(42 30% 98%)" }}>
        <div style={{ maxWidth: 640, width: "100%", background: "#fff", border: "1px solid hsl(220 16% 87%)", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(16,24,40,.08)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "hsl(0 65% 45%)" }}>
            Something went wrong
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif',Georgia,serif", fontSize: 28, margin: "6px 0 4px", color: "hsl(222 35% 16%)" }}>
            This page hit an error
          </h1>
          <p style={{ fontSize: 14, color: "hsl(222 12% 42%)", margin: "0 0 14px" }}>
            The details below tell us exactly what failed — copy them if you need help.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.5, background: "hsl(220 18% 96%)", border: "1px solid hsl(220 16% 87%)", borderRadius: 8, padding: 12, color: "hsl(222 35% 20%)", maxHeight: 280, overflow: "auto" }}>
            {error.message}
            {error.stack ? "\n\n" + error.stack : ""}
          </pre>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button onClick={() => (window.location.href = "/dashboard")} style={{ borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, background: "hsl(36 65% 56%)", color: "hsl(222 38% 15%)", border: "none", cursor: "pointer" }}>
              Back to Dashboard
            </button>
            <button onClick={() => window.location.reload()} style={{ borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, background: "#fff", color: "hsl(222 35% 16%)", border: "1px solid hsl(220 16% 87%)", cursor: "pointer" }}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
