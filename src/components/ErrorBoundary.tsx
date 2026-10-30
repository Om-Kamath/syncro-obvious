import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort boundary around the app shell: a thrown render error shows a
 * recovery screen instead of a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="flex flex-col items-center justify-center min-h-screen bg-gray-50 gap-4 p-6 text-center">
        <div aria-hidden="true" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-violet-200">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-base font-bold tracking-tight text-gray-900 leading-none">Syncro</p>
            <p className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold mt-0.5">Video Editing Copilot</p>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500 max-w-md">
          The editor hit an unexpected error and cannot continue.
        </p>
        {this.state.error.message && (
          <pre className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 max-w-md overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-200 transition-all"
        >
          Reload
        </button>
      </div>
    );
  }
}
