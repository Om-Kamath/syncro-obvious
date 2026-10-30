// Pure selection state for timeline clips: which ids are selected plus the
// shift-click anchor. Kept free of React and DOM so the reducer and the
// range/marquee helpers below stay unit-testable.

export interface SelectionState {
  ids: ReadonlySet<string>;
  /** Clip the last non-shift selection started from; shift-click extends from it. */
  anchorId: string | null;
}

export type SelectionAction =
  | { type: 'select'; id: string } // plain click — replace with a single clip
  | { type: 'toggle'; id: string } // ctrl/cmd-click
  | { type: 'add'; ids: readonly string[] } // union with the existing selection
  | { type: 'set'; ids: readonly string[] } // replace (marquee result)
  | { type: 'extend'; id: string; orderedIds: readonly string[] } // shift-click range
  | { type: 'clear' };

export const initialSelection: SelectionState = { ids: new Set(), anchorId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'select':
      return { ids: new Set([action.id]), anchorId: action.id };
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      const anchorId = ids.has(action.id) ? action.id : state.anchorId === action.id ? null : state.anchorId;
      return { ids, anchorId };
    }
    case 'add': {
      if (action.ids.length === 0) return state;
      const ids = new Set(state.ids);
      for (const id of action.ids) ids.add(id);
      return { ids, anchorId: state.anchorId ?? action.ids[0] };
    }
    case 'set':
      return {
        ids: new Set(action.ids),
        anchorId: action.ids.length > 0 ? action.ids[action.ids.length - 1] : null,
      };
    case 'extend':
      return {
        ids: new Set(extendRange(action.orderedIds, state.anchorId, action.id)),
        anchorId: state.anchorId ?? action.id,
      };
    case 'clear':
      return { ids: new Set(), anchorId: null };
  }
}

/**
 * Contiguous slice of `orderedIds` from `anchorId` to `targetId`, inclusive,
 * in timeline order. Falls back to just the target when there is no usable
 * anchor (none set, or it no longer exists in `orderedIds`).
 */
export function extendRange(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex === -1) return [];
  const anchorIndex = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (anchorIndex === -1) return [targetId];
  const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return orderedIds.slice(from, to + 1);
}

export interface ClipBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Ids of clips intersecting a marquee rectangle. The rect may have negative
 * width/height (dragged upward/leftward); edges touching exactly do not count
 * as overlapping.
 */
export function clipIdsInRect(boxes: readonly ClipBox[], rect: SelectionRect): string[] {
  const left = Math.min(rect.left, rect.left + rect.width);
  const top = Math.min(rect.top, rect.top + rect.height);
  const right = left + Math.abs(rect.width);
  const bottom = top + Math.abs(rect.height);
  return boxes
    .filter((box) => box.left < right && box.left + box.width > left && box.top < bottom && box.top + box.height > top)
    .map((box) => box.id);
}
