import { useState } from 'react';
import { FolderOpen, Loader2, Save, Trash2, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { SavedProjectSummary } from '../services/projectPersistence';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ProjectSaveModalProps {
  projects: ReadonlyArray<SavedProjectSummary>;
  isSaving: boolean;
  /** A saved project is being fetched/restored — disables list actions. */
  isRestoring: boolean;
  /** Save failure message; null when the last save succeeded or no save ran. */
  saveError: string | null;
  /** List or open failure message; null when everything loaded. */
  loadError: string | null;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onDismissError: () => void;
  onClose: () => void;
}

/**
 * Save/open projects dialog. Deliberately minimal — the full project modal
 * (list, rename, server-backed records) arrives with campaign PR 27; this
 * covers the save + open + delete round-trip that media persistence needs.
 */
export function ProjectSaveModal({
  projects,
  isSaving,
  isRestoring,
  saveError,
  loadError,
  onSave,
  onLoad,
  onDelete,
  onDismissError,
  onClose,
}: ProjectSaveModalProps) {
  const [name, setName] = useState('');
  const canSave = name.trim().length > 0 && !isSaving;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save or open project"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Projects</h2>
          <p className="text-xs text-gray-400 mt-0.5">Videos and voiceover are stored on the server; project settings in your browser.</p>
        </div>

        <div className="p-6 space-y-5">
          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              if (canSave) onSave(name.trim());
            }}
          >
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Project name"
              aria-label="Project name"
              className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={!canSave}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                canSave
                  ? 'bg-violet-600 hover:bg-violet-700 text-white shadow shadow-violet-200'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </form>

          {saveError && (
            <p role="alert" className="text-xs rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {saveError}
            </p>
          )}

          {loadError ? (
            <div role="alert" className="flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={onDismissError}
                aria-label="Dismiss error"
                className="shrink-0 rounded p-0.5 text-red-400 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <FolderOpen className="h-6 w-6 text-gray-300" aria-hidden="true" />
              <p className="text-sm text-gray-500">No saved projects yet</p>
              <p className="text-xs text-gray-400">Name your project above and save it to keep everything after a reload.</p>
            </div>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto" aria-label="Saved projects">
              {projects.map(project => (
                <li key={project.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{project.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {project.clipCount} clip{project.clipCount === 1 ? '' : 's'}
                      {project.hasVoiceover ? ' · voiceover' : ''} · {formatSavedAt(project.savedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLoad(project.id)}
                    disabled={isRestoring}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                  >
                    {isRestoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(project.id)}
                    disabled={isRestoring || isSaving}
                    aria-label={`Delete project: ${project.name}`}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
