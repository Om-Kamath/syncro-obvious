import { useCallback, useRef } from 'react';
import { Check, Image as ImageIcon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * One selectable thumbnail variant in the publish flow. Kept structural on
 * purpose: the publish checklist should be able to feed it candidates today
 * and per-moment variants (A/B crops/overlays) tomorrow without a shape lock.
 */
export interface ThumbnailVariantOption {
  id: string;
  label: string;
  imageDataUrl: string;
  description?: string;
}

interface ThumbnailVariantPickerProps {
  variants: ThumbnailVariantOption[];
  /** id of the chosen variant; lives in project state, never locally here */
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/**
 * Controlled single-select picker over generated thumbnail variants
 * (WAI-ARIA radio pattern: roving tabindex, arrow keys move the selection).
 * Selection state is owned by the parent so it persists with the project.
 */
export function ThumbnailVariantPicker({
  variants,
  selectedId,
  onSelect,
  disabled = false,
}: ThumbnailVariantPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const moveSelection = useCallback(
    (fromIndex: number, step: 1 | -1) => {
      if (variants.length === 0) return;
      const nextIndex = (fromIndex + step + variants.length) % variants.length;
      onSelect(variants[nextIndex].id);
      const radios = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      radios?.[nextIndex]?.focus();
    },
    [variants, onSelect],
  );

  const selectedExists = variants.some((v) => v.id === selectedId);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3" data-testid="thumbnail-variant-picker">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Publish thumbnail</p>
          <p className="text-xs text-violet-500 mt-0.5">
            {selectedExists
              ? 'Selected variant is marked and will be used for publishing'
              : 'Pick the variant to use as your publish thumbnail'}
          </p>
        </div>
        {selectedExists && (
          <span className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 text-white text-[10px] font-bold rounded-full">
            <Check className="w-3 h-3" />
            {variants.find((v) => v.id === selectedId)?.label}
          </span>
        )}
      </div>

      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Publish thumbnail variants"
        className="grid grid-cols-2 gap-3"
      >
        {variants.map((variant, i) => {
          const isSelected = variant.id === selectedId;
          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              tabIndex={isSelected || (!selectedExists && i === 0) ? 0 : -1}
              onClick={() => onSelect(variant.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  moveSelection(i, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveSelection(i, -1);
                }
              }}
              className={cn(
                'group relative rounded-xl border text-left overflow-hidden transition-all',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2',
                isSelected
                  ? 'border-violet-600 ring-2 ring-violet-600 bg-violet-50'
                  : 'border-gray-200 hover:border-violet-400 bg-gray-50',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="relative aspect-video bg-black/50">
                <img
                  src={variant.imageDataUrl}
                  alt={variant.label}
                  className="w-full h-full object-cover"
                />
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <span className="flex items-center justify-center w-5 h-5 bg-violet-600 rounded-full text-white">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  </div>
                )}
                {!variant.imageDataUrl && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                )}
              </div>
              <div className="p-2.5 space-y-1">
                <p className="text-xs font-semibold text-gray-900 line-clamp-1">{variant.label}</p>
                {variant.description && (
                  <p className="text-[10px] text-violet-500 line-clamp-2">{variant.description}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
