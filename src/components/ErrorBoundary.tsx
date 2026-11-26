import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "An unexpected application error occurred.",
    };
  }

  render() {
    if (this.state.hasError) {
      let parsedError = this.state.message;
      try {
        const obj = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (obj.error) {
          parsedError = `${obj.error} (operation: ${obj.operationType ?? "unknown"}, path: ${obj.path ?? "n/a"})`;
        }
      } catch {
        // Keep plain string message
      }

      return (
        <div className="min-h-screen bg-arova-mint/40 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-arova-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold text-arova-text">
                AROVA Application Error Encountered
              </h2>
            </div>
            <p className="text-sm text-arova-muted leading-relaxed break-words">{parsedError}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-arova-green rounded-lg hover:bg-arova-green-dark transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload View
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
