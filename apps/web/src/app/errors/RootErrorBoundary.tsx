import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RootErrorBoundaryProps {
  readonly children: ReactNode;
}

interface RootErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Last-resort boundary for render failures. It shows a safe generic message and
 * never prints an error message that could contain internal detail.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  public override state: RootErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', { name: error.name, componentStack: info.componentStack });
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-canvas px-6 py-16" role="alert">
          <div className="mx-auto max-w-xl rounded-xl border border-border-default bg-surface p-6">
            <h1 className="text-page-title font-bold text-text-primary">
              The application could not start
            </h1>
            <p className="mt-2 text-supporting text-text-secondary">
              Reload the page to try again. No financial data was affected.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md border border-blue-600 bg-blue-600 px-4 py-2 text-supporting font-semibold text-text-inverse transition-colors hover:bg-blue-700"
            >
              Reload the page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
