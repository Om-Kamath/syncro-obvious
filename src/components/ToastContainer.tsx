import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissToast, subscribe, type Toast, type ToastKind } from '../services/toastStore';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1';

const KIND_STYLES: Record<ToastKind, { icon: React.ElementType; badge: string; border: string; role: string }> = {
  success: { icon: CheckCircle2, badge: 'bg-green-100 text-green-600', border: 'border-green-200', role: 'status' },
  error: { icon: AlertCircle, badge: 'bg-red-100 text-red-600', border: 'border-red-200', role: 'alert' },
  info: { icon: Info, badge: 'bg-violet-100 text-violet-600', border: 'border-violet-200', role: 'status' },
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[130] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map(t => {
        const styles = KIND_STYLES[t.kind];
        const Icon = styles.icon;
        return (
          <div
            key={t.id}
            role={styles.role}
            className={`flex items-start gap-3 bg-white border rounded-xl shadow-lg p-3 ${styles.border}`}
          >
            <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${styles.badge}`}>
              <Icon className="w-4 h-4" />
            </span>
            <p className="flex-1 pt-1 text-sm text-gray-800">{t.message}</p>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className={`shrink-0 p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors ${FOCUS_RING}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
