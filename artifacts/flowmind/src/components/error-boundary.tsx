import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Your data is safe — reload the page to continue.
            </p>
            {this.state.error && (
              <p className="text-xs font-mono text-muted-foreground/60 bg-muted rounded-lg p-2 mt-2">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            Reload page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
