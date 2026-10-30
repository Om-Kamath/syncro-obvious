import { Film, Plus, Trash2 } from 'lucide-react';
import { MediaAsset } from '../types';

interface MediaLibraryPanelProps {
  assets: MediaAsset[];
  usageCounts: Record<string, number>;
  onAddToTimeline: (assetId: string) => void;
  onRemoveAsset: (assetId: string) => void;
}

// Sidebar panel over imported media: every uploaded video lives here as a
// reusable asset, with how many timeline instances use it and actions to
// re-add or remove it.
export function MediaLibraryPanel({ assets, usageCounts, onAddToTimeline, onRemoveAsset }: MediaLibraryPanelProps) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
          <Film className="w-3.5 h-3.5" /> Media Library
        </h2>
        <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">{assets.length}</span>
      </div>
      <div className="p-4 space-y-2">
        {assets.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
            No imported media yet — videos you upload stay here for reuse.
          </p>
        ) : (
          assets.map((asset) => {
            const usage = usageCounts[asset.id] ?? 0;
            return (
              <div key={asset.id} className="flex items-center gap-3 border border-gray-100 bg-gray-50 hover:border-gray-200 rounded-xl p-3 transition-all">
                <div className="w-10 h-10 bg-gray-200 rounded-lg overflow-hidden shrink-0">
                  <video src={asset.url} className="w-full h-full object-cover" muted />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-700 truncate">{asset.name}</p>
                  <p className="text-[10px] text-gray-400">{asset.duration.toFixed(1)}s</p>
                  {usage > 0 ? (
                    <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">
                      On timeline ×{usage}
                    </span>
                  ) : (
                    <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                      Not on timeline
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => onAddToTimeline(asset.id)}
                    aria-label={`Add ${asset.name} to timeline`}
                    title="Add a copy to the end of the timeline"
                    className="p-1.5 text-gray-300 hover:text-violet-500 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onRemoveAsset(asset.id)}
                    disabled={usage > 0}
                    aria-label={`Remove ${asset.name} from library`}
                    title={usage > 0 ? 'Remove clips from the timeline first' : 'Remove from library'}
                    className="p-1.5 text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-300 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
