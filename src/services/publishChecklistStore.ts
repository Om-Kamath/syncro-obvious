import type { PlatformId } from '../utils/platformPresets';
import { PLATFORM_PRESETS } from '../utils/platformPresets';

/**
 * Persisted publish-checklist state: per-platform choices (title, copy,
 * thumbnail) plus the platform whose copy view was last selected.
 *
 * localStorage-backed today; `checklistToJSON`/`checklistFromJSON` are the
 * seam a server-backed ProjectState serializer will call when saved projects
 * land (spec PR 22+), so the shape is deliberately JSON-only.
 */

const STORAGE_KEY = 'syncro_publish_checklist';

export interface PlatformChecklistChoices {
  /** Chosen video title for this platform. */
  title?: string;
  /** Chosen (possibly edited) platform copy text for this platform. */
  copy?: string;
  /** Chosen thumbnail candidate id for this platform. */
  thumbnailId?: string;
}

export interface PublishChecklistState {
  /** Platform whose copy view was last selected (restored on load). */
  activePlatform: PlatformId;
  /** Choices per platform; platforms without choices are simply absent. */
  platforms: Partial<Record<PlatformId, PlatformChecklistChoices>>;
}

export const EMPTY_CHECKLIST_STATE: PublishChecklistState = {
  activePlatform: 'youtube',
  platforms: {},
};

const PLATFORM_IDS = Object.keys(PLATFORM_PRESETS) as PlatformId[];

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && PLATFORM_IDS.includes(value as PlatformId);
}

// ── Pure core: serialize → parse round-trips through these ───────────────

export function checklistToJSON(state: PublishChecklistState): string {
  return JSON.stringify(state);
}

export function checklistFromJSON(json: string): PublishChecklistState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid publish checklist state: not parseable JSON');
  }
  return validateChecklistState(parsed);
}

function validateChecklistState(value: unknown): PublishChecklistState {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid publish checklist state: expected an object');
  }
  const s = value as Record<string, unknown>;
  if (!isPlatformId(s.activePlatform)) {
    throw new Error(`Invalid publish checklist state: unknown activePlatform ${JSON.stringify(s.activePlatform ?? null)}`);
  }
  if (typeof s.platforms !== 'object' || s.platforms === null || Array.isArray(s.platforms)) {
    throw new Error('Invalid publish checklist state: platforms must be an object');
  }

  const platforms: PublishChecklistState['platforms'] = {};
  for (const [key, entry] of Object.entries(s.platforms)) {
    // Unknown platform keys are dropped, not rejected: older builds must not
    // lose the platforms they know about just because a newer one added some.
    if (!isPlatformId(key)) continue;
    platforms[key] = validatePlatformChoices(entry);
  }
  return { activePlatform: s.activePlatform, platforms };
}

function validatePlatformChoices(value: unknown): PlatformChecklistChoices {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid publish checklist state: platform choices must be an object');
  }
  const c = value as Record<string, unknown>;
  return {
    title: optionalString(c.title, 'title'),
    copy: optionalString(c.copy, 'copy'),
    thumbnailId: optionalString(c.thumbnailId, 'thumbnailId'),
  };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid publish checklist state: ${field} must be a string`);
  }
  return value;
}

/** Returns a new state with `platform` selected; the original is untouched. */
export function choosePlatform(state: PublishChecklistState, platform: PlatformId): PublishChecklistState {
  if (!isPlatformId(platform)) {
    throw new Error(`Unknown platform: ${String(platform)}`);
  }
  return { ...state, activePlatform: platform };
}

/** Returns a new state with `patch` merged into `platform`'s choices. */
export function setPlatformChoices(
  state: PublishChecklistState,
  platform: PlatformId,
  patch: PlatformChecklistChoices,
): PublishChecklistState {
  const merged: PlatformChecklistChoices = { ...state.platforms[platform], ...patch };
  return { ...state, platforms: { ...state.platforms, [platform]: merged } };
}

// ── localStorage edge ────────────────────────────────────────────────────

function getStorage(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new Error('Publish checklist persistence requires localStorage, which is unavailable here');
  }
  return localStorage;
}

export function loadChecklistState(storage: Storage = getStorage()): PublishChecklistState {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { ...EMPTY_CHECKLIST_STATE };
  return checklistFromJSON(raw);
}

/**
 * Corruption-tolerant loader for UI mount: a corrupted payload resets to the
 * empty state instead of crashing the checklist, with the reason surfaced on
 * the console.
 */
export function tryLoadChecklistState(storage: Storage = getStorage()): PublishChecklistState {
  try {
    return loadChecklistState(storage);
  } catch (error) {
    console.warn('Saved publish checklist could not be restored — starting empty:', error);
    return { ...EMPTY_CHECKLIST_STATE };
  }
}

export function saveChecklistState(state: PublishChecklistState, storage: Storage = getStorage()): void {
  storage.setItem(STORAGE_KEY, checklistToJSON(state));
}
