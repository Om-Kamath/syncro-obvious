import { useState } from 'react';
import {
  Check,
  Circle,
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  ListOrdered,
  MessageSquare,
  Share2,
  Type,
} from 'lucide-react';
import type { ThumbnailCandidate, VideoDescription, Voiceover } from '../types';
import { generateSRT, generateVTT, downloadTextFile } from '../utils/captionUtils';
import { downloadDataUrl } from '../utils/exportUtils';
import {
  buildFullDescriptionText,
  buildPlatformCopy,
  buildPublishPackageText,
  formatChapterLines,
  formatChapterTime,
} from '../utils/platformCopy';
import { PLATFORM_PRESETS, type PlatformId } from '../utils/platformPresets';
import { CopyButton } from './CopyButton';

// ── Section card with ready/pending badge ────────────────────────────────────
function SectionCard({
  icon: Icon,
  label,
  ready,
  hint,
  keepContent = false,
  children,
}: {
  icon: React.ElementType;
  label: string;
  ready: boolean;
  hint: string;
  keepContent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        'p-4 rounded-2xl border space-y-3 ' +
        (ready ? 'bg-gray-50 border-gray-100' : 'bg-white border-dashed border-gray-200')
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
        </div>
        <span
          className={
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ' +
            (ready
              ? 'bg-green-50 border-green-200 text-green-600'
              : 'bg-gray-100 border-gray-200 text-gray-400')
          }
        >
          {ready ? <Check className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
          {ready ? 'Ready' : 'Pending'}
        </span>
      </div>
      {ready || keepContent ? children : <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

interface PublishChecklistTabProps {
  voiceover: Voiceover | null;
  description: VideoDescription | null;
  thumbnails: ThumbnailCandidate[];
}

/**
 * Consolidates every publish asset in one place: the chosen title, the
 * generated description, per-platform copy, thumbnails, captions, and
 * chapters — each with copy or download actions and a ready/pending state.
 */
export function PublishChecklistTab({ voiceover, description, thumbnails }: PublishChecklistTabProps) {
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState<PlatformId>('youtube');

  const segments = voiceover?.segments ?? [];
  const hasTitle = title.trim().length > 0;
  const hasDescription = !!description && description.summary.trim().length > 0;
  const hasThumbnails = thumbnails.length > 0;
  const hasCaptions = segments.length > 0;
  const hasChapters = !!description && description.chapters.length > 0;
  const readyCount = [
    hasTitle,
    hasDescription,
    hasDescription,
    hasThumbnails,
    hasCaptions,
    hasChapters,
  ].filter(Boolean).length;

  const publishPackageText = buildPublishPackageText({ title, description });

  const handleDownloadSRT = () => {
    if (!segments.length) return;
    downloadTextFile(generateSRT(segments), 'captions.srt', 'text/plain');
  };

  const handleDownloadVTT = () => {
    if (!segments.length) return;
    downloadTextFile(generateVTT(segments), 'captions.vtt', 'text/vtt');
  };

  return (
    <div className="space-y-4">
      {/* Header + copy-everything */}
      <div className="flex items-center justify-between p-4 bg-violet-50 border border-violet-100 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <ListChecks className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Publish Checklist</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Every publish asset in one place — copy or download as you go.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-violet-600 whitespace-nowrap">
            {readyCount} of 6 ready
          </span>
          {publishPackageText && (
            <CopyButton text={publishPackageText} ariaLabel="Copy all publish assets" className="bg-white" />
          )}
        </div>
      </div>

      {/* 1 · Title */}
      <SectionCard
        icon={Type}
        label="Title"
        ready={hasTitle}
        hint="Type the video title here — it tops the publish package and platform copy."
        keepContent
      >
        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            aria-label="Video title"
            placeholder="Add your video title…"
            className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-300"
          />
          {hasTitle && <CopyButton text={title.trim()} ariaLabel="Copy title" />}
        </div>
      </SectionCard>

      {/* 2 · Description */}
      <SectionCard
        icon={FileText}
        label="Description"
        ready={hasDescription}
        hint="Generate a summary in the Description tab first."
      >
        {description && (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 leading-relaxed">{description.summary}</p>
            <div className="flex justify-end">
              <CopyButton text={buildFullDescriptionText(description)} ariaLabel="Copy description" />
            </div>
          </div>
        )}
      </SectionCard>

      {/* 3 · Platform copy */}
      <SectionCard
        icon={Share2}
        label="Platform Copy"
        ready={hasDescription}
        hint="Generate a description first — platform copy is built from it."
      >
        <div className="grid grid-cols-4 gap-2">
          {Object.values(PLATFORM_PRESETS).map(p => (
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              aria-pressed={platform === p.id}
              className={
                'py-1.5 px-1 text-xs font-semibold rounded-xl border transition-all ' +
                (platform === p.id
                  ? 'bg-violet-50 border-violet-400 text-violet-600'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed bg-white border border-gray-100 rounded-xl p-3">
          {buildPlatformCopy(platform, { title, description })}
        </pre>
        <div className="flex justify-end">
          <CopyButton
            text={buildPlatformCopy(platform, { title, description })}
            ariaLabel="Copy platform copy"
          />
        </div>
      </SectionCard>

      {/* 4 · Thumbnails */}
      <SectionCard
        icon={ImageIcon}
        label={`Thumbnails (${thumbnails.length})`}
        ready={hasThumbnails}
        hint="Generate thumbnail candidates in the Thumbnails tab first."
      >
        <div className="grid grid-cols-2 gap-3">
          {thumbnails.map((thumb, i) => (
            <div key={thumb.id} className="space-y-2">
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-black/50 aspect-video">
                <img src={thumb.imageDataUrl} alt={thumb.quote} className="w-full h-full object-cover" />
              </div>
              <button
                onClick={() => downloadDataUrl(thumb.imageDataUrl, `thumbnail-${i + 1}-${thumb.timestamp}s.jpg`)}
                aria-label={`Download thumbnail ${i + 1}`}
                className="flex items-center gap-1.5 w-full justify-center py-1.5 text-xs font-semibold bg-white border border-gray-200 text-violet-500 rounded-lg hover:bg-violet-50 hover:border-violet-400 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 5 · Captions */}
      <SectionCard
        icon={MessageSquare}
        label="Captions"
        ready={hasCaptions}
        hint="Run AI Auto-Align to transcribe the voiceover first."
      >
        <div className="flex flex-wrap gap-2 justify-end">
          {hasCaptions && (
            <CopyButton text={generateSRT(segments)} ariaLabel="Copy SRT" className="bg-white" />
          )}
          <button
            onClick={handleDownloadSRT}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Download SRT
          </button>
          <button
            onClick={handleDownloadVTT}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white border border-gray-200 text-violet-600 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Download VTT
          </button>
        </div>
      </SectionCard>

      {/* 6 · Chapters */}
      <SectionCard
        icon={ListOrdered}
        label="Chapters"
        ready={hasChapters}
        hint="Generate a description with chapters first."
      >
        {description && description.chapters.length > 0 && (
          <div className="space-y-2">
            <div className="space-y-1">
              {description.chapters.map((ch, i) => (
                <div key={i} className="flex items-center gap-3 py-0.5">
                  <span className="font-mono text-xs font-bold text-violet-400 w-10 flex-shrink-0">
                    {formatChapterTime(ch.time)}
                  </span>
                  <span className="text-sm text-gray-700">{ch.label}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <CopyButton
                text={formatChapterLines(description.chapters)}
                ariaLabel="Copy chapters"
              />
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
