import { useRef, useState } from 'react';
import { Music, Plus, X } from 'lucide-react';

// Empty type is common for files added on mobile systems — fall back to extension.
const AUDIO_FILE_PATTERN = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;

export const DEFAULT_MUSIC_VOLUME = 0.25;

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MusicPanelProps {
  file: File | null;
  /** Gain applied to the music source under the 100% narration track, 0..1. */
  volume: number;
  disabled?: boolean;
  onFileChange: (file: File | null) => void;
  onVolumeChange: (volume: number) => void;
}

export function MusicPanel({ file, volume, disabled = false, onFileChange, onVolumeChange }: MusicPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePick = (picked: File | null) => {
    if (!picked) return;
    if (!isAudioFile(picked)) {
      setError(`"${picked.name}" is not an audio file — pick mp3, wav, m4a, ogg, or flac.`);
      return;
    }
    setError(null);
    onFileChange(picked);
  };

  const handleRemove = () => {
    setError(null);
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="p-3 bg-white border border-gray-200 rounded-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-violet-100 text-violet-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Music className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900">Background Music</p>
            <p className="text-[10px] text-gray-400">Mixed under the narration in the exported video</p>
          </div>
        </div>
        {file && (
          <button
            onClick={handleRemove}
            disabled={disabled}
            aria-label="Remove background music"
            className="p-1.5 text-gray-400 rounded-lg hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50 flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.oga,.flac,.opus,.aac"
        className="hidden"
        onChange={e => handlePick(e.target.files?.[0] ?? null)}
        aria-label="Pick background music file"
      />

      {file ? (
        <div className="flex items-center justify-between p-2 bg-gray-50 border border-gray-100 rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <Music className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate max-w-[220px]">{file.name}</p>
              <p className="text-[10px] text-violet-500">{formatFileSize(file.size)} · Music</p>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex flex-col items-center gap-1 py-4 border border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-violet-300 hover:text-violet-500 transition-all disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span className="text-xs font-semibold">Add music track</span>
          <span className="text-[10px]">Leave out to export with narration only</span>
        </button>
      )}

      {file && (
        <label className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wider flex-shrink-0">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={disabled}
            onChange={e => onVolumeChange(Number(e.target.value))}
            className="flex-1 accent-violet-500"
            aria-label="Background music volume"
          />
          <span className="text-[11px] font-mono text-gray-600 w-10 text-right">{Math.round(volume * 100)}%</span>
        </label>
      )}

      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
