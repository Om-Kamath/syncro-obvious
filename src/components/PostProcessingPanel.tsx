import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  FileText,
  MessageSquare,
  Image,
  Download,
  Upload,
  Wand2,
  Copy,
  Check,
  Loader2,
  Lock,
  Music,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Hash,
  Film,
  Trash2,
} from 'lucide-react';
import { VideoClip, Voiceover, CaptionStyle, CaptionMode, VideoDescription, ThumbnailCandidate, WordEmphasisStyle } from '../types';
// Heavy export-only dependencies (Gemini post-processing, canvas frame capture) are
// loaded on demand via dynamic import so they stay out of the initial bundle.
// captionUtils stays static: a ~1 kB string-formatting module that render paths need
// synchronously (chapter/thumbnail timestamps) — same trade as exportPresets below.
import { drawCaptionOnCanvas } from '../utils/captionCanvas';
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_SCALE, DEFAULT_HIGHLIGHT_WEIGHT } from '../utils/captionEmphasis';
import { normalizeErrorMessage } from '../services/geminiClient';
import { generateSRT, generateVTT, downloadTextFile, generateChaptersTxt, formatChapterTime, type CaptionSegment } from '../utils/captionUtils';
import { CAPTION_PRESETS, CAPTION_PRESET_ORDER, applyPreset } from '../utils/captionPresets';
import { listTemplates, saveTemplate, deleteTemplate, applyTemplate, loadTemplatesResult } from '../services/captionTemplates';
import { parseCaptionFile, segmentsToTranscription } from '../utils/captionImport';
import type { CaptionTemplate } from '../types';
import { EXPORT_PRESETS, DEFAULT_EXPORT_PRESET, computeDrawGeometry, type ExportPresetId } from '../utils/exportPresets';
import { audioChannelsOf, mixAudio, sliceAudioWindow, toAudioBuffer } from '../utils/audioMix';
import { MusicPanel, DEFAULT_MUSIC_VOLUME } from './MusicPanel';
import { EXPORT_CODECS, DEFAULT_EXPORT_CODEC, selectMimeType, type ExportCodecId } from '../utils/exportCodecs';
import {
  QUALITY_PRESETS,
  DEFAULT_QUALITY_PRESET,
  computeExportDuration,
  estimatePresetSizeBytes,
  formatEstimatedSize,
  type QualityPresetId,
} from '../utils/qualityPresets';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Tab button ──────────────────────────────────────────────────────────────
function TabButton({
  active,
  locked,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  locked: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  key?: React.Key;
}) {
  return (
    <button
      onClick={locked ? undefined : onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap',
        active
          ? 'border-violet-600 text-violet-600'
          : locked
          ? 'border-transparent text-gray-300 cursor-not-allowed'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-400'
      )}
    >
      {locked ? <Lock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

// ── Locked placeholder ───────────────────────────────────────────────────────
function LockedState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
        <Lock className="w-5 h-5 text-gray-400" />
      </div>
      <p className="text-sm text-gray-400 max-w-xs">{message}</p>
    </div>
  );
}

// ── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
        copied
          ? 'bg-violet-50 text-violet-600'
          : failed
          ? 'bg-red-50 text-red-500'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
        className
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : failed ? 'Failed' : 'Copy'}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — Description & Chapters
// ═══════════════════════════════════════════════════════════════════════════
export function DescriptionTab({ voiceover, videoClips }: { voiceover: Voiceover; videoClips: VideoClip[] }) {
  const [description, setDescription] = useState<VideoDescription | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showHashtags, setShowHashtags] = useState(false);

  const canGenerate = !!voiceover.transcription && !!voiceover.segments?.length;

  const handleGenerate = async () => {
    if (!voiceover.transcription || !voiceover.segments) return;
    setIsGenerating(true);
    setError('');
    try {
      const { generateDescription } = await import('../services/postProcessing');
      const result = await generateDescription(
        voiceover.transcription,
        voiceover.segments,
        videoClips.map(c => c.analysis || '').filter(Boolean)
      );
      setDescription(result);
    } catch (err) {
      // Surface the actual failure (missing key, API error, malformed model JSON)
      // so the user sees the actionable reason instead of a generic retry line.
      setError(normalizeErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const chaptersText = description ? generateChaptersTxt(description.chapters) : '';

  const handleDownloadChapters = () => {
    if (!description) return;
    downloadTextFile(generateChaptersTxt(description.chapters), 'chapters.txt', 'text/plain');
  };

  const fullDescriptionText = description
    ? [
        description.summary,
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        'CHAPTERS',
        '━━━━━━━━━━━━━━━━━━━━',
        generateChaptersTxt(description.chapters),
        '',
        description.hashtags.map(h => `#${h}`).join(' '),
      ].join('\n')
    : '';

  if (!canGenerate) {
    return (
      <LockedState message="Run AI Auto-Align first so the voiceover is transcribed and segmented." />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">YouTube-Style Description</p>
          <p className="text-xs text-gray-400 mt-0.5">Auto-generated summary + chapter timestamps</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all',
            isGenerating
              ? 'bg-gray-100 text-gray-400 cursor-wait'
              : 'bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-200'
          )}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : description ? (
            <RefreshCw className="w-4 h-4" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          {isGenerating ? 'Generating…' : description ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/30 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <AnimatePresence>
        {description && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Summary */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Summary</span>
                <CopyButton text={description.summary} />
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{description.summary}</p>
            </div>

            {/* Chapters */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Chapters ({description.chapters.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleDownloadChapters}
                    aria-label="Download chapters as YouTube-format txt"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all bg-gray-100 text-gray-500 hover:bg-gray-200"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .txt
                  </button>
                  <CopyButton text={chaptersText} />
                </div>
              </div>
              <div className="space-y-1 mt-1">
                {description.chapters.map((ch, i) => (
                  <div key={i} className="flex items-center gap-3 py-1">
                    <span className="font-mono text-xs font-bold text-violet-400 w-10 flex-shrink-0">
                      {formatChapterTime(ch.time)}
                    </span>
                    <span className="text-sm text-gray-700">{ch.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Hashtags */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowHashtags(v => !v)}
                  className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-violet-500 hover:text-violet-600 transition-colors"
                >
                  <Hash className="w-3 h-3" />
                  Hashtags ({description.hashtags.length})
                  {showHashtags ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <CopyButton text={description.hashtags.map(h => `#${h}`).join(' ')} />
              </div>
              <AnimatePresence>
                {showHashtags && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap gap-2 pt-2">
                      {description.hashtags.map((tag, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 bg-violet-50 text-violet-600 text-xs font-medium rounded-lg border border-violet-600/30"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Full copy */}
            <div className="flex justify-end">
              <CopyButton text={fullDescriptionText} className="text-sm px-4 py-2" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — Captions
// ═══════════════════════════════════════════════════════════════════════════
export function CaptionsTab({
  voiceover,
  captionStyle,
  captionsEnabled,
  onStyleChange,
  onEnabledChange,
  onImportCaptions,
}: {
  voiceover: Voiceover | null;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
  onStyleChange: (s: CaptionStyle) => void;
  onEnabledChange: (v: boolean) => void;
  onImportCaptions: (segments: CaptionSegment[], transcription: string) => void;
}) {
  const hasSegments = !!voiceover?.segments?.length;
  const [importStatus, setImportStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Manual tweaks take the style off its named preset, so the picker stops
  // highlighting it instead of lying about the active look.
  const updateStyle = (patch: Partial<CaptionStyle>) =>
    onStyleChange({ ...captionStyle, ...patch, preset: undefined });
  const handleMode = (mode: CaptionMode) => updateStyle({ mode });
  const handlePosition = (position: 'bottom' | 'top') => updateStyle({ position });

  // Templates load once, at initialization — no effect, no setState-in-effect.
  const [initialLoad] = useState(loadTemplatesResult);
  const [templates, setTemplates] = useState<CaptionTemplate[]>(initialLoad.templates);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(initialLoad.error);

  const handleSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    try {
      saveTemplate(name, captionStyle);
      setTemplates(listTemplates());
      setTemplateName('');
      setTemplateError(null);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const handleApplyTemplate = (template: CaptionTemplate) => {
    onStyleChange(applyTemplate(template));
  };

  const handleDeleteTemplate = (id: string) => {
    try {
      deleteTemplate(id);
      setTemplates(listTemplates());
      setTemplateError(null);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  // Effective emphasis shown in the editor; writing initializes `wordEmphasis`
  // from these defaults so untouched controls never change current behavior.
  const emphasis = captionStyle.wordEmphasis ?? {
    color: DEFAULT_HIGHLIGHT_COLOR,
    fontWeight: DEFAULT_HIGHLIGHT_WEIGHT,
    scale: DEFAULT_HIGHLIGHT_SCALE,
  };
  const handleEmphasisChange = (patch: Partial<WordEmphasisStyle>) =>
    onStyleChange({ ...captionStyle, wordEmphasis: { ...emphasis, ...patch } });

  const modeOptions: { value: CaptionMode; label: string; desc: string }[] = [
    { value: 'lower-third', label: 'Lower Third', desc: 'Classic bar at bottom' },
    { value: 'word-highlight', label: 'Word Highlight', desc: 'Highlights current word' },
    { value: 'speaker-labeled', label: 'Speaker Label', desc: 'Prefixes with "Speaker:"' },
  ];

  const handleDownloadSRT = () => {
    const segments = voiceover?.segments;
    if (!segments) return;
    downloadTextFile(generateSRT(segments), 'captions.srt', 'text/plain');
  };

  const handleDownloadVTT = () => {
    const segments = voiceover?.segments;
    if (!segments) return;
    downloadTextFile(generateVTT(segments), 'captions.vtt', 'text/vtt');
  };

  const handleImportFile = async (file: File) => {
    setImportStatus(null);
    try {
      const { segments, errors } = parseCaptionFile(await file.text());
      if (segments.length === 0) {
        setImportStatus({
          kind: 'error',
          message: `No valid cues found in "${file.name}".${errors[0] ? ` First issue: ${errors[0]}` : ''}`,
        });
        return;
      }
      // The imported cues replace the AI transcription wholesale, so downstream
      // consumers (description, thumbnails) read the imported text.
      onImportCaptions(segments, segmentsToTranscription(segments));
      setImportStatus({
        kind: 'ok',
        message:
          `Imported ${segments.length} cue${segments.length === 1 ? '' : 's'} from "${file.name}" — captions now use these timings.` +
          (errors.length ? ` ${errors.length} malformed cue${errors.length === 1 ? '' : 's'} skipped.` : ''),
      });
    } catch (err) {
      setImportStatus({ kind: 'error', message: `Failed to read "${file.name}": ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  if (!hasSegments) {
    return (
      <LockedState message="Run AI Auto-Align first to generate the transcript segments needed for captions." />
    );
  }

  return (
    <div className="space-y-6">
      {/* Live preview toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-100 rounded-2xl">
        <div>
          <p className="text-sm font-semibold text-gray-900">Live Caption Preview</p>
          <p className="text-xs text-gray-400 mt-0.5">Show captions on the video preview above</p>
        </div>
        <button
          onClick={() => onEnabledChange(!captionsEnabled)}
          className={cn(
            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            captionsEnabled ? 'bg-violet-600' : 'bg-gray-200'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              captionsEnabled ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      {/* Presets */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Presets</p>
        <div className="grid grid-cols-2 gap-3">
          {CAPTION_PRESET_ORDER.map(name => {
            const preset = CAPTION_PRESETS[name];
            const active = captionStyle.preset === name;
            return (
              <button
                key={name}
                onClick={() => onStyleChange(applyPreset(name))}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                  active ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-300' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                )}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-black/10 text-[11px] font-bold"
                  style={{ backgroundColor: preset.style.bgColor, color: preset.style.color }}
                >
                  Aa
                </span>
                <span>
                  <span className="block text-xs font-semibold text-gray-900">{preset.label}</span>
                  <span className="block text-[10px] text-gray-400 mt-0.5">{preset.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Caption style */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Style</p>
        <div className="grid grid-cols-3 gap-3">
          {modeOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleMode(opt.value)}
              className={cn(
                'p-3 rounded-xl border text-left transition-all',
                captionStyle.mode === opt.value
                  ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-300'
                  : 'border-gray-200 hover:border-gray-300 bg-gray-50'
              )}
            >
              <p className="text-xs font-semibold text-gray-900">{opt.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Font Size</p>
          <span className="text-xs font-mono font-semibold text-gray-600">{captionStyle.fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={36}
          value={captionStyle.fontSize}
          onChange={e => updateStyle({ fontSize: Number(e.target.value) })}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-600"
        />
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Text Color</p>
          <div className="flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-100 rounded-xl">
            <input
              type="color"
              value={captionStyle.color}
              onChange={e => updateStyle({ color: e.target.value })}
              className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
            />
            <span className="text-xs font-mono text-gray-500">{captionStyle.color}</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Background</p>
          <div className="flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-100 rounded-xl">
            <input
              type="color"
              value={captionStyle.bgColor}
              onChange={e => updateStyle({ bgColor: e.target.value })}
              className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
            />
            <span className="text-xs font-mono text-gray-500">{captionStyle.bgColor}</span>
          </div>
        </div>
      </div>

      {/* Word emphasis (word-highlight mode only) */}
      {captionStyle.mode === 'word-highlight' && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Word Emphasis</p>
          <p className="text-xs text-gray-400 -mt-2">Style overrides for the currently highlighted word</p>
          <div className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-100 rounded-xl">
            <input
              type="color"
              value={emphasis.color}
              onChange={e => handleEmphasisChange({ color: e.target.value })}
              className="w-8 h-8 rounded-lg border-0 cursor-pointer bg-transparent"
            />
            <span className="text-xs font-mono text-gray-500">{emphasis.color}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Weight</span>
              <span className="text-xs font-mono font-semibold text-gray-600">{emphasis.fontWeight}</span>
            </div>
            <input
              type="range"
              min={400}
              max={900}
              step={100}
              value={emphasis.fontWeight}
              onChange={e => handleEmphasisChange({ fontWeight: Number(e.target.value) })}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-600"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Scale</span>
              <span className="text-xs font-mono font-semibold text-gray-600">{emphasis.scale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={1}
              max={1.5}
              step={0.05}
              value={emphasis.scale}
              onChange={e => handleEmphasisChange({ scale: Number(e.target.value) })}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-violet-600"
            />
          </div>
        </div>
      )}

      {/* Position */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Position</p>
        <div className="flex gap-3">
          {(['bottom', 'top'] as const).map(pos => (
            <button
              key={pos}
              onClick={() => handlePosition(pos)}
              className={cn(
                'flex-1 py-2 text-xs font-semibold rounded-xl border capitalize transition-all',
                captionStyle.position === pos
                  ? 'border-violet-400 bg-violet-50 text-violet-600'
                  : 'border-gray-200 bg-gray-50 text-violet-500 hover:border-violet-400'
              )}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Templates</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveTemplate();
            }}
            placeholder="Name this style…"
            aria-label="Template name"
            className="flex-1 min-w-0 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-violet-400"
          />
          <button
            onClick={handleSaveTemplate}
            disabled={!templateName.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
        {templateError && (
          <p className="text-xs text-red-500 px-1" role="alert">{templateError}</p>
        )}
        {templates.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 py-2">
            No templates yet. Style your captions, then save them here to reuse.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 p-2.5 bg-gray-50 border border-gray-100 rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {t.style.mode} · {t.style.fontSize}px · {t.style.position}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleApplyTemplate(t)}
                    className="px-3 py-1.5 text-xs font-semibold text-violet-600 border border-gray-200 rounded-lg hover:border-violet-400 hover:bg-violet-50 transition-all"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(t.id)}
                    aria-label={`Delete template ${t.name}`}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import */}
      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-500 mb-3">Import Captions</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".srt,.vtt"
          className="hidden"
          aria-label="Import caption file"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-gray-50 border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
        >
          <Upload className="w-3.5 h-3.5" />
          Import SRT / VTT
        </button>
        <p className="mt-2 text-[11px] text-gray-400">
          Replaces the AI transcription and caption timings with the cues from the file.
        </p>
        {importStatus && (
          <p aria-live="polite" className={cn('mt-2 text-[11px] font-medium', importStatus.kind === 'ok' ? 'text-emerald-600' : 'text-red-600')}>
            {importStatus.message}
          </p>
        )}
      </div>

      {/* Download */}
      <div className="pt-2 border-t border-gray-100">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-500 mb-3">Export Caption File</p>
        <div className="flex gap-3">
          <button
            onClick={handleDownloadSRT}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-gray-50 border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Download SRT
          </button>
          <button
            onClick={handleDownloadVTT}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-gray-50 border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Download VTT
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — Thumbnails
// ═══════════════════════════════════════════════════════════════════════════
export function ThumbnailsTab({
  voiceover,
  videoClips,
  importedThumbnails = [],
}: {
  voiceover: Voiceover | null;
  videoClips: VideoClip[];
  importedThumbnails?: ThumbnailCandidate[];
}) {
  const [thumbnails, setThumbnails] = useState<ThumbnailCandidate[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const canGenerate =
    !!voiceover?.transcription && !!voiceover?.segments?.length && videoClips.length > 0;
  const allThumbnails = [...thumbnails, ...importedThumbnails];

  const handleGenerate = async () => {
    if (!voiceover?.transcription || !voiceover.segments) return;
    setIsGenerating(true);
    setError('');
    setProgress('Asking AI to identify key moments…');
    setThumbnails([]);
    try {
      const [{ identifyKeyMoments }, { getClipAtTime, captureVideoFrame, addQuoteOverlay }] =
        await Promise.all([import('../services/postProcessing'), import('../utils/exportUtils')]);
      const moments = await identifyKeyMoments(
        voiceover.transcription,
        voiceover.segments,
        videoClips.map(c => c.analysis || '').filter(Boolean)
      );

      const results: ThumbnailCandidate[] = [];
      for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        setProgress(`Capturing frame ${i + 1} of ${moments.length}…`);
        const hit = getClipAtTime(videoClips, m.timestamp);
        if (!hit) continue;
        try {
          const raw = await captureVideoFrame(hit.clip, hit.localTime);
          const withText = await addQuoteOverlay(raw, m.quote);
          results.push({
            id: `thumb-${i}`,
            timestamp: m.timestamp,
            quote: m.quote,
            reason: m.reason,
            imageDataUrl: withText,
          });
          setThumbnails([...results]);
        } catch {
          // skip this frame
        }
      }

      if (results.length === 0) setError('Could not capture any frames. Try aligning clips first.');
    } catch (err) {
      // Same surfacing rule as DescriptionTab: show the real reason.
      setError(normalizeErrorMessage(err));
    } finally {
      setIsGenerating(false);
      setProgress('');
    }
  };

  // Imported images are viewable without AI analysis; only the fully empty
  // state is locked.
  if (!canGenerate && importedThumbnails.length === 0) {
    return (
      <LockedState
        message={
          voiceover
            ? 'Upload videos and run AI Auto-Align first to enable thumbnail generation.'
            : 'Upload a voiceover and run AI Auto-Align to generate thumbnails.'
        }
      />
    );
  }

  if (!canGenerate) {
    return (
      <div className="space-y-5">
        <p className="text-xs text-violet-500">
          Imported images appear here. Run AI Auto-Align to unlock AI thumbnail generation.
        </p>
        <ThumbnailGrid items={importedThumbnails} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Thumbnail Candidates</p>
          <p className="text-xs text-violet-500 mt-0.5">
            AI finds the most compelling moments and overlays a key quote
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all',
            isGenerating
              ? 'bg-gray-100 text-gray-400 cursor-wait'
              : 'bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-200'
          )}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : thumbnails.length > 0 ? (
            <RefreshCw className="w-4 h-4" />
          ) : (
            <Wand2 className="w-4 h-4" />
          )}
          {isGenerating ? 'Generating…' : thumbnails.length > 0 ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {isGenerating && progress && (
        <div className="flex items-center gap-3 p-3 bg-gray-100 border border-gray-100 rounded-xl text-xs text-violet-600">
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          {progress}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/30 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <ThumbnailGrid items={allThumbnails} />
    </div>
  );
}

function ThumbnailGrid({ items }: { items: ThumbnailCandidate[] }) {
  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-2 gap-4"
        >
          {items.map((thumb, i) => (
            <motion.div
              key={thumb.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="group rounded-2xl border border-gray-200 overflow-hidden bg-gray-50 hover:border-violet-400 hover:shadow-lg hover:shadow-violet-200/50 transition-all"
            >
              <div className="relative aspect-video bg-black/50">
                <img
                  src={thumb.imageDataUrl}
                  alt={thumb.quote}
                  className="w-full h-full object-cover"
                />
                {thumb.source !== 'imported' && (
                  <div className="absolute top-2 left-2">
                    <span className="px-2 py-0.5 bg-black/60 text-white text-[10px] font-mono rounded-md">
                      {formatChapterTime(thumb.timestamp)}
                    </span>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-900 line-clamp-1">"{thumb.quote}"</p>
                <p className="text-[10px] text-violet-500 line-clamp-2">{thumb.reason}</p>
                <button
                  onClick={async () => {
                    const { downloadDataUrl } = await import('../utils/exportUtils');
                    downloadDataUrl(
                      thumb.imageDataUrl,
                      thumb.source === 'imported'
                        ? thumb.quote
                        : `thumbnail-${i + 1}-${thumb.timestamp}s.jpg`
                    );
                  }}
                  className="flex items-center gap-1.5 w-full justify-center py-1.5 text-xs font-semibold bg-gray-100 border border-gray-200 text-violet-400 rounded-lg hover:bg-violet-50 hover:text-violet-600 hover:border-violet-400 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PNG
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — Export
// ═══════════════════════════════════════════════════════════════════════════
function ExportTab({
  voiceover,
  videoClips,
  captionStyle,
  captionsEnabled,
}: {
  voiceover: Voiceover | null;
  videoClips: VideoClip[];
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [presetId, setPresetId] = useState<ExportPresetId>(DEFAULT_EXPORT_PRESET);
  const preset = EXPORT_PRESETS[presetId];
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [exportError, setExportError] = useState<string | null>(null);
  const [codecId, setCodecId] = useState<ExportCodecId>(DEFAULT_EXPORT_CODEC);
  // Probe MediaRecorder support on render — cheap (a handful of string checks)
  // and always current, so the UI reflects what a recording would actually use.
  const selected = selectMimeType(
    codecId,
    m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
  );
  const [qualityId, setQualityId] = useState<QualityPresetId>(DEFAULT_QUALITY_PRESET);
  const quality = QUALITY_PRESETS[qualityId];
  const stopRef = useRef<(() => void) | null>(null);

  const handleDownloadAsset = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };

  const handleDownloadSRT = () => {
    const segments = voiceover?.segments;
    if (!segments) return;
    downloadTextFile(generateSRT(segments), 'captions.srt', 'text/plain');
  };

  const handleDownloadVTT = () => {
    const segments = voiceover?.segments;
    if (!segments) return;
    downloadTextFile(generateVTT(segments), 'captions.vtt', 'text/vtt');
  };

  const handleExportVideo = async () => {
    if (!voiceover || videoClips.length === 0) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);

    let audioCtx: AudioContext | null = null;
    try {
      // Chunk is fetched once here; the draw loop and recorder.onstop close over the bindings.
      const { downloadFile, getClipAtTime } = await import('../utils/exportUtils');
      const W = preset.width;
      const H = preset.height;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Pre-load render video elements — only store ones that loaded successfully
      const renderVids: Record<string, HTMLVideoElement> = {};
      await Promise.all(videoClips.map(clip =>
        new Promise<void>(res => {
          const v = document.createElement('video');
          v.src = clip.url;
          v.muted = true;
          v.preload = 'auto';
          v.addEventListener('loadeddata', () => { renderVids[clip.id] = v; res(); }, { once: true });
          v.addEventListener('error', () => res(), { once: true }); // skip broken clips, don't store
          v.load();
        })
      ));

      // Audio setup — decode narration (and music) fully, mix them in the
      // sample domain, then record the mixed buffer. Both files decode through
      // the same AudioContext, so their sample rates always match.
      audioCtx = new AudioContext();
      const narrationBytes = voiceover.file
        ? await voiceover.file.arrayBuffer()
        : await fetch(voiceover.url).then(r => {
            if (!r.ok) throw new Error(`Narration audio unavailable (HTTP ${r.status})`);
            return r.arrayBuffer();
          });
      const narrationBuffer = await audioCtx.decodeAudioData(narrationBytes);

      let musicBuffer: AudioBuffer | null = null;
      if (musicFile) {
        musicBuffer = await audioCtx.decodeAudioData(await musicFile.arrayBuffer());
      }

      const trimStartSec = voiceover.trimStart ?? 0;
      const trimEndSec = voiceover.trimEnd ?? voiceover.duration;
      const mixedBuffer = toAudioBuffer(
        mixAudio(
          sliceAudioWindow(narrationBuffer, trimStartSec, trimEndSec),
          musicBuffer ? audioChannelsOf(musicBuffer) : null,
          musicVolume,
        ),
        audioCtx,
      );

      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createBufferSource();
      source.buffer = mixedBuffer;
      source.connect(dest);
      source.connect(audioCtx.destination);

      // Build combined stream
      const canvasStream = canvas.captureStream(30);
      const combined = new MediaStream([
        ...canvasStream.getTracks(),
        ...dest.stream.getTracks(),
      ]);

      const { mimeType, ext } = selected;
      const recorderOptions: MediaRecorderOptions = { mimeType };
      if (quality.videoBitsPerSecond !== null) {
        recorderOptions.videoBitsPerSecond = quality.videoBitsPerSecond;
      }
      const recorder = new MediaRecorder(combined, recorderOptions);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        downloadFile(blob, `syncvoice-export.${ext}`);
        setIsExporting(false);
        setExportProgress(0);
        Object.values(renderVids).forEach(v => { v.pause(); v.remove(); });
        audioCtx?.close();
      };

      const duration = trimEndSec - trimStartSec;
      const startWall = performance.now();

      let rafId: number;
      const draw = () => {
        const elapsed = (performance.now() - startWall) / 1000;
        setExportProgress(Math.min(elapsed / duration, 1));

        if (elapsed >= duration) {
          recorder.stop();
          cancelAnimationFrame(rafId);
          return;
        }

        // Find active clip
        const hit = getClipAtTime(videoClips, elapsed);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (hit) {
          const v = renderVids[hit.clip.id];
          if (v) {
            // Seek if drifted; play (muted) so frames decode
            if (Math.abs(v.currentTime - hit.localTime) > 0.2) v.currentTime = hit.localTime;
            if (v.paused) v.play().catch(() => {});
            try {
              const g = computeDrawGeometry(preset, v.videoWidth, v.videoHeight);
              ctx.drawImage(v, g.dx, g.dy, g.dWidth, g.dHeight);
            } catch { /* skip */ }
          }
        }

        // Draw captions
        if (captionsEnabled && voiceover.segments) {
          const seg = voiceover.segments.find(s => elapsed >= s.start && elapsed <= s.end);
          if (seg) drawCaptionOnCanvas(ctx, W, H, seg, captionStyle, elapsed);
        }

        rafId = requestAnimationFrame(draw);
      };

      stopRef.current = () => {
        recorder.stop();
        cancelAnimationFrame(rafId);
        Object.values(renderVids).forEach(v => { v.pause(); v.remove(); });
        setIsExporting(false);
        setExportProgress(0);
      };

      recorder.start(100);
      source.start();
      rafId = requestAnimationFrame(draw);
    } catch (e) {
      console.error('Export failed:', e);
      setExportError(e instanceof Error ? e.message : 'Export failed. Check your audio files and try again.');
      setIsExporting(false);
      audioCtx?.close();
    }
  };

  const hasContent = videoClips.length > 0 || !!voiceover;

  if (!hasContent) {
    return <LockedState message="Upload assets and run AI Auto-Align before exporting." />;
  }

  const exportDuration = voiceover ? computeExportDuration(voiceover) : 0;
  const estimatedSize = exportDuration > 0 ? estimatePresetSizeBytes(quality, exportDuration) : null;
  const sizeNote =
    estimatedSize !== null && quality.videoBitsPerSecond !== null
      ? `Estimated size ≈ ${formatEstimatedSize(estimatedSize)} · ${exportDuration.toFixed(1)}s · ${(quality.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps video`
      : quality.videoBitsPerSecond === null
        ? 'Bitrate: browser-managed — size estimate unavailable'
        : null;

  return (
    <div className="space-y-6">
      {/* Asset Downloads */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Download Assets</p>
        <div className="space-y-2">
          {voiceover && (
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-violet-400 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-500/20 text-violet-400 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Music className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-900 truncate max-w-[200px]">
                    {voiceover.file?.name ?? 'voiceover-audio'}
                  </p>
                  <p className="text-[10px] text-violet-500">{voiceover.duration.toFixed(1)}s · Audio</p>
                </div>
              </div>
              <button
                onClick={() => handleDownloadAsset(voiceover.url, voiceover.file?.name ?? 'voiceover-audio')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-violet-400 rounded-lg hover:bg-violet-100 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          )}

          {videoClips.map(clip => (
            <div
              key={clip.id}
              className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-violet-400 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                  <video src={clip.url} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-900 truncate max-w-[200px]">
                    {clip.name}
                  </p>
                  <p className="text-[10px] text-violet-500">{clip.duration.toFixed(1)}s · Video</p>
                </div>
              </div>
              <button
                onClick={() => handleDownloadAsset(clip.url, clip.name)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-100 text-violet-400 rounded-lg hover:bg-violet-100 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Caption Downloads */}
      {voiceover?.segments && voiceover.segments.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-500">Caption Files</p>
          <div className="flex gap-3">
            <button
              onClick={handleDownloadSRT}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-gray-50 border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              SRT Captions
            </button>
            <button
              onClick={handleDownloadVTT}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-gray-50 border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              VTT Captions
            </button>
          </div>
        </div>
      )}

      {/* Combined Video Export */}
      {voiceover && videoClips.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-500">
            Combined Export
          </p>
          <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Film className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Export Combined Video</p>
                <p className="text-xs text-violet-500 mt-0.5">
                  Records the aligned sequence with narration audio
                  {captionsEnabled ? ' and burned-in captions' : ''}.
                </p>
              </div>
            </div>

            <MusicPanel
              file={musicFile}
              volume={musicVolume}
              disabled={isExporting}
              onFileChange={setMusicFile}
              onVolumeChange={setMusicVolume}
            />

            {exportError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-500" role="alert">
                {exportError}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-900">Aspect Preset</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(EXPORT_PRESETS).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPresetId(p.id)}
                    disabled={isExporting}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50',
                      presetId === p.id
                        ? 'bg-violet-50 border-violet-400 text-violet-600'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
                    )}
                  >
                    <span>{p.label}</span>
                    <span className="text-[10px] font-normal text-gray-400 text-center leading-tight">
                      {p.description}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">
                Output: {preset.width}×{preset.height} ·{' '}
                {preset.fit === 'cover' ? 'smart crop (center-crop to fill)' : 'letterbox (full frame)'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-900">Format</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(EXPORT_CODECS).map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCodecId(c.id)}
                    disabled={isExporting}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50',
                      codecId === c.id
                        ? 'bg-violet-50 border-violet-400 text-violet-600'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
                    )}
                  >
                    <span>{c.label}</span>
                    <span className="text-[10px] font-normal text-gray-400 text-center leading-tight">
                      {c.description}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">
                Records as {selected.label} · {selected.mimeType}
              </p>
              {selected.codec !== codecId && (
                <p className="text-[10px] text-amber-600">
                  {EXPORT_CODECS[codecId].label} is not supported by this browser — recording{' '}
                  {selected.label} instead.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-900">Quality</p>
              <div className="grid grid-cols-4 gap-2">
                {Object.values(QUALITY_PRESETS).map(q => (
                  <button
                    key={q.id}
                    onClick={() => setQualityId(q.id)}
                    disabled={isExporting}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50',
                      qualityId === q.id
                        ? 'bg-violet-50 border-violet-400 text-violet-600'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300'
                    )}
                  >
                    <span>{q.label}</span>
                    <span className="text-[10px] font-normal text-gray-400 text-center leading-tight">
                      {q.description}
                    </span>
                  </button>
                ))}
              </div>
              {sizeNote && <p className="text-[10px] text-gray-400">{sizeNote}</p>}
            </div>

            {isExporting && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-violet-400">
                  <span>Recording…</span>
                  <span>{Math.round(exportProgress * 100)}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-violet-500 rounded-full"
                    style={{ width: `${exportProgress * 100}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>
            )}


            <div className="flex gap-3">
              {!isExporting ? (
                <button
                  onClick={handleExportVideo}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-500 transition-all"
                >
                  <Film className="w-4 h-4" />
                  Start Export
                </button>
              ) : (
                <button
                  onClick={() => stopRef.current?.()}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-red-900/30 text-red-400 rounded-xl hover:bg-red-900/50 transition-all"
                >
                  Cancel
                </button>
              )}
              <span className="flex items-center text-[10px] font-bold text-violet-500 uppercase tracking-wider">
                MP4 / WebM
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pick the best available recording format ─────────────────────────────────
function pickMimeType(): { mimeType: string; ext: string; label: string } {
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4', label: 'MP4 · H.264' },
    { mimeType: 'video/mp4;codecs=h264', ext: 'mp4', label: 'MP4 · H.264' },
    { mimeType: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM · VP9' },
    { mimeType: 'video/webm', ext: 'webm', label: 'WebM' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: 'video/webm', ext: 'webm', label: 'WebM' };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════
type Tab = 'description' | 'captions' | 'thumbnails' | 'export';

interface PostProcessingPanelProps {
  voiceover: Voiceover | null;
  videoClips: VideoClip[];
  currentTime: number;
  captionStyle: CaptionStyle;
  captionsEnabled: boolean;
  onCaptionStyleChange: (s: CaptionStyle) => void;
  onCaptionsEnabledChange: (v: boolean) => void;
  importedThumbnails?: ThumbnailCandidate[];
  onImportCaptions: (segments: CaptionSegment[], transcription: string) => void;
}

export function PostProcessingPanel({
  voiceover,
  videoClips,
  captionStyle,
  captionsEnabled,
  onCaptionStyleChange,
  onCaptionsEnabledChange,
  importedThumbnails = [],
  onImportCaptions,
}: PostProcessingPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('description');

  const hasTranscription = !!voiceover?.transcription && !!voiceover?.segments?.length;
  const hasClips = videoClips.length > 0;

  const tabs: {
    id: Tab;
    label: string;
    icon: React.ElementType;
    locked: boolean;
  }[] = [
    { id: 'description', label: 'Description', icon: FileText, locked: !hasTranscription },
    { id: 'captions', label: 'Captions', icon: MessageSquare, locked: !hasTranscription },
    {
      id: 'thumbnails',
      label: 'Thumbnails',
      icon: Image,
      // Imported images are browsable without AI analysis.
      locked: (!hasTranscription || !hasClips) && importedThumbnails.length === 0,
    },
    { id: 'export', label: 'Export', icon: Download, locked: false },
  ];

  return (
    <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-6 pt-5 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Film className="w-4 h-4 text-violet-500" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Post-Processing & Export</h2>
            <p className="text-[10px] text-gray-400">
              {hasTranscription
                ? 'AI analysis complete — all features unlocked'
                : 'Run AI Auto-Align to unlock generation features'}
            </p>
          </div>
          {!hasTranscription && (
            <span className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-600 text-[10px] font-bold rounded-full uppercase tracking-wider">
              <Lock className="w-2.5 h-2.5" />
              Pending Analysis
            </span>
          )}
          {hasTranscription && (
            <span className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-bold rounded-full uppercase tracking-wider">
              <Check className="w-2.5 h-2.5" />
              Ready
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-gray-200 -mx-6 px-6">
          {tabs.map(tab => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              locked={tab.locked}
              icon={tab.icon}
              label={tab.label}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="p-6"
        >
          {activeTab === 'description' && (
            voiceover
              ? <DescriptionTab voiceover={voiceover} videoClips={videoClips} />
              : <LockedState message="Upload a voiceover and run AI Auto-Align to generate descriptions." />
          )}
          {activeTab === 'captions' && (
            <CaptionsTab
              voiceover={voiceover}
              captionStyle={captionStyle}
              captionsEnabled={captionsEnabled}
              onStyleChange={onCaptionStyleChange}
              onEnabledChange={onCaptionsEnabledChange}
              onImportCaptions={onImportCaptions}
            />
          )}
          {activeTab === 'thumbnails' && (
            <ThumbnailsTab
              voiceover={voiceover}
              videoClips={videoClips}
              importedThumbnails={importedThumbnails}
            />
          )}
          {activeTab === 'export' && (
            <ExportTab
              voiceover={voiceover}
              videoClips={videoClips}
              captionStyle={captionStyle}
              captionsEnabled={captionsEnabled}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
