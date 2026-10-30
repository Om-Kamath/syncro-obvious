import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { partitionDroppedFiles } from '../utils/mediaImport';

export interface ImportedMedia {
  videos: File[];
  audios: File[];
  images: File[];
}

interface MediaDropLayerProps {
  onImport: (imported: ImportedMedia) => void;
  onRejected?: (files: File[]) => void;
}

function eventHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * App-wide drop target: listens on the window (capture phase) so media can be
 * dropped anywhere in the app, and shows a fullscreen hint while a drag is in
 * progress.
 *
 * Drop events aimed at a per-uploader dropzone (marked `data-media-dropzone`)
 * are ignored here — those zones run their own accept/reject flow. The check
 * must be synchronous on the capture phase because react-dropzone invokes its
 * user `onDrop` callback asynchronously (after the event has finished
 * bubbling), so `stopPropagation` from that callback cannot guard this layer.
 */
export function MediaDropLayer({ onImport, onRejected }: MediaDropLayerProps) {
  const [dragDepth, setDragDepth] = useState(0);
  const onImportRef = useRef(onImport);
  const onRejectedRef = useRef(onRejected);
  useEffect(() => {
    onImportRef.current = onImport;
    onRejectedRef.current = onRejected;
  }, [onImport, onRejected]);

  useEffect(() => {
    const isInsideDropzone = (event: DragEvent): boolean =>
      event.target instanceof Element && event.target.closest('[data-media-dropzone]') !== null;

    const onDragEnter = (event: DragEvent) => {
      if (!eventHasFiles(event)) return;
      event.preventDefault();
      setDragDepth(depth => depth + 1);
    };
    const onDragOver = (event: DragEvent) => {
      if (!eventHasFiles(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!eventHasFiles(event)) return;
      // relatedTarget is null when the drag leaves the window entirely;
      // transitions between elements leave the overlay up.
      if (event.relatedTarget === null) setDragDepth(0);
    };
    const onDragEnd = () => setDragDepth(0);
    const onDrop = (event: DragEvent) => {
      if (!eventHasFiles(event)) return;
      event.preventDefault();
      setDragDepth(0);
      if (isInsideDropzone(event)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const partitioned = partitionDroppedFiles(files);
      if (partitioned.rejected.length > 0) onRejectedRef.current?.(partitioned.rejected);
      if (partitioned.videos.length + partitioned.audios.length + partitioned.images.length > 0) {
        onImportRef.current({
          videos: partitioned.videos,
          audios: partitioned.audios,
          images: partitioned.images,
        });
      }
    };

    // Capture phase: see the drop before per-uploader zones react to it.
    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('dragend', onDragEnd, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('dragend', onDragEnd, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, []);

  if (dragDepth === 0) return null;
  return (
    <div
      data-testid="media-drop-overlay"
      className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-violet-950/40 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-violet-300 bg-white/95 px-10 py-8 text-center shadow-2xl">
        <UploadCloud className="w-8 h-8 text-violet-500" />
        <p className="text-base font-bold text-gray-900">Drop media to import</p>
        <p className="text-xs text-gray-500">Video, audio, and image files are supported</p>
      </div>
    </div>
  );
}
