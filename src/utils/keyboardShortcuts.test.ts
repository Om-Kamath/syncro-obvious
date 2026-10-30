// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  FRAME_STEP_SECONDS,
  SHUTTLE_STEP_SECONDS,
  resolveShortcut,
  getShortcutContext,
} from './keyboardShortcuts';
import type { ShortcutContext } from './keyboardShortcuts';

const SHELL: ShortcutContext = { isTextEntry: false, isInteractiveControl: false };
const TEXT_ENTRY: ShortcutContext = { isTextEntry: true, isInteractiveControl: false };
const CONTROL: ShortcutContext = { isTextEntry: false, isInteractiveControl: true };

describe('resolveShortcut', () => {
  it('resolves space to toggle-play on the app shell', () => {
    expect(resolveShortcut({ key: ' ' }, SHELL)).toEqual({ type: 'toggle-play' });
  });

  it('resolves j/k/l to shuttle back, pause, and forward', () => {
    expect(resolveShortcut({ key: 'j' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: -SHUTTLE_STEP_SECONDS });
    expect(resolveShortcut({ key: 'k' }, SHELL)).toEqual({ type: 'pause' });
    expect(resolveShortcut({ key: 'l' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: SHUTTLE_STEP_SECONDS });
  });

  it('accepts upper-case j/k/l (caps lock, shift-less uppercase)', () => {
    expect(resolveShortcut({ key: 'J' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: -SHUTTLE_STEP_SECONDS });
    expect(resolveShortcut({ key: 'K' }, SHELL)).toEqual({ type: 'pause' });
    expect(resolveShortcut({ key: 'L' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: SHUTTLE_STEP_SECONDS });
  });

  it('resolves arrows to one-frame steps', () => {
    expect(resolveShortcut({ key: 'ArrowLeft' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: -FRAME_STEP_SECONDS });
    expect(resolveShortcut({ key: 'ArrowRight' }, SHELL)).toEqual({ type: 'seek', deltaSeconds: FRAME_STEP_SECONDS });
    expect(FRAME_STEP_SECONDS).toBeCloseTo(1 / 30, 10);
  });

  it('returns null for every key when focus is in a text field', () => {
    for (const key of [' ', 'j', 'k', 'l', 'ArrowLeft', 'ArrowRight']) {
      expect(resolveShortcut({ key }, TEXT_ENTRY)).toBeNull();
    }
  });

  it('returns null for keys owned by a focused interactive control', () => {
    // Clip blocks (role="button") own Space; the playhead slider owns arrows.
    for (const key of [' ', 'j', 'k', 'l', 'ArrowLeft', 'ArrowRight']) {
      expect(resolveShortcut({ key }, CONTROL)).toBeNull();
    }
  });

  it('returns null on modifier chords so browser shortcuts pass through', () => {
    expect(resolveShortcut({ key: 'j', ctrlKey: true }, SHELL)).toBeNull();
    expect(resolveShortcut({ key: 'l', metaKey: true }, SHELL)).toBeNull();
    expect(resolveShortcut({ key: ' ', altKey: true }, SHELL)).toBeNull();
  });

  it('returns null for unmapped keys', () => {
    for (const key of ['a', 'Enter', 'Escape', 'Home', 'Shift']) {
      expect(resolveShortcut({ key }, SHELL)).toBeNull();
    }
  });
});

describe('getShortcutContext', () => {
  it('treats body and plain container focus as the app shell', () => {
    expect(getShortcutContext(document.body)).toEqual(SHELL);
    const div = document.createElement('div');
    expect(getShortcutContext(div)).toEqual(SHELL);
  });

  it('treats a null/non-element target as the app shell', () => {
    expect(getShortcutContext(null)).toEqual(SHELL);
    expect(getShortcutContext(document)).toEqual(SHELL);
  });

  it('classifies text-entry elements', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(getShortcutContext(document.createElement(tag))).toEqual(TEXT_ENTRY);
    }
    // jsdom does not implement isContentEditable, so the editable path is
    // exercised by stubbing the property the classifier reads.
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(getShortcutContext(editable)).toEqual(TEXT_ENTRY);
  });

  it('classifies buttons, links, and slider-role elements as interactive controls', () => {
    expect(getShortcutContext(document.createElement('button'))).toEqual(CONTROL);
    expect(getShortcutContext(document.createElement('a'))).toEqual(CONTROL);
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    expect(getShortcutContext(slider)).toEqual(CONTROL);
    const clipBlock = document.createElement('div');
    clipBlock.setAttribute('role', 'button');
    expect(getShortcutContext(clipBlock)).toEqual(CONTROL);
  });
});
