import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, Folder, FolderOpen, RotateCw, Trash2 } from 'lucide-react';
import { SavedProjectSummary } from '../types';

interface ProjectsPanelProps {
  projects: SavedProjectSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Stops Tab may move focus between while the confirmation is open. Disabled
// controls are excluded (they can't receive focus).
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Returns the stop Tab should jump to keep focus inside the confirmation, or
// null to let the browser move focus normally.
function nextFocusable(
  focusables: HTMLElement[],
  active: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusables.length === 0) return null;
  const index = active instanceof HTMLElement ? focusables.indexOf(active) : -1;
  if (shiftKey) return index <= 0 ? focusables[focusables.length - 1] : null;
  return index === focusables.length - 1 ? focusables[0] : null;
}

// Presentational list of saved projects. The parent owns persistence and the
// list state; open/delete emit intent via callbacks so this stays testable and
// backend-agnostic (localStorage today, the projects API later).
export function ProjectsPanel({
  projects,
  onOpen,
  onDelete,
  loading = false,
  error = null,
  onRetry,
}: ProjectsPanelProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // The trash button that opened the confirmation (unmounted while it shows),
  // so focus can return there when the confirmation is dismissed.
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where focus should go when the confirmation closes: back to the trigger
  // after a cancel, or to the panel heading after the project was deleted.
  const closeFocusRef = useRef<'trigger' | 'panel' | null>(null);

  // The confirmation replaces the row in place, so focus needs help both
  // ways: into the dialog when it opens, back out to where the user came
  // from when it closes.
  useEffect(() => {
    if (confirmDeleteId) {
      // Focus the non-destructive action so a stray Enter can't delete.
      cancelButtonRef.current?.focus();
      return;
    }
    if (!closeFocusRef.current) return;
    const mode = closeFocusRef.current;
    closeFocusRef.current = null;
    if (mode === 'trigger') {
      const trigger = deleteTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [confirmDeleteId]);

  const confirmDelete = () => {
    if (confirmDeleteId) onDelete(confirmDeleteId);
    closeFocusRef.current = 'panel';
    setConfirmDeleteId(null);
  };

  const cancelDelete = () => {
    closeFocusRef.current = 'trigger';
    setConfirmDeleteId(null);
  };

  // Escape dismisses the confirmation; Tab is cycled within its own controls.
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelDelete();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const target = nextFocusable(focusables, document.activeElement, event.shiftKey);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <h2 ref={headingRef} tabIndex={-1} className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
          <Folder className="w-3.5 h-3.5" /> Saved Projects
        </h2>
        {projects.length > 0 && (
          <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
            {projects.length}
          </span>
        )}
      </div>
      <div className="p-4 space-y-2">
        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="h-14 bg-gray-50 border border-gray-100 rounded-xl animate-pulse" />
          ))
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <p className="text-xs text-red-500">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                aria-label="Retry loading saved projects"
                className="text-xs font-semibold text-violet-600 hover:text-violet-500 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5 inline mr-1" /> Retry
              </button>
            )}
          </div>
        ) : projects.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
            No saved projects yet — save your project to find it here.
          </p>
        ) : (
          projects.map(project =>
            confirmDeleteId === project.id ? (
              <div
                key={project.id}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`delete-confirm-title-${project.id}`}
                onKeyDown={handleDialogKeyDown}
                className="border border-red-200 bg-red-50 rounded-xl p-3"
              >
                <p id={`delete-confirm-title-${project.id}`} className="text-xs font-semibold text-red-600">
                  Delete &ldquo;{project.name}&rdquo;? This can&rsquo;t be undone.
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={confirmDelete}
                    aria-label={`Confirm delete ${project.name}`}
                    className="text-xs font-bold bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Delete
                  </button>
                  <button
                    ref={cancelButtonRef}
                    onClick={cancelDelete}
                    aria-label={`Cancel delete ${project.name}`}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 bg-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={project.id}
                className="flex items-center gap-3 border border-gray-100 bg-gray-50 hover:border-gray-200 rounded-xl p-3 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-700 truncate">{project.name}</p>
                  <p className="text-[10px] text-gray-400">Updated {formatUpdatedAt(project.updatedAt)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => onOpen(project.id)}
                    aria-label={`Open ${project.name}`}
                    title="Open this project"
                    className="p-1.5 text-gray-300 hover:text-violet-500 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={event => {
                      deleteTriggerRef.current = event.currentTarget;
                      setConfirmDeleteId(project.id);
                    }}
                    aria-label={`Delete ${project.name}`}
                    title="Delete this project"
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </section>
  );
}
