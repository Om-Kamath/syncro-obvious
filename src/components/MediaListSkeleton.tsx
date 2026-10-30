import React from 'react';

interface MediaListSkeletonProps {
  /** Number of placeholder rows to show — one per media item being processed. */
  count: number;
  /** Accessible status text announced to assistive tech. */
  label?: string;
}

/**
 * Pulsing placeholder rows shown in a media list while its items are being
 * processed (e.g. video metadata is still loading). Renders nothing when
 * count is 0, so call sites can render it unconditionally.
 */
export const MediaListSkeleton: React.FC<MediaListSkeletonProps> = ({
  count,
  label = 'Loading media…',
}) => {
  if (count <= 0) return null;

  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 border border-gray-100 bg-gray-50 rounded-xl animate-pulse"
          >
            <div className="w-11 h-11 bg-gray-200 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-3 w-3/4 bg-gray-200 rounded" />
              <div className="h-2.5 w-1/3 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
