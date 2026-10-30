import { useState } from 'react';
import { motion } from 'motion/react';
import { Check, FolderOpen, Loader2, Pencil, Play, Save, Trash2, X } from 'lucide-react';
import type { SavedProjectSummary } from '../services/projectPersistence';

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export interface ProjectsModalProps {
  projects: SavedProjectSummary[];
  loading: boolean;
  /** Failure from the last projects-API call; rendered as a retryable banner. */
  error: string | null;
  saving: boolean;
  /** True when there is an editor state worth saving (non-empty timeline). */
  canSave: boolean;
  /** Project currently loaded in the editor, if any. */
  currentProjectId: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  /** Present when the parent can clear the error (main's dismiss path). */
  onDismissError?: () => void;
}

/**
 * Presentational project picker: list, save, load, rename, delete.
 * All data and mutations arrive via props — the caller (App) owns fetching.
 */
export function ProjectsModal({
  projects,
  loading,
  error,
  saving,
  canSave,
  currentProjectId,
  onClose,
  onSave,
  onLoad,
  onRename,
  onDelete,
  onRefresh,
  onDismissError,
}: ProjectsModalProps) {
  const [saveName, setSaveName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const startRename = (project: SavedProjectSummary) => {
    setConfirmingDeleteId(null);
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const confirmRename = () => {
    const name = renameValue.trim();
    if (!renamingId || !name) return;
    onRename(renamingId, name);
    setRenamingId(null);
  };

  const submitSave = () => {
    const name = saveName.trim();
    if (!name || saving) return;
    onSave(name);
    setSaveName('');
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Saved projects"
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-10 h-10 bg-violet-100 rounded-2xl flex items-center justify-center">
            <FolderOpen className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Projects</h2>
            <p className="text-xs text-gray-400">Save your edit and come back to it later</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close projects"
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors text-sm font-bold"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex gap-2">
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitSave(); }}
              placeholder="Name this project…"
              aria-label="Project name"
              disabled={!canSave || saving}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              onClick={submitSave}
              disabled={!canSave || saving || !saveName.trim()}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold transition-colors shadow shadow-violet-200 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!canSave && (
            <p className="text-xs text-gray-400 mt-2">Add a video or voiceover first — there is nothing to save yet.</p>
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            Your edit (clips, trims, captions, voiceover) is saved. Media reattaches automatically when you reload.
          </p>
        </div>

        {error && (
          <div role="alert" className="mx-6 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-600 flex items-center justify-between gap-3">
            <span>{error}</span>
            <span className="flex items-center gap-1.5">
              {onDismissError && (
                <button onClick={onDismissError} aria-label="Dismiss error" className="px-2 py-1 rounded-lg text-red-500 hover:text-red-700 font-semibold transition-colors">
                  ✕
                </button>
              )}
              <button onClick={onRefresh} className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold transition-colors">
                Retry
              </button>
            </span>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12" role="status" aria-label="Loading projects">
              <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
              <span className="text-xs text-gray-500">Loading projects…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <FolderOpen className="w-8 h-8 text-gray-300" />
              <p className="text-sm font-semibold text-gray-500">No saved projects yet</p>
              <p className="text-xs text-gray-400">Name your current edit above and hit Save to keep it.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {projects.map(project => (
                <li
                  key={project.id}
                  className={cn(
                    'px-4 py-3 rounded-xl border transition-colors',
                    project.id === currentProjectId ? 'border-violet-200 bg-violet-50' : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                  )}
                >
                  {renamingId === project.id ? (
                    <div className="flex gap-2">
                      <input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                        aria-label="New project name"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <button
                        onClick={confirmRename}
                        aria-label={`Confirm rename of ${project.name}`}
                        className="p-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        aria-label={`Cancel rename of ${project.name}`}
                        className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 truncate">{project.name}</span>
                          {project.id === currentProjectId && (
                            <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 text-[10px] font-bold uppercase tracking-wide">
                              Loaded
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {project.clipCount} clip{project.clipCount === 1 ? '' : 's'} ·
                          saved {formatDate(project.savedAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => onLoad(project.id)}
                        disabled={project.id === currentProjectId}
                        className={cn(
                          'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                          project.id === currentProjectId
                            ? 'bg-violet-100 text-violet-400 cursor-default'
                            : 'bg-violet-600 hover:bg-violet-700 text-white shadow shadow-violet-200'
                        )}
                      >
                        <Play className="w-3 h-3" /> Load
                      </button>
                      <button
                        onClick={() => startRename(project)}
                        aria-label={`Rename ${project.name}`}
                        className="p-2 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {confirmingDeleteId === project.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { onDelete(project.id); setConfirmingDeleteId(null); }}
                            aria-label={`Confirm delete of ${project.name}`}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold transition-colors"
                          >
                            Delete?
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(null)}
                            aria-label={`Cancel delete of ${project.name}`}
                            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setRenamingId(null); setConfirmingDeleteId(project.id); }}
                          aria-label={`Delete ${project.name}`}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}
