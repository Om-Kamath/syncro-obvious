import { Volume2, VolumeX } from 'lucide-react';

// Shared visible focus indicator, matching the timeline controls.
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1';

/**
 * Per-project switch for the source video audio. One state drives both the
 * preview playback and the export mix, so the toggle appears wherever the
 * user hears the project: timeline transport and export drawer.
 */
export function MuteOriginalAudioToggle({
  muted,
  onChange,
}: {
  muted: boolean;
  onChange: (muted: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!muted)}
      role="switch"
      aria-checked={muted}
      aria-label={muted ? 'Unmute original video audio' : 'Mute original video audio'}
      title={muted ? 'Original video audio muted — only the voiceover sounds' : 'Original video audio on'}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all border ${FOCUS_RING} ${
        muted
          ? 'bg-gray-100 border-gray-200 text-gray-500 hover:text-violet-600'
          : 'bg-violet-50 border-violet-200 text-violet-600'
      }`}
    >
      {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      {muted ? 'Muted' : 'Audio on'}
    </button>
  );
}
