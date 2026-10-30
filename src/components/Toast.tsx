import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface ToastState {
  kind: 'error' | 'success';
  message: string;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

const TOAST_TIMEOUT_MS = 4000;

/**
 * Ephemeral notification shown at the bottom of the screen. Renders nothing
 * while there is no active toast; each new toast (re)starts its own
 * auto-dismiss timer.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => onDismissRef.current(), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  const isError = toast.kind === 'error';
  return (
    <div
      role="alert"
      className={`fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
        isError
          ? 'border-red-200 bg-red-50 text-red-600'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {isError ? (
        <AlertCircle className="w-4 h-4 shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      )}
      <span className="max-w-md">{toast.message}</span>
      <button
        onClick={() => onDismissRef.current()}
        aria-label="Dismiss notification"
        className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
