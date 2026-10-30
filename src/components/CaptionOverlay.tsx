import { CaptionSegment, CaptionStyle } from '../types';
import { resolveWordTimings, findActiveWordIndex } from '../utils/wordTiming';

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// Live caption overlay drawn over the video preview. Rendering is driven
// entirely by the CaptionStyle it receives, so style presets are visible here
// the moment they are applied.
export function CaptionOverlay({
  segments,
  currentTime,
  style,
}: {
  segments: CaptionSegment[];
  currentTime: number;
  style: CaptionStyle;
}) {
  const seg = segments.find(s => currentTime >= s.start && currentTime <= s.end);
  if (!seg) return null;
  const baseContainer = cn(
    'absolute left-0 right-0 px-6 pointer-events-none z-10 flex justify-center',
    style.position === 'bottom' ? 'bottom-6' : 'top-6'
  );
  if (style.mode === 'word-highlight') {
    const words = resolveWordTimings(seg);
    const wordIdx = findActiveWordIndex(words, currentTime);
    return (
      <div className={baseContainer}>
        <div className="px-4 py-2 rounded-xl flex flex-wrap gap-x-1.5 gap-y-1 justify-center max-w-2xl"
          style={{ backgroundColor: style.bgColor, fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily }}>
          {words.map((w, i) => (
            <span key={i} style={{ color: i === wordIdx ? style.wordHighlightColor : style.color, fontWeight: i === wordIdx ? 700 : 500, transition: 'color 0.1s' }}>{w.word}</span>
          ))}
        </div>
      </div>
    );
  }
  if (style.mode === 'speaker-labeled') {
    return (
      <div className={baseContainer}>
        <div className="px-4 py-2 rounded-xl max-w-2xl" style={{ backgroundColor: style.bgColor, fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily }}>
          <span style={{ color: '#7c3aed', fontWeight: 700, marginRight: '8px' }}>Speaker:</span>
          <span style={{ color: style.color }}>{seg.text}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={baseContainer}>
      <div className="px-5 py-2.5 rounded-xl max-w-2xl text-center"
        style={{ backgroundColor: style.bgColor, color: style.color, fontSize: `${style.fontSize}px`, fontFamily: style.fontFamily, fontWeight: 600 }}>
        {seg.text}
      </div>
    </div>
  );
}
