import type { CaptionMode, CaptionStyle } from '../types';
import { CAPTION_FONT_OPTIONS, ensureFontOption } from '../utils/captionStyle';

const MODE_OPTIONS: Array<{ value: CaptionMode; label: string; desc: string }> = [
  { value: 'lower-third', label: 'Lower Third', desc: 'Classic bar at bottom' },
  { value: 'word-highlight', label: 'Word Highlight', desc: 'Highlights current word' },
  { value: 'speaker-labeled', label: 'Speaker Label', desc: 'Prefixes with "Speaker:"' },
];

interface CaptionStyleEditorProps {
  style: CaptionStyle;
  onChange: (next: CaptionStyle) => void;
}

const labelClass = 'text-xs font-bold uppercase tracking-widest text-gray-400';
const pickerRowClass = 'flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-100 rounded-xl';
const colorInputClass = 'w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent';
const hexClass = 'text-xs font-mono text-gray-500';

/**
 * Presentational caption style editor. Fully props-driven — no local state;
 * the parent owns the CaptionStyle so preview and export stay in sync.
 */
export function CaptionStyleEditor({ style, onChange }: CaptionStyleEditorProps) {
  const fontOptions = ensureFontOption(CAPTION_FONT_OPTIONS, style.fontFamily);
  const update = (patch: Partial<CaptionStyle>) => onChange({ ...style, ...patch });

  return (
    <div className="space-y-5">
      {/* Mode */}
      <div className="space-y-3">
        <p className={labelClass}>Style</p>
        <div className="grid grid-cols-3 gap-3" role="group" aria-label="Caption mode">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={style.mode === opt.value}
              onClick={() => update({ mode: opt.value })}
              className={
                style.mode === opt.value
                  ? 'p-3 rounded-xl border border-violet-500 bg-violet-50 ring-1 ring-violet-300 text-left transition-all'
                  : 'p-3 rounded-xl border border-gray-200 hover:border-gray-300 bg-gray-50 text-left transition-all'
              }
            >
              <p className="text-xs font-semibold text-gray-900">{opt.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Font family */}
      <div className="space-y-2">
        <label htmlFor="caption-font-family" className={labelClass}>Font</label>
        <select
          id="caption-font-family"
          value={style.fontFamily}
          onChange={e => update({ fontFamily: e.target.value })}
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          {fontOptions.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Font size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="caption-font-size" className={labelClass}>Font Size</label>
          <span className="text-xs font-mono font-semibold text-gray-600">{style.fontSize}px</span>
        </div>
        <input
          id="caption-font-size"
          type="range"
          min={12}
          max={36}
          value={style.fontSize}
          onChange={e => update({ fontSize: Number(e.target.value) })}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-600"
        />
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="caption-text-color" className={labelClass}>Text Color</label>
          <div className={pickerRowClass}>
            <input
              id="caption-text-color"
              type="color"
              value={style.color}
              onChange={e => update({ color: e.target.value })}
              className={colorInputClass}
            />
            <span className={hexClass}>{style.color}</span>
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="caption-bg-color" className={labelClass}>Background</label>
          <div className={pickerRowClass}>
            <input
              id="caption-bg-color"
              type="color"
              value={style.bgColor}
              onChange={e => update({ bgColor: e.target.value })}
              className={colorInputClass}
            />
            <span className={hexClass}>{style.bgColor}</span>
          </div>
        </div>
      </div>

      {/* Per-word fill — only meaningful in word-highlight mode */}
      {style.mode === 'word-highlight' && (
        <div className="space-y-2">
          <label htmlFor="caption-word-color" className={labelClass}>Per-word Fill</label>
          <div className={pickerRowClass}>
            <input
              id="caption-word-color"
              type="color"
              value={style.wordHighlightColor}
              onChange={e => update({ wordHighlightColor: e.target.value })}
              className={colorInputClass}
            />
            <span className={hexClass}>{style.wordHighlightColor}</span>
          </div>
          <p className="text-[10px] text-gray-400">Highlight color for the current word as it is spoken.</p>
        </div>
      )}

      {/* Position */}
      <div className="space-y-2">
        <p className={labelClass}>Position</p>
        <div className="flex gap-3" role="group" aria-label="Caption position">
          {(['bottom', 'top'] as const).map(pos => (
            <button
              key={pos}
              type="button"
              aria-pressed={style.position === pos}
              onClick={() => update({ position: pos })}
              className={
                style.position === pos
                  ? 'flex-1 py-2 text-xs font-semibold rounded-xl border border-violet-400 bg-violet-50 text-violet-600 capitalize transition-all'
                  : 'flex-1 py-2 text-xs font-semibold rounded-xl border border-gray-200 bg-gray-50 text-violet-500 hover:border-violet-400 capitalize transition-all'
              }
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
