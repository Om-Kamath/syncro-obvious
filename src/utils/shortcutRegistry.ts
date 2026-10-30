// Single source of truth for timeline/editor shortcut documentation.
// The behavior itself is resolved by resolveShortcut() in keyboardShortcuts.ts;
// this registry describes each shortcut for the help overlay (press ?).
// Keep the two in sync — the tests assert every keymap action has an entry.

export type ShortcutGroup = 'Playback' | 'Editing' | 'General';

export interface ShortcutDefinition {
  id: string;
  /** Display key labels, e.g. ['Space'] or ['←', '→']. */
  keys: string[];
  description: string;
  group: ShortcutGroup;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Playback', 'Editing', 'General'];

export const SHORTCUT_REGISTRY: readonly ShortcutDefinition[] = [
  { id: 'toggle-play', keys: ['Space'], description: 'Play / pause the timeline', group: 'Playback' },
  { id: 'pause', keys: ['K'], description: 'Pause playback', group: 'Playback' },
  { id: 'shuttle-back', keys: ['J'], description: 'Shuttle back one second', group: 'Playback' },
  { id: 'shuttle-forward', keys: ['L'], description: 'Shuttle forward one second', group: 'Playback' },
  { id: 'frame-step', keys: ['←', '→'], description: 'Step the playhead one frame left / right', group: 'Playback' },
  { id: 'close-dialog', keys: ['Esc'], description: 'Close the open dialog or panel', group: 'General' },
  { id: 'shortcut-help', keys: ['?'], description: 'Show / hide this shortcut help overlay', group: 'General' },
];

/** True when the event is a plain "?" keypress (any shift state, no ctrl/meta/alt). */
export function isShortcutHelpToggle(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>
): boolean {
  if (e.key !== '?') return false;
  return !e.ctrlKey && !e.metaKey && !e.altKey;
}
