import { Download } from 'lucide-react';
import { formatTimestamp, downloadDataUrl } from '../utils/exportUtils';
import type { ThumbnailMomentVariants } from '../utils/thumbnailVariants';

/**
 * A/B compare grid: one section per key moment, showing every rendered
 * variant side by side with its crop/overlay description and a download.
 * Purely presentational — the panel owns generation state.
 */
export function ThumbnailCompareGrid({ moments }: { moments: ThumbnailMomentVariants[] }) {
  if (moments.length === 0) return null;

  return (
    <div className="space-y-6">
      {moments.map((moment, mi) => (
        <section
          key={moment.id}
          aria-label={`Thumbnail variants for moment at ${formatTimestamp(moment.timestamp)}`}
          className="space-y-3"
        >
          <div className="flex items-start gap-2">
            <span className="px-2 py-0.5 bg-violet-600 text-white text-[10px] font-mono rounded-md mt-0.5 flex-shrink-0">
              {formatTimestamp(moment.timestamp)}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900 line-clamp-1">"{moment.quote}"</p>
              <p className="text-[10px] text-violet-500 line-clamp-1">{moment.reason}</p>
            </div>
          </div>
          <div role="list" className="grid grid-cols-2 gap-4">
            {moment.variants.map(variant => (
              <div
                role="listitem"
                key={variant.label}
                aria-label={`Variant ${variant.label}: ${variant.description}`}
                className="rounded-2xl border border-gray-200 overflow-hidden bg-gray-50 hover:border-violet-400 hover:shadow-lg hover:shadow-violet-200/50 transition-all"
              >
                <div className="relative aspect-video bg-black/50">
                  <img
                    src={variant.imageDataUrl}
                    alt={`Variant ${variant.label}: ${variant.description}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 flex gap-1.5">
                    <span className="px-2 py-0.5 bg-violet-600 text-white text-[10px] font-bold rounded-md">
                      {variant.label}
                    </span>
                    <span className="px-2 py-0.5 bg-black/60 text-white text-[10px] font-mono rounded-md">
                      {formatTimestamp(moment.timestamp)}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-[10px] text-violet-500 line-clamp-1">{variant.description}</p>
                  <button
                    onClick={() =>
                      downloadDataUrl(
                        variant.imageDataUrl,
                        `thumbnail-${mi + 1}-variant-${variant.label}-${moment.timestamp}s.jpg`
                      )
                    }
                    className="flex items-center gap-1.5 w-full justify-center py-1.5 text-xs font-semibold bg-gray-100 border border-gray-200 text-violet-400 rounded-lg hover:bg-violet-50 hover:text-violet-600 hover:border-violet-400 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download {variant.label}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
