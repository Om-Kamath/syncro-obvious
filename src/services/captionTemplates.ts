import { CaptionMode, CaptionStyle, CaptionTemplate } from '../types';

const STORAGE_KEY = 'syncro_caption_templates';

const CAPTION_MODES: readonly CaptionMode[] = ['lower-third', 'word-highlight', 'speaker-labeled'];

// ── Pure core: serialize → parse → apply round-trips through these ────────

export function templateToJSON(template: CaptionTemplate): string {
  return JSON.stringify(template);
}

export function templateFromJSON(json: string): CaptionTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid caption template: not parseable JSON');
  }
  return validateTemplate(parsed);
}

function validateTemplate(value: unknown): CaptionTemplate {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid caption template: expected an object');
  }
  const t = value as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id.length === 0) {
    throw new Error('Invalid caption template: missing id');
  }
  if (typeof t.name !== 'string' || t.name.trim().length === 0) {
    throw new Error('Invalid caption template: missing name');
  }
  if (typeof t.createdAt !== 'number' || !Number.isFinite(t.createdAt)) {
    throw new Error('Invalid caption template: missing createdAt');
  }
  return { id: t.id, name: t.name, createdAt: t.createdAt, style: validateStyle(t.style) };
}

function validateStyle(value: unknown): CaptionStyle {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid caption template: missing style');
  }
  const s = value as Record<string, unknown>;
  if (typeof s.mode !== 'string' || !CAPTION_MODES.includes(s.mode as CaptionMode)) {
    throw new Error(`Invalid caption template style: unknown mode ${String(s.mode)}`);
  }
  if (typeof s.fontSize !== 'number' || !Number.isFinite(s.fontSize)) {
    throw new Error('Invalid caption template style: fontSize must be a finite number');
  }
  if (typeof s.color !== 'string' || s.color.length === 0 || typeof s.bgColor !== 'string' || s.bgColor.length === 0) {
    throw new Error('Invalid caption template style: colors must be non-empty strings');
  }
  if (s.position !== 'bottom' && s.position !== 'top') {
    throw new Error(`Invalid caption template style: unknown position ${String(s.position)}`);
  }
  return { mode: s.mode as CaptionMode, fontSize: s.fontSize, color: s.color, bgColor: s.bgColor, position: s.position };
}

export function applyTemplate(template: CaptionTemplate): CaptionStyle {
  // Defensive copy: later edits to the applied style must not mutate the template.
  return { ...template.style };
}

export function upsertTemplate(
  templates: CaptionTemplate[],
  name: string,
  style: CaptionStyle,
  newId: string,
  savedAt: number,
): CaptionTemplate[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Template name is required');
  const existingIndex = templates.findIndex(t => t.name === trimmed);
  if (existingIndex >= 0) {
    // Same name = same template: overwrite in place so its id stays stable.
    const next = [...templates];
    next[existingIndex] = { ...next[existingIndex], style: { ...style }, createdAt: savedAt };
    return next;
  }
  return [...templates, { id: newId, name: trimmed, style: { ...style }, createdAt: savedAt }];
}

export function removeTemplate(templates: CaptionTemplate[], id: string): CaptionTemplate[] {
  return templates.filter(t => t.id !== id);
}

// ── localStorage edge ────────────────────────────────────────────────────

function getStorage(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new Error('Caption templates require localStorage, which is unavailable here');
  }
  return localStorage;
}

export function listTemplates(storage: Storage = getStorage()): CaptionTemplate[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved caption templates are corrupted: storage is not parseable JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Saved caption templates are corrupted: expected a list');
  }
  return parsed.map(entry => validateTemplate(entry));
}

export interface TemplateLoadResult {
  templates: CaptionTemplate[];
  error: string | null;
}

/**
 * Non-throwing load for render-time initialization (state initializers must not
 * throw and effects must not setState). Corrupted storage surfaces as `error`.
 */
export function loadTemplatesResult(storage: Storage = getStorage()): TemplateLoadResult {
  try {
    return { templates: listTemplates(storage), error: null };
  } catch (err) {
    return { templates: [], error: err instanceof Error ? err.message : 'Failed to load templates' };
  }
}

export function saveTemplate(name: string, style: CaptionStyle, storage: Storage = getStorage()): void {
  const templates = upsertTemplate(listTemplates(storage), name, style, generateTemplateId(), Date.now());
  storage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function deleteTemplate(id: string, storage: Storage = getStorage()): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(removeTemplate(listTemplates(storage), id)));
}

function generateTemplateId(): string {
  // Follows the repo's existing id convention (clip ids, logger entries).
  return Math.random().toString(36).slice(2);
}
