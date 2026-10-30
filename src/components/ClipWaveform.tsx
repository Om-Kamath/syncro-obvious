import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

type WaveformState = 'loading' | 'ready' | 'failed';

interface ClipWaveformProps {
  /** Media URL to decode audio from (blob URL of the clip's file). */
  url: string;
  /** Canvas height in pixels — callers pass the timeline track height. */
  height?: number;
  waveColor?: string;
  progressColor?: string;
}

/**
 * Static, non-interactive waveform for a clip's audio, mirroring the
 * voiceover row's rendering. Media with no decodable audio track fails
 * decoding and renders nothing rather than an empty bar block.
 */
export const ClipWaveform: React.FC<ClipWaveformProps> = ({
  url,
  height = 64,
  waveColor = '#8b5cf6',
  progressColor = '#a78bfa',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [waveformState, setWaveformState] = useState<WaveformState>('loading');
  const [prevUrl, setPrevUrl] = useState(url);

  // Reset when the clip's media changes — React's adjust-state-during-render
  // pattern, so the effect body never sets state synchronously.
  if (url !== prevUrl) {
    setPrevUrl(url);
    setWaveformState('loading');
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    try {
      const instance = WaveSurfer.create({
        container: mount,
        url,
        interact: false,
        cursorWidth: 0,
        height,
        waveColor,
        progressColor,
        normalize: true,
        barWidth: 2,
        barRadius: 3,
      });
      instance.on('ready', () => { if (!disposed) setWaveformState('ready'); });
      instance.on('error', () => { if (!disposed) setWaveformState('failed'); });
      return () => { disposed = true; instance.destroy(); };
    } catch (error) {
      // Environments without Web Audio can never render a waveform; degrade
      // to a hidden underlay (the lane falls back to its plain look) instead
      // of crashing the timeline.
      console.error('ClipWaveform: WaveSurfer unavailable for clip audio', error);
      return;
    }
  }, [url, height, waveColor, progressColor]);

  return (
    <div
      data-clip-waveform={waveformState}
      aria-hidden="true"
      className="h-full w-full overflow-hidden"
      style={{ visibility: waveformState === 'ready' ? 'visible' : 'hidden' }}
    >
      <div ref={mountRef} className="h-full w-full" />
    </div>
  );
};
