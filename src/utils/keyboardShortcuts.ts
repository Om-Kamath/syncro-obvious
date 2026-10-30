// Pure keyboard-shortcut keymap for the timeline — kept free of React so it is
// unit-testable in isolation (same pattern as timelineZoom.ts).

/** Arrow-key step; one video frame at the export pipeline's 30 fps model. */
export const FRAME_STEP_SECONDS = 1 / 30;

/** Shuttle distance in seconds for the J/L keys. */
export const SHUTTLE_STEP_SECONDS = 1;

/** What a resolved global shortcut should do. */
export type TimelineShortcutAction =
  | { type: 'toggle-play' }
  | { type: 'pause' }
  | { type: 'seek'; deltaSeconds: number };

/** Minimal key state the keymap needs — no DOM dependency. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * Focus context a keydown is resolved against. Global shortcuts fire only from
 * the app shell: when focus sits in a text field or an interactive control,
 * that control owns the key and the keymap stands down.
 */
export interface ShortcutContext {
  isTextEntry: boolean;
  isInteractiveControl: boolean;
}

/**
 * Classify a keydown's focus target into a ShortcutContext. A thin DOM read —
 * all deciding logic stays in resolveShortcut.
 */
export function getShortcutContext(target: EventTarget | null): ShortcutContext {
  if (!(target instanceof Element)) return { isTextEntry: false, isInteractiveControl: false };
  const tag = target.tagName;
  // `=== true` keeps the union boolean (jsdom leaves isContentEditable undefined).
  // isContentEditable lives on HTMLElement, not Element — the cast is safe
  // because the property is simply undefined where it is unsupported.
  const isTextEntry =
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as HTMLElement).isContentEditable === true;
  // Roles mirror the interactive controls Syncro renders: clip blocks are
  // role="button" (Enter/Space) and the playhead + trim handles are
  // role="slider" (arrows/Home/End); native <button>/<a> carry their own key
  // semantics. The keymap must never compete with them.
  const role = target.getAttribute('role');
  const isInteractiveControl =
    tag === 'BUTTON' || tag === 'A' || role === 'button' || role === 'slider';
  return { isTextEntry, isInteractiveControl };
}

/**
 * Resolve a keydown into a timeline action, or null when the key belongs to
 * the focused control or maps to nothing. Modifier chords always return null
 * so browser/OS shortcuts (Ctrl+J, Cmd+L, …) pass through untouched.
 */
export function resolveShortcut(event: ShortcutKeyEvent, context: ShortcutContext): TimelineShortcutAction | null {
  if (context.isTextEntry || context.isInteractiveControl) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case ' ': return { type: 'toggle-play' };
    case 'j': case 'J': return { type: 'seek', deltaSeconds: -SHUTTLE_STEP_SECONDS };
    case 'k': case 'K': return { type: 'pause' };
    case 'l': case 'L': return { type: 'seek', deltaSeconds: SHUTTLE_STEP_SECONDS };
    case 'ArrowLeft': return { type: 'seek', deltaSeconds: -FRAME_STEP_SECONDS };
    case 'ArrowRight': return { type: 'seek', deltaSeconds: FRAME_STEP_SECONDS };
    default: return null;
  }
}
