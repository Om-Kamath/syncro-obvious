import React, { useEffect, useRef, useState, useCallback, useReducer } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { VideoClip, Voiceover, TransitionType } from '../types';
import { ClipWaveform } from './ClipWaveform';
import { applyFrameTrim, clipFps, frameDuration } from '../utils/trimMath';
import { Play, Pause, Scissors, Wand2, Video, Plus, Minus, Maximize2, Zap, Layers, Star, Trash2, AlertTriangle, Keyboard } from 'lucide-react';
import { DEFAULT_PPS, fitPixelsPerSecond, stepPixelsPerSecond } from '../utils/timelineZoom';
import { findClipAtPlayhead, splitClipsAtPlayhead } from '../utils/clipSplit';
import { selectionReducer, initialSelection, clipIdsInRect, type SelectionAction } from '../utils/selectionReducer';
import { collectSnapCandidates, findSnap } from '../utils/timelineSnap';
import { estimateAlignmentFlowCost } from '../services/costEstimate';
import { CostEstimateBadge } from './CostEstimateBadge';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Shared visible focus indicator for every interactive timeline control.
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1';

/** Imperative playback controls App-level shortcuts drive; the clock stays in the Timeline. */
export interface TimelineTransport {
  togglePlay: () => void;
  pause: () => void;
  seekBy: (deltaSeconds: number) => void;
}

interface TimelineProps {
  voiceover: Voiceover | null;
  videoClips: VideoClip[];
  onVideoClipChange: (clips: VideoClip[]) => void;
  onVoiceoverChange?: (voiceover: Voiceover) => void;
  onAutoAlign: () => void;
  onSwapClip?: (clipId: string, altId: string) => void;
  onDeleteClip?: (id: string) => void;
  onDeleteClips?: (ids: string[]) => void;
  isAligning: boolean;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onTransportReady?: (transport: TimelineTransport | null) => void;
}

interface ClipDragState {
  id: string;
  startMouseX: number;
  startClipTime: number;
  startTrack: number;
  /** Clips that move together with the dragged one — the whole multi-selection. */
  group: Array<{ id: string; startTime: number; track: number }>;
}

type TrimSide = 'left' | 'right';

// Map the math module's 'in'/'out' onto the handle sides used in this file.
const trimSide = (side: TrimSide): 'in' | 'out' => (side === 'left' ? 'in' : 'out');

interface TrimDragState {
  id: string;
  side: TrimSide;
  startMouseX: number;
  origTrimStart: number;
  origTrimmedDuration: number;
  origDuration: number;
  origStartTime: number;
}

/** Marquee rectangle in video-tracks container coordinates: press origin + current point. */
interface MarqueeState {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

const TRANSITION_OPTIONS: { value: TransitionType; label: string; icon: string }[] = [
  { value: 'cut',      label: 'Cut',      icon: '✂️' },
  { value: 'fade',     label: 'Fade',     icon: '🌅' },
  { value: 'dissolve', label: 'Dissolve', icon: '💧' },
  { value: 'wipe',     label: 'Wipe',     icon: '➡️' },
];

const SHORTCUT_HINTS: { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: 'Play / Pause' },
  { keys: ['J'], label: 'Back 1s' },
  { keys: ['K'], label: 'Pause' },
  { keys: ['L'], label: 'Forward 1s' },
  { keys: ['←', '→'], label: 'Frame step (1/30s)' },
];

const TRACK_H = 64;
const TRACK_GAP = 16;
const TRACK_ROW_H = TRACK_H + TRACK_GAP;
const TRACK_LABEL_W = 36;

