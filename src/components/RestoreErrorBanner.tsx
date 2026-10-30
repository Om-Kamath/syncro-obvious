import { AlertTriangle, X } from 'lucide-react';
import type { ClipRestoreError } from '../services/projectPersistence';

interface RestoreErrorBannerProps {
  errors: ReadonlyArray<ClipRestoreError>;
  voiceoverError?: string | null;
  onDismiss: () => void;
}

/**
 * Per-clip restore errors, shown after loading a project whose saved blobs
 * could not all be fetched. Clip metadata still lands in the timeline — the
 * banner explains which clips lost their media and why.
 */
export function RestoreErrorBanner({ errors, voiceoverError, onDismiss }: RestoreErrorBannerProps) {
  if (errors.length === 0 && !voiceoverError) return null;

  return (
    <div role="alert" aria-live="polite" className="col-span-12 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">Some media could not be restored</p>
        <ul className="mt-1 list-disc pl-4 space-y-0.5">
          {errors.map(error => (
            <li key={error.clipId}>
              <span className="font-medium">{error.name}</span> — {error.reason} Clip settings were restored; re-add the video file to play it.
            </li>
          ))}
          {voiceoverError && <li><span className="font-medium">Voiceover</span> — {voiceoverError}</li>}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss restore warnings"
        className="shrink-0 rounded-full p-1.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
