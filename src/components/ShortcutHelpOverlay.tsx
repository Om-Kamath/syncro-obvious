import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_GROUPS, SHORTCUT_REGISTRY } from '../utils/shortcutRegistry';

interface ShortcutHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelpOverlay({ open, onClose }: ShortcutHelpOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
      data-testid="shortcut-overlay-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-100 rounded-2xl flex items-center justify-center">
              <Keyboard className="w-4.5 h-4.5 text-violet-600" />
            </div>
            <h2 className="text-sm font-bold text-gray-900">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors text-sm font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(group => {
            const entries = SHORTCUT_REGISTRY.filter(s => s.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} className="mb-5 last:mb-0">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{group}</h3>
                <ul className="space-y-1.5">
                  {entries.map(entry => (
                    <li key={entry.id} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-gray-700">{entry.description}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {entry.keys.map(key => (
                          <kbd
                            key={key}
                            className="px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-xs font-mono font-semibold text-gray-600"
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