export const Timeline: React.FC<TimelineProps> = ({
  voiceover,
  videoClips,
  onVideoClipChange,
  onAutoAlign,
  onSwapClip,
  onDeleteClip,
  onDeleteClips,
  isAligning,
  currentTime,
  onTimeUpdate,
  onVoiceoverChange,
  onTransportReady,
}) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const videoTracksContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [draggingTrimId, setDraggingTrimId] = useState<string | null>(null);
  const [isDraggingVoiceover, setIsDraggingVoiceover] = useState(false);
  const [extraTracks, setExtraTracks] = useState(0);
  const [transitionPopoverId, setTransitionPopoverId] = useState<string | null>(null);
  const [transitionPopoverPos, setTransitionPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [altPopover, setAltPopover] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const [selection, dispatchSelection] = useReducer(selectionReducer, initialSelection);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const clipDragRef = useRef<ClipDragState | null>(null);
  const selectionRef = useRef(selection);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const marqueeMovedRef = useRef(false);
  const trimDragRef = useRef<TrimDragState | null>(null);
  const voiceoverDragRef = useRef<{ startMouseX: number; startClipTime: number } | null>(null);
  const videoClipsRef = useRef(videoClips);
  const voiceoverRef = useRef(voiceover);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { videoClipsRef.current = videoClips; }, [videoClips]);
  useEffect(() => { voiceoverRef.current = voiceover; }, [voiceover]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(DEFAULT_PPS);
  const TRACK_PADDING = TRACK_LABEL_W + 8; // label width + gap-2 (8px) = where lane content starts

  const voiceoverEffectiveDuration = voiceover
    ? (voiceover.trimEnd ?? voiceover.duration) - (voiceover.trimStart ?? 0)
    : 0;

  const totalDuration = Math.max(
    (voiceover?.startTime ?? 0) + voiceoverEffectiveDuration,
    ...videoClips.map((c) => c.startTime + (c.trimmedDuration ?? c.duration)),
    10
  );

  const usedTracks = videoClips.length > 0 ? Math.max(...videoClips.map(c => c.track ?? 0)) + 1 : 1;
  const numTracks = Math.max(2, usedTracks, extraTracks + 1);

  // Timeline order for shift-click range selection.
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);
  const orderedClipIds = sortedClips.map((c) => c.id);

  const handleZoom = useCallback((direction: 1 | -1) => {
    setPixelsPerSecond(pps => stepPixelsPerSecond(pps, direction));
  }, []);

  const handleFitToWindow = useCallback(() => {
    const availableWidth = trackAreaRef.current?.clientWidth ?? 0;
    setPixelsPerSecond(fitPixelsPerSecond(totalDuration, availableWidth));
  }, [totalDuration]);

  // Blade the clip under the playhead. Refs keep the handler stable; the
  // right half mints its own blob URL so per-clip revoke-on-delete stays valid.
  const handleSplitAtPlayhead = useCallback(() => {
    const next = splitClipsAtPlayhead(
      videoClipsRef.current,
      currentTimeRef.current,
      Math.random().toString(36).slice(2, 11),
      (clip) => URL.createObjectURL(clip.file),
    );
    if (next) onVideoClipChange(next);
  }, [onVideoClipChange]);

  const seekToTime = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, totalDuration));
    onTimeUpdate(clamped);
    if (wavesurfer.current && voiceover) {
      const vStartTime = voiceover.startTime ?? 0;
      const vTrimStart = voiceover.trimStart ?? 0;
      const vDuration = voiceover.trimEnd ? voiceover.trimEnd - vTrimStart : voiceover.duration - vTrimStart;
      const relative = clamped - vStartTime;
      if (relative < 0) wavesurfer.current.seekTo(vTrimStart / voiceover.duration);
      else if (relative > vDuration) wavesurfer.current.seekTo((vTrimStart + vDuration) / voiceover.duration);
      else wavesurfer.current.seekTo((vTrimStart + relative) / voiceover.duration);
    }
  }, [onTimeUpdate, totalDuration, voiceover]);

  const getXFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!trackAreaRef.current) return 0;
    const rect = trackAreaRef.current.getBoundingClientRect();
    return e.clientX - rect.left + trackAreaRef.current.scrollLeft - TRACK_PADDING;
  }, [TRACK_PADDING]);

  const getTimeFromX = useCallback((x: number) => x / pixelsPerSecond, []);

  // Snap targets for drag/trim gestures: the origin, the playhead, and every
  // other clip's boundaries (excluding the clip being manipulated so an edge
  // never snaps to itself). Reads via refs so drag effects stay live.
  const snapTargets = (excludeId?: string) =>
    collectSnapCandidates(videoClipsRef.current, currentTimeRef.current, excludeId);

  useEffect(() => {
    if (waveformRef.current && voiceover) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#8b5cf6', progressColor: '#a78bfa', cursorColor: '#ffffff',
        barWidth: 2, barRadius: 3, height: 80, interact: false, url: voiceover.url,
      });
      wavesurfer.current.on('ready', () => {
        const trimStart = voiceover.trimStart ?? 0;
        if (trimStart > 0) wavesurfer.current?.seekTo(trimStart / voiceover.duration);
      });
      return () => { wavesurfer.current?.destroy(); wavesurfer.current = null; };
    }
  }, [voiceover]);

  useEffect(() => {
    if (!isPlaying) { if (wavesurfer.current?.isPlaying()) wavesurfer.current.pause(); return; }
    let frameId: number;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      const nextTime = currentTimeRef.current + delta;
      if (nextTime >= totalDuration) { setIsPlaying(false); onTimeUpdate(totalDuration); if (wavesurfer.current?.isPlaying()) wavesurfer.current.pause(); return; }
      onTimeUpdate(nextTime);
      if (wavesurfer.current && voiceover) {
        const vStartTime = voiceover.startTime ?? 0;
        const vTrimStart = voiceover.trimStart ?? 0;
        const vDuration = voiceover.trimEnd ? voiceover.trimEnd - vTrimStart : voiceover.duration - vTrimStart;
        const relative = nextTime - vStartTime;
        if (relative >= 0 && relative < vDuration) {
          if (!wavesurfer.current.isPlaying()) { wavesurfer.current.seekTo((vTrimStart + relative) / voiceover.duration); wavesurfer.current.play().catch(() => {}); }
        } else { if (wavesurfer.current.isPlaying()) wavesurfer.current.pause(); }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, totalDuration, onTimeUpdate, voiceover]);

  useEffect(() => {
    if (!isDraggingPlayhead) return;
    const onMove = (e: MouseEvent) => seekToTime(getTimeFromX(getXFromMouseEvent(e)));
    const onUp = () => setIsDraggingPlayhead(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingPlayhead, seekToTime, getXFromMouseEvent, getTimeFromX]);

  useEffect(() => {
    if (!isDraggingVoiceover) return;
    const onMove = (e: MouseEvent) => {
      const drag = voiceoverDragRef.current;
      const currentVo = voiceoverRef.current;
      if (!drag || !currentVo) return;
      const deltaTime = (e.clientX - drag.startMouseX) / pixelsPerSecond;
      if (onVoiceoverChange) onVoiceoverChange({ ...currentVo, startTime: Math.max(0, drag.startClipTime + deltaTime) });
    };
    const onUp = () => { voiceoverDragRef.current = null; setIsDraggingVoiceover(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingVoiceover, onVoiceoverChange]);

  // Pure overlap-resolution for clip layout — declared before the drag effect
  // that consumes it (hoisted here so closures capture a stable definition).
  const resolveOverlaps = (clips: VideoClip[]): VideoClip[] => {
    const byTrack: Record<number, VideoClip[]> = {};
    for (const c of clips) { const t = c.track ?? 0; if (!byTrack[t]) byTrack[t] = []; byTrack[t].push(c); }
    const result: VideoClip[] = [];
    for (const track of Object.values(byTrack)) {
      const sorted = [...track].sort((a, b) => a.startTime - b.startTime);
      result.push(...sorted.map((clip, i) => {
        const eff = clip.trimmedDuration ?? (clip.duration - (clip.trimStart ?? 0));
        const next = sorted[i + 1];
        if (next && clip.startTime + eff > next.startTime) return { ...clip, trimmedDuration: Math.max(0, next.startTime - clip.startTime) };
        return clip;
      }));
    }
    return result;
  };

  useEffect(() => {
    if (!draggingClipId) return;
    const onMove = (e: MouseEvent) => {
      const drag = clipDragRef.current;
      if (!drag) return;
      const deltaTime = (e.clientX - drag.startMouseX) / pixelsPerSecond;
      // Snap the dragged clip's leading edge to a nearby boundary (origin,
      // playhead, or a neighboring clip edge) by correcting the group delta;
      // group members keep their offsets, matching multi-select semantics.
      const rawStart = drag.startClipTime + deltaTime;
      const snapAdjust = findSnap(rawStart, snapTargets(drag.id), pixelsPerSecond).time - rawStart;
      const groupDeltaTime = deltaTime + snapAdjust;
      let trackDelta = 0;
      if (videoTracksContainerRef.current) {
        const rect = videoTracksContainerRef.current.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const currentMax = Math.max(1, ...videoClipsRef.current.map(c => c.track ?? 0));
        const targetTrack = Math.max(0, Math.min(currentMax + 1, Math.floor(relY / TRACK_ROW_H)));
        trackDelta = targetTrack - drag.startTrack;
      }
      // Move the whole drag group by the same time/track delta; the dragged
      // clip's own startTime/track match the pre-group single-drag math.
      const group = new Map(drag.group.map((g) => [g.id, g]));
      onVideoClipChange(videoClipsRef.current.map(c => {
        const start = group.get(c.id);
        if (!start) return c;
        return { ...c, startTime: Math.max(0, start.startTime + groupDeltaTime), track: Math.max(0, start.track + trackDelta) };
      }));
    };
    const onUp = () => { clipDragRef.current = null; setDraggingClipId(null); onVideoClipChange(resolveOverlaps(videoClipsRef.current)); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingClipId]);

  // Marquee selection: track the pointer while pressed on empty track area and
  // select every clip intersecting the drawn rectangle on release. Geometry
  // lives in marqueeRef so the listeners survive per-move re-renders.
  useEffect(() => {
    if (!marquee) return;
    const onMove = (e: MouseEvent) => {
      const rect = videoTracksContainerRef.current?.getBoundingClientRect();
      const start = marqueeRef.current;
      if (!rect || !start) return;
      marqueeMovedRef.current = true;
      const next = { originX: start.originX, originY: start.originY, x: e.clientX - rect.left, y: e.clientY - rect.top };
      marqueeRef.current = next;
      setMarquee(next);
    };
    const onUp = () => {
      const start = marqueeRef.current;
      marqueeRef.current = null;
      setMarquee(null);
      if (!start || !marqueeMovedRef.current) return; // zero-move press = plain click
      const boxes = videoClipsRef.current.map((c) => ({
        id: c.id,
        left: TRACK_PADDING + c.startTime * pixelsPerSecond,
        top: (c.track ?? 0) * TRACK_ROW_H,
        width: (c.trimmedDuration ?? c.duration) * pixelsPerSecond,
        height: TRACK_H,
      }));
      dispatchSelection({
        type: 'set',
        ids: clipIdsInRect(boxes, { left: start.originX, top: start.originY, width: start.x - start.originX, height: start.y - start.originY }),
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [marquee, pixelsPerSecond, TRACK_PADDING]);

  const handleTrimHandleMouseDown = (e: React.MouseEvent, clip: VideoClip, side: TrimSide) => {
    e.stopPropagation(); e.preventDefault();
    trimDragRef.current = {
      id: clip.id, side, startMouseX: e.clientX,
      origTrimStart: clip.trimStart ?? 0,
      origTrimmedDuration: clip.trimmedDuration ?? (clip.duration - (clip.trimStart ?? 0)),
      origDuration: clip.duration, origStartTime: clip.startTime,
    };
    setDraggingTrimId(clip.id);
  };

  // Frame-accurate trim shared by mouse drag and keyboard. `base` is the clip
  // state the delta applies to: the drag-start snapshot for mouse drags
  // (deltaSec is the total displacement — applying it to the live clip would
  // compound every mousemove) or the live clip for keyboard (one frame per
  // press). In-trims compensate startTime so the clip's visible left edge
  // stays where the user grabbed it (historical drag-handle behavior).
  const trimFrom = (base: VideoClip, side: TrimSide, deltaSec: number): VideoClip => {
    const next = applyFrameTrim(base, trimSide(side), deltaSec);
    if (side !== 'left') return next;
    const deltaIn = (next.trimStart ?? 0) - (base.trimStart ?? 0);
    return { ...next, startTime: Math.max(0, base.startTime + deltaIn) };
  };

  useEffect(() => {
    if (!draggingTrimId) return;
    const onMove = (e: MouseEvent) => {
      const drag = trimDragRef.current;
      if (!drag) return;
      const deltaSec = (e.clientX - drag.startMouseX) / pixelsPerSecond;
      onVideoClipChange(videoClipsRef.current.map((c: VideoClip) => {
        if (c.id !== drag.id) return c;
        // Main's semantic snapping first (neighbors/playhead in timeline
        // space), then trimFrom applies the delta from the drag-start
        // snapshot with frame-grid snapping and clamping.
        const snapshot = {
          ...c,
          trimStart: drag.origTrimStart > 0 ? drag.origTrimStart : undefined,
          trimmedDuration: drag.origTrimmedDuration,
          startTime: drag.origStartTime,
        };
        if (drag.side === 'right') {
          const rawEnd = drag.origStartTime + drag.origTrimmedDuration + deltaSec;
          const snappedEnd = findSnap(rawEnd, snapTargets(drag.id), pixelsPerSecond).time;
          return trimFrom(snapshot, 'right', snappedEnd - (drag.origStartTime + drag.origTrimmedDuration));
        }
        const rawStart = drag.origStartTime + deltaSec;
        const snappedStart = findSnap(rawStart, snapTargets(drag.id), pixelsPerSecond).time;
        return trimFrom(snapshot, 'left', snappedStart - drag.origStartTime);
      }));
    };
    const onUp = () => { trimDragRef.current = null; setDraggingTrimId(null); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingTrimId]);

  const togglePlay = () => setIsPlaying(p => !p);

  // Imperative transport handle: the clock, its clamping, and the wavesurfer
  // sync stay here — App's global shortcuts just press the buttons.
  useEffect(() => {
    if (!onTransportReady) return;
    onTransportReady({
      togglePlay: () => setIsPlaying(p => !p),
      pause: () => setIsPlaying(false),
      seekBy: (deltaSeconds: number) => seekToTime(currentTimeRef.current + deltaSeconds),
    });
    return () => onTransportReady(null);
  }, [onTransportReady, seekToTime]);

  const handleTrackClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    // A marquee drag suppresses the click-to-seek that follows its mouseup.
    if (marqueeMovedRef.current) { marqueeMovedRef.current = false; return; }
    seekToTime(getTimeFromX(getXFromMouseEvent(e)));
  };
  // Press on empty track area starts a marquee (clips stopPropagation on their
  // own mousedown; buttons/sliders are excluded by the closest() guard).
  const handleTracksMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-clip], button, [role="slider"]')) return;
    const rect = videoTracksContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    marqueeMovedRef.current = false;
    marqueeRef.current = { originX: x, originY: y, x, y };
    dispatchSelection({ type: 'clear' });
    setMarquee({ originX: x, originY: y, x, y });
  };
  const handleClipMouseDown = (e: React.MouseEvent, clip: VideoClip) => {
    e.stopPropagation(); e.preventDefault();
    setTransitionPopoverId(null);
    let action: SelectionAction | null = null;
    if (e.shiftKey) {
      action = { type: 'extend', id: clip.id, orderedIds: orderedClipIds };
    } else if (e.ctrlKey || e.metaKey) {
      action = { type: 'toggle', id: clip.id };
    } else if (!selectionRef.current.ids.has(clip.id)) {
      action = { type: 'select', id: clip.id };
    }
    // Group membership resolves from the selection *after* the click's
    // modifier effect — dragging a selected clip moves the whole selection.
    const nextSelection = action ? selectionReducer(selectionRef.current, action) : selectionRef.current;
    if (action) dispatchSelection(action);
    const groupIds = nextSelection.ids.has(clip.id) ? [...nextSelection.ids] : [clip.id];
    const group = videoClipsRef.current
      .filter((c) => groupIds.includes(c.id))
      .map((c) => ({ id: c.id, startTime: c.startTime, track: c.track ?? 0 }));
    clipDragRef.current = { id: clip.id, startMouseX: e.clientX, startClipTime: clip.startTime, startTrack: clip.track ?? 0, group };
    setDraggingClipId(clip.id);
  };
  const deleteClipSelection = (clip: VideoClip) => {
    if (!onDeleteClips) return;
    const ids = selectionRef.current.ids.has(clip.id) ? [...selectionRef.current.ids] : [clip.id];
    onDeleteClips(ids);
    dispatchSelection({ type: 'clear' });
  };
  // Keyboard mirror of the mouse trim drag — same frame-snapped math, one
  // frame per press (shift = one second worth of frames).
  const handleTrimKeyDown = (e: React.KeyboardEvent, clip: VideoClip, side: TrimSide) => {
    const step = e.shiftKey ? 1 : frameDuration(clip.fps);
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -step;
    else if (e.key === 'ArrowRight') delta = step;
    else return;
    e.preventDefault(); e.stopPropagation();
    onVideoClipChange(videoClipsRef.current.map((c: VideoClip) =>
      c.id !== clip.id ? c : trimFrom(c, side, delta)
    ));
  };
  const handleVoiceoverMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (!voiceover) return;
    voiceoverDragRef.current = { startMouseX: e.clientX, startClipTime: voiceover.startTime ?? 0 };
    setIsDraggingVoiceover(true);
  };
  const handleTransitionChange = (clipId: string, type: TransitionType) => {
    onVideoClipChange(videoClips.map(c => c.id === clipId ? { ...c, transitionIn: type } : c));
    setTransitionPopoverId(null);
  };

  // Split is only offered strictly inside a clip — at a boundary it would be a no-op.
  const clipAtPlayhead = findClipAtPlayhead(videoClips, currentTime);
  const canSplitAtPlayhead = !!clipAtPlayhead && currentTime > clipAtPlayhead.startTime;

  // Pre-run estimate for the whole Auto-Align flow: transcription (when the
  // uploaded voiceover hasn't been transcribed yet) + un-analyzed clip
  // analysis + alignment.
  const alignmentEstimate = voiceover && videoClips.length > 0
    ? estimateAlignmentFlowCost({
        transcriptionDurationSec: voiceover.file && !voiceover.transcription ? voiceover.duration : 0,
        transcriptionChars: voiceover.transcription?.length ?? 0,
        unanalyzedClipDurationsSec: videoClips.filter(c => !c.analysis).map(c => c.duration),
        analysisChars: videoClips.reduce((s, c) => s + (c.analysis?.length ?? 0), 0),
      })
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'} className={`p-2 rounded-full bg-violet-600 text-white hover:bg-violet-500 transition-colors ${FOCUS_RING}`}>
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <span className="text-xs font-mono text-gray-400">{currentTime.toFixed(2)}s / {totalDuration.toFixed(2)}s</span>
          <div className="w-px h-4 bg-gray-200" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleZoom(-1)}
              title="Zoom out"
              aria-label="Zoom out timeline"
              className={`p-1.5 rounded-lg text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-all ${FOCUS_RING}`}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono text-gray-400 w-12 text-center" title="Timeline scale">{Math.round(pixelsPerSecond)}px/s</span>
            <button
              onClick={() => handleZoom(1)}
              title="Zoom in"
              aria-label="Zoom in timeline"
              className={`p-1.5 rounded-lg text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-all ${FOCUS_RING}`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFitToWindow}
              title="Fit timeline to window"
              aria-label="Fit timeline to window"
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-all ${FOCUS_RING}`}
            >
              <Maximize2 className="w-3.5 h-3.5" /> Fit
            </button>
          </div>
          <div className="w-px h-4 bg-gray-200" />
          <button
            onClick={handleSplitAtPlayhead}
            disabled={!canSplitAtPlayhead}
            title="Split clip at playhead"
            aria-label="Split clip at playhead"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:text-gray-500 disabled:hover:bg-white ${FOCUS_RING}`}
          >
            <Scissors className="w-3.5 h-3.5" /> Split
          </button>
          <button
            onClick={() => setExtraTracks(t => t + 1)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition-all ${FOCUS_RING}`}
          >
            <Plus className="w-3.5 h-3.5" /> Add Track
          </button>
          {selection.ids.size >= 2 && onDeleteClips && (
            <div role="status" aria-label={`${selection.ids.size} clips selected`} className="flex items-center gap-1 pl-1">
              <span className="text-xs font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-2 py-1.5">
                {selection.ids.size} selected
              </span>
              <button
                onClick={() => { onDeleteClips([...selection.ids]); dispatchSelection({ type: 'clear' }); }}
                title="Delete selected clips"
                aria-label={`Delete ${selection.ids.size} selected clips`}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-white border border-red-200 hover:bg-red-50 transition-all ${FOCUS_RING}`}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowShortcutsHelp(v => !v)}
              aria-label="Keyboard shortcuts"
              aria-expanded={showShortcutsHelp}
              className={`p-1.5 rounded-lg text-gray-500 bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-all ${FOCUS_RING}`}
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
            {showShortcutsHelp && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => setShowShortcutsHelp(false)} />
                <div role="note" aria-label="Keyboard shortcut cheat sheet" className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Keyboard shortcuts</p>
                  <dl className="text-xs text-gray-600 space-y-1.5">
                    {SHORTCUT_HINTS.map((hint) => (
                      <div key={hint.label} className="flex items-center justify-between gap-4">
                        <dt className="flex items-center gap-1">
                          {hint.keys.map((k) => (
                            <kbd key={k} className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 font-mono text-[10px] text-gray-500">{k}</kbd>
                          ))}
                        </dt>
                        <dd className="text-right">{hint.label}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                    Shortcuts stand down while a text field or timeline control has focus.
                  </p>
                </div>
              </>
            )}
          </div>
          {alignmentEstimate && <CostEstimateBadge estimate={alignmentEstimate} />}
          <button
            onClick={onAutoAlign}
            disabled={isAligning || !voiceover || videoClips.length === 0}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed', isAligning && 'animate-pulse', FOCUS_RING)}
          >
            <Wand2 className="w-4 h-4" />
            {isAligning ? 'Analyzing…' : 'Auto-Align with AI'}
          </button>
        </div>
      </div>

      {/* Scrollable track area */}
      <div
        ref={trackAreaRef}
        className={cn('relative overflow-x-auto bg-gray-50', isDraggingPlayhead && 'cursor-ew-resize select-none')}
        style={{ minHeight: `${28 + 16 + 80 + 16 + numTracks * TRACK_ROW_H + 16}px` }}
        onClick={handleTrackClick}
      >
        <div style={{ width: `${TRACK_PADDING + (totalDuration + 5) * pixelsPerSecond}px`, minWidth: '100%', padding: '8px 32px 16px 0' }}>

          {/* Time Ruler */}
          <div aria-hidden="true" style={{ marginLeft: TRACK_PADDING, height: 28, borderBottom: '1px solid #e5e7eb', position: 'relative' }} className="pointer-events-none">
            {Array.from({ length: Math.ceil(totalDuration) + 5 }).map((_, i) => (
              <div key={i} className="absolute bottom-0 flex flex-col items-start" style={{ left: `${i * pixelsPerSecond}px` }}>
                <span className="text-[10px] text-gray-400 font-mono" style={{ position: 'absolute', top: 2, left: 3 }}>{i}s</span>
                <div className="w-px bg-gray-300" style={{ height: 6 }} />
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-violet-500 pointer-events-none"
            style={{ left: `${TRACK_PADDING + currentTime * pixelsPerSecond}px`, zIndex: 50 }}
          >
            <div
              role="slider"
              tabIndex={0}
              aria-label="Playhead position"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalDuration * 100) / 100}
              aria-valuenow={Math.round(currentTime * 100) / 100}
              aria-valuetext={`${currentTime.toFixed(2)} seconds`}
              className={`absolute top-0 -left-1.5 w-3 h-3 bg-violet-500 rounded-full cursor-ew-resize pointer-events-auto ${FOCUS_RING}`}
              onMouseDown={(e) => { e.stopPropagation(); setIsDraggingPlayhead(true); }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft') { e.preventDefault(); seekToTime(currentTimeRef.current - step); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); seekToTime(currentTimeRef.current + step); }
                else if (e.key === 'Home') { e.preventDefault(); seekToTime(0); }
                else if (e.key === 'End') { e.preventDefault(); seekToTime(totalDuration); }
              }}
            />
          </div>

          {/* Rows */}
          <div className="mt-2 space-y-4">

            {/* Voiceover row */}
            <div className="flex items-stretch gap-2" style={{ marginLeft: 0 }}>
              <div className="flex items-center justify-center shrink-0" style={{ width: TRACK_LABEL_W }}>
                <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider">VO</span>
              </div>
              <div
                role="group"
                aria-label="Voiceover track"
                className={cn('relative h-20 bg-violet-50 rounded-xl border border-violet-200 overflow-hidden cursor-grab active:cursor-grabbing', isDraggingVoiceover && 'ring-2 ring-violet-500/30 shadow-lg opacity-90')}
                onMouseDown={handleVoiceoverMouseDown}
                style={{
                  width: voiceover ? `${voiceoverEffectiveDuration * pixelsPerSecond}px` : `${(totalDuration + 5) * pixelsPerSecond}px`,
                  marginLeft: voiceover ? `${(voiceover.startTime ?? 0) * pixelsPerSecond}px` : 0,
                  flexShrink: 0,
                }}
              >
                <div
                  ref={waveformRef}
                  className="absolute top-0 bottom-0 opacity-50"
                  style={{
                    width: voiceover ? `${voiceover.duration * pixelsPerSecond}px` : '100%',
                    left: voiceover ? `-${(voiceover.trimStart ?? 0) * pixelsPerSecond}px` : 0,
                  }}
                />
                <div className="absolute top-2 left-3 text-[10px] uppercase tracking-wider font-bold text-violet-500 pointer-events-none z-10">Voiceover</div>
              </div>
            </div>

            {/* Video track rows */}
            <div ref={videoTracksContainerRef} onMouseDown={handleTracksMouseDown} className={cn('relative space-y-4', marquee && 'cursor-crosshair select-none')}>
              {Array.from({ length: numTracks }).map((_, trackIdx) => {
                const trackClips = sortedClips.filter(c => (c.track ?? 0) === trackIdx);
                return (
                  <div key={trackIdx} className="flex items-center gap-2">
                    {/* Track label */}
                    <div className="flex items-center justify-center shrink-0 rounded-lg border border-gray-200 bg-white" style={{ width: TRACK_LABEL_W, height: TRACK_H }}>
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">V{trackIdx + 1}</span>
                    </div>

                    {/* Lane */}
                    <div className="relative" style={{ height: TRACK_H, width: `${(totalDuration + 5) * pixelsPerSecond}px`, flexShrink: 0 }}>
                      <div className="absolute inset-0 rounded-xl border border-dashed border-gray-200 bg-white/50" />

                      {trackClips.map((clip) => {
                        const effectiveDuration = clip.trimmedDuration ?? clip.duration;
                        const fps = clipFps(clip);
                        const isActive = currentTime >= clip.startTime && currentTime < clip.startTime + effectiveDuration;
                        const frameCount = Math.round(effectiveDuration * fps);
                        const isDragging = draggingClipId === clip.id;
                        const isTrimDragging = draggingTrimId === clip.id;
                        const hasFilmstrip = (clip.thumbnails?.length ?? 0) > 0;

                        return (
                          <React.Fragment key={clip.id}>
                            <div
                              data-clip="true"
                              role="button"
                              tabIndex={0}
                              aria-label={`Clip: ${clip.name}, ${effectiveDuration.toFixed(1)} seconds${clip.mediaMissing ? ', media missing' : ''}`}
                              aria-pressed={selection.ids.has(clip.id)}
                              onMouseDown={(e) => handleClipMouseDown(e, clip)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  dispatchSelection({ type: 'toggle', id: clip.id });
                                } else if (e.key === 'Escape') {
                                  dispatchSelection({ type: 'clear' });
                                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                                  e.preventDefault();
                                  deleteClipSelection(clip);
                                }
                              }}
                              className={cn(
                                'absolute h-full rounded-xl border flex flex-col justify-center px-3 select-none group/clip cursor-grab active:cursor-grabbing',
                                isActive ? 'bg-violet-600 border-violet-700 ring-2 ring-violet-300/50 shadow-md' : 'bg-violet-100 border-violet-300 shadow-sm hover:shadow-md hover:border-violet-400',
                                (isDragging || isTrimDragging) && 'shadow-xl ring-2 ring-violet-400/40 opacity-90',
                                selection.ids.has(clip.id) && 'ring-2 ring-offset-2 ring-violet-600',
                                FOCUS_RING
                              )}
                              style={{ left: `${clip.startTime * pixelsPerSecond}px`, width: `${effectiveDuration * pixelsPerSecond}px`, zIndex: isDragging ? 100 : 2 }}
                            >
                              {/* Filmstrip background — sampled frames spanning the clip's full duration */}
                              {clip.thumbnails && clip.thumbnails.length > 0 && (
                                <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-xl">
                                  {clip.thumbnails.map((src, i) => (
                                    <img key={i} src={src} alt="" className="h-full min-w-0 flex-1 object-cover" />
                                  ))}
                                  {/* Scrim keeps the clip name readable over arbitrary frame content */}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
                                </div>
                              )}
                              {/* Audio waveform underlay — silent/undecodable media renders nothing.
                                  Sized to the full source duration and shifted by trimStart so the
                                  visible slice matches what the clip plays. Painted above a filmstrip
                                  when both exist (equal stacking, later DOM order wins), and below
                                  the z-10 labels; the block always sets a zIndex, so it forms a
                                  stacking context. */}
                              <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none opacity-50">
                                <div
                                  className="absolute top-0 bottom-0"
                                  style={{ width: `${clip.duration * pixelsPerSecond}px`, left: `-${(clip.trimStart ?? 0) * pixelsPerSecond}px` }}
                                >
                                  <ClipWaveform url={clip.url} height={TRACK_H} />
                                </div>
                              </div>

                              {/* Left trim */}
                              <div
                                data-trim-handle="left"
                                role="slider"
                                tabIndex={0}
                                aria-label={`Trim clip start: ${(clip.trimStart ?? 0).toFixed(2)} seconds in, frame ${Math.round((clip.trimStart ?? 0) * fps)}`}
                                aria-valuemin={0}
                                aria-valuemax={Math.round(clip.duration * 10) / 10}
                                aria-valuenow={Math.round((clip.trimStart ?? 0) * 10) / 10}
                                onMouseDown={(e) => handleTrimHandleMouseDown(e, clip, 'left')}
                                onKeyDown={(e) => handleTrimKeyDown(e, clip, 'left')}
                                className={`absolute left-0 top-0 bottom-0 w-2.5 flex items-center justify-center cursor-col-resize rounded-l-xl z-10 opacity-0 group-hover/clip:opacity-100 focus-visible:opacity-100 transition-opacity bg-violet-500/80 hover:bg-violet-500 ${FOCUS_RING}`}
                              >
                                <div className="w-0.5 h-4 bg-white/70 rounded-full" />
                              </div>

                              <div className="relative z-10 flex items-center gap-2 overflow-hidden">
                                <Video className="w-3.5 h-3.5 shrink-0" style={{ color: isActive || hasFilmstrip ? 'white' : '#7c3aed' }} />
                                <span className="text-xs font-medium truncate" style={{ color: isActive || hasFilmstrip ? 'white' : '#5b21b6' }}>{clip.name}</span>
                              </div>
                              {(clip.trimmedDuration !== undefined || clip.trimStart !== undefined) && (
                                <div className="relative z-10 flex items-center gap-1 mt-0.5">
                                  <Scissors className="w-3 h-3 text-orange-400 shrink-0" />
                                  <span className="text-[10px] text-orange-400 font-medium">{effectiveDuration.toFixed(2)}s</span>
                                  <span className="text-[10px] text-orange-300/80 font-mono" title={`${Math.round((clip.trimStart ?? 0) * fps)}–${Math.round(((clip.trimStart ?? 0) + effectiveDuration) * fps)} @ ${fps}fps`}>{frameCount}f</span>
                                </div>
                              )}
                              {clip.mediaMissing && (
                                <div className="flex items-center gap-1 mt-0.5" title="Saved media is unavailable for this clip — re-add the video file to restore playback">
                                  <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                                  <span className="text-[10px] text-red-400 font-medium">Media missing</span>
                                </div>
                              )}
                              {clip.analysis && clip.trimmedDuration === undefined && clip.trimStart === undefined && (
                                <div className="relative z-10 text-[10px] truncate mt-0.5 italic" style={{ color: isActive || hasFilmstrip ? 'rgba(255,255,255,0.7)' : '#8b5cf6' }}>{clip.analysis}</div>
                              )}

                              {/* Right trim */}
                              <div
                                data-trim-handle="right"
                                role="slider"
                                tabIndex={0}
                                aria-label={`Trim clip end: ${effectiveDuration.toFixed(2)} seconds long, out frame ${Math.round(((clip.trimStart ?? 0) + effectiveDuration) * fps)}`}
                                aria-valuemin={0.5}
                                aria-valuemax={Math.round((clip.duration - (clip.trimStart ?? 0)) * 10) / 10}
                                aria-valuenow={Math.round(effectiveDuration * 10) / 10}
                                onMouseDown={(e) => handleTrimHandleMouseDown(e, clip, 'right')}
                                onKeyDown={(e) => handleTrimKeyDown(e, clip, 'right')}
                                className={`absolute right-0 top-0 bottom-0 w-2.5 flex items-center justify-center cursor-col-resize rounded-r-xl z-10 opacity-0 group-hover/clip:opacity-100 focus-visible:opacity-100 transition-opacity bg-orange-400/80 hover:bg-orange-400 ${FOCUS_RING}`}
                              >
                                <div className="w-0.5 h-4 bg-white/70 rounded-full" />
                              </div>

                              {/* Delete button */}
                              {onDeleteClip && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDeleteClip(clip.id); }}
                                  title="Remove clip"
                                  aria-label={`Remove clip: ${clip.name}`}
                                  className={`absolute bottom-1.5 right-8 w-4 h-4 rounded-full flex items-center justify-center z-10 opacity-0 group-hover/clip:opacity-100 focus-visible:opacity-100 transition-all bg-red-400/80 hover:bg-red-500 ${FOCUS_RING}`}
                                >
                                  <Trash2 className="w-2.5 h-2.5 text-white" />
                                </button>
                              )}

                              {/* Alternatives button (Star) — shown when AI gave suggestions */}
                              {clip.alternatives && clip.alternatives.length > 0 && onSwapClip && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (altPopover?.clipId === clip.id) {
                                      setAltPopover(null);
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setAltPopover({ clipId: clip.id, x: rect.left, y: rect.bottom + 6 });
                                      setTransitionPopoverId(null);
                                    }
                                  }}
                                  title="Alternative clip suggestions"
                                  aria-label="Alternative clip suggestions"
                                  aria-expanded={altPopover?.clipId === clip.id}
                                  className={cn(
                                    'absolute top-1.5 right-8 w-4 h-4 rounded-full flex items-center justify-center z-10 transition-all opacity-0 group-hover/clip:opacity-100 focus-visible:opacity-100',
                                    altPopover?.clipId === clip.id ? 'opacity-100 bg-amber-400' : 'bg-amber-300 hover:bg-amber-400',
                                    FOCUS_RING
                                  )}
                                >
                                  <Star className="w-2.5 h-2.5 text-white fill-white" />
                                </button>
                              )}
                            </div>

                            {/* Transition badge between adjacent clips */}
                            {(() => {
                              const nextOnTrack = trackClips.find(c2 => c2.id !== clip.id && Math.abs(c2.startTime - (clip.startTime + effectiveDuration)) < 0.5);
                              if (!nextOnTrack) return null;
                              const transitionType = nextOnTrack.transitionIn ?? 'cut';
                              const x = (clip.startTime + effectiveDuration) * pixelsPerSecond;
                              return (
                                <div key={`tr-${clip.id}`} className="absolute z-20 flex flex-col items-center justify-center" style={{ left: x - 14, top: 0, height: TRACK_H, width: 28 }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (transitionPopoverId === nextOnTrack.id) {
                                        setTransitionPopoverId(null);
                                        setTransitionPopoverPos(null);
                                      } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setTransitionPopoverId(nextOnTrack.id);
                                        setTransitionPopoverPos({ x: rect.left - 40, y: rect.bottom + 6 });
                                      }
                                      setAltPopover(null);
                                    }}
                                    title={`Transition: ${transitionType}`}
                                    aria-label={`Edit transition into next clip (currently ${transitionType})`}
                                    aria-expanded={transitionPopoverId === nextOnTrack.id}
                                    className={cn(
                                      'w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-sm transition-all',
                                      transitionType === 'cut' ? 'bg-white border-gray-300 hover:border-violet-400 text-gray-500' : 'bg-violet-600 border-violet-700 text-white hover:bg-violet-500',
                                      FOCUS_RING
                                    )}
                                  >
                                    {transitionType === 'cut' ? <Zap className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                                  </button>
                                </div>
                              );
                            })()}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Marquee selection rectangle */}
              {marquee && (
                <div
                  aria-hidden="true"
                  className="absolute z-30 rounded-sm border border-violet-500 bg-violet-500/10 pointer-events-none"
                  style={{
                    left: Math.min(marquee.originX, marquee.x),
                    top: Math.min(marquee.originY, marquee.y),
                    width: Math.abs(marquee.x - marquee.originX),
                    height: Math.abs(marquee.y - marquee.originY),
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {(transitionPopoverId || altPopover) && (
        <div aria-hidden="true" className="fixed inset-0 z-40" onClick={() => { setTransitionPopoverId(null); setTransitionPopoverPos(null); setAltPopover(null); }} />
      )}

      {/* Transition type picker — fixed position so it escapes the scroll container */}
      {transitionPopoverId && transitionPopoverPos && (() => {
        const targetClip = videoClips.find(c => c.id === transitionPopoverId);
        if (!targetClip) return null;
        return (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-1.5 w-36"
            style={{ left: transitionPopoverPos.x, top: transitionPopoverPos.y }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider px-2 pb-1">Transition</p>
            {TRANSITION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { handleTransitionChange(transitionPopoverId, opt.value); setTransitionPopoverPos(null); }}
                className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors', (targetClip.transitionIn ?? 'cut') === opt.value ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-50', FOCUS_RING)}
              >
                <span>{opt.icon}</span>
                {opt.label}
                {(targetClip.transitionIn ?? 'cut') === opt.value && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500" />}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Alternative clip suggestions — fixed position popover */}
      {altPopover && onSwapClip && (() => {
        const clip = videoClips.find(c => c.id === altPopover.clipId);
        if (!clip?.alternatives || clip.alternatives.length === 0) return null;
        return (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-2 w-56"
            style={{ left: altPopover.x, top: altPopover.y, maxWidth: 'calc(100vw - 16px)' }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider px-1 pb-1.5">Alternative suggestions</p>
            {clip.alternatives.map(alt => {
              const altClip = videoClips.find(c => c.id === alt.id);
              if (!altClip) return null;
              return (
                <button
                  key={alt.id}
                  onClick={() => { onSwapClip(clip.id, alt.id); setAltPopover(null); }}
                  className="w-full text-left px-2 py-2 rounded-lg hover:bg-violet-50 transition-colors group/alt focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-xs font-semibold text-gray-700 truncate group-hover/alt:text-violet-700">{altClip.name}</span>
                    <span className="text-[10px] font-bold text-violet-500 shrink-0">{Math.round(alt.confidence * 100)}%</span>
                  </div>
                  {/* Confidence bar */}
                  <div className="h-1 rounded-full bg-gray-100 mb-1">
                    <div className="h-full rounded-full bg-violet-400" style={{ width: `${alt.confidence * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">{alt.reason}</p>
                </button>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};
