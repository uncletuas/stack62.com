import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Catches runtime errors thrown by any editor surface so a single
 * broken editor doesn't take down the whole workspace. Surfaces the
 * actual message + stack and offers a Reload button.
 *
 * Reset key is the active tab id — switching tabs clears the error
 * state automatically.
 */
interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  message: string;
  stack: string;
}

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "", stack: "" };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? "" : "",
    };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: "", stack: "" });
    }
  }

  componentDidCatch(err: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Editor crashed:", err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-app p-6">
        <div className="w-full max-w-md rounded-lg border border-app bg-app-surface p-6 shadow-sm">
          <h2 className="text-base font-semibold text-app">
            This view couldn't load
          </h2>
          <p className="mt-1 text-sm text-app-muted">
            Something broke while rendering this editor. The rest of
            Stack62 is fine — you can close this tab and keep working,
            or try reloading.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-md border border-app bg-app p-3 text-xs text-app-faint">
            {this.state.message}
          </pre>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                this.setState({ hasError: false, message: "", stack: "" })
              }
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-app px-3 py-1.5 text-sm text-app hover:bg-app-hover"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
