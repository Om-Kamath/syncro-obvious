// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ShortcutHelpOverlay } from './ShortcutHelpOverlay';
import {
  SHORTCUT_GROUPS,
  SHORTCUT_REGISTRY,
  isShortcutHelpToggle,
} from '../utils/shortcutRegistry';
import { resolveShortcut } from '../utils/keyboardShortcuts';

describe('ShortcutHelpOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(<ShortcutHelpOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog with every registry entry when open', () => {
    render(<ShortcutHelpOverlay open={true} onClose={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Every group with entries appears as a section heading.
    const registryGroups = new Set(SHORTCUT_REGISTRY.map(s => s.group));
    for (const group of SHORTCUT_GROUPS.filter(g => registryGroups.has(g))) {
      expect(screen.getByRole('heading', { name: group })).toBeDefined();
    }

    // Every shortcut description and key label renders — the overlay is
    // registry-driven, so a new registry entry appears here automatically.
    for (const shortcut of SHORTCUT_REGISTRY) {
      expect(screen.getByText(shortcut.description)).toBeDefined();
      for (const key of shortcut.keys) {
        expect(screen.getByText(key)).toBeDefined();
      }
    }
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click but not on dialog click', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    // Click inside the dialog body — stopPropagation must keep it open.
    fireEvent.click(screen.getByRole('heading', { name: 'Keyboard Shortcuts' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('shortcut-overlay-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape after closing', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    rerender(<ShortcutHelpOverlay open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('shortcut registry helpers', () => {
  it('toggles on a plain "?" keypress and never on modifier combos', () => {
    // Shift+"?" is how most layouts type "?" — shift state must not matter.
    expect(isShortcutHelpToggle({ key: '?', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isShortcutHelpToggle({ key: '?', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isShortcutHelpToggle({ key: '?', ctrlKey: false, metaKey: true, altKey: false })).toBe(false);
    expect(isShortcutHelpToggle({ key: '?', ctrlKey: false, metaKey: false, altKey: true })).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isShortcutHelpToggle({ key: 's', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it('documents every key the keymap resolves', () => {
    // Drift guard: any key resolveShortcut() acts on must have a registry
    // entry, so the help overlay never lies about what works.
    const context = { isTextEntry: false, isInteractiveControl: false };
    const documented = new Set(SHORTCUT_REGISTRY.flatMap(s => s.keys));
    for (const key of [' ', 'j', 'k', 'l', 'ArrowLeft', 'ArrowRight']) {
      const action = resolveShortcut({ key }, context);
      expect(action, `keymap resolves ${key}`).not.toBeNull();
      const label = key === ' ' ? 'Space'
        : key === 'ArrowLeft' ? '←'
        : key === 'ArrowRight' ? '→'
        : key.toUpperCase();
      expect(documented.has(label), `${key} is in the registry`).toBe(true);
    }
  });
});
