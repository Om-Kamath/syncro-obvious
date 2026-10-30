// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProjectsPanel } from './ProjectsPanel';
import { SavedProjectSummary } from '../types';

const PROJECTS: SavedProjectSummary[] = [
  { id: 'p-1', name: 'Launch Teaser', updatedAt: '2026-10-29T10:00:00.000Z' },
  { id: 'p-2', name: 'Podcast Clip', updatedAt: '2026-10-28T09:00:00.000Z' },
];

function renderPanel(overrides: Partial<Parameters<typeof ProjectsPanel>[0]> = {}) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onRetry = vi.fn();
  render(
    <ProjectsPanel
      projects={PROJECTS}
      onOpen={onOpen}
      onDelete={onDelete}
      onRetry={onRetry}
      {...overrides}
    />
  );
  return { onOpen, onDelete, onRetry };
}

describe('ProjectsPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty state when there are no saved projects', () => {
    renderPanel({ projects: [] });
    expect(screen.getByText(/No saved projects yet/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Delete /i })).toBeNull();
  });

  it('renders one row per saved project with its name and a count badge', () => {
    renderPanel();
    expect(screen.getByText('Launch Teaser')).toBeDefined();
    expect(screen.getByText('Podcast Clip')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open Launch Teaser' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open Podcast Clip' })).toBeDefined();
  });

  it('asks for confirmation before deleting', () => {
    const { onDelete } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch Teaser' }));
    expect(screen.getByText(/Delete “Launch Teaser”\? This can’t be undone\./)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm delete Launch Teaser' })).toBeDefined();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls onDelete with the project id after confirmation', () => {
    const { onDelete } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch Teaser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Launch Teaser' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('p-1');
  });

  it('keeps the project listed and skips onDelete when confirmation is cancelled', () => {
    const { onDelete } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch Teaser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete Launch Teaser' }));
    expect(screen.queryByText(/This can’t be undone\./)).toBeNull();
    expect(screen.getByText('Launch Teaser')).toBeDefined();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('moves the confirmation when another row requests deletion', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch Teaser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Podcast Clip' }));
    expect(screen.queryByText(/Delete “Launch Teaser”\?/)).toBeNull();
    expect(screen.getByText(/Delete “Podcast Clip”\?/)).toBeDefined();
  });

  it('calls onOpen with the project id when Open is clicked', () => {
    const { onOpen } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open Podcast Clip' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('p-2');
  });

  it('shows skeleton rows while the list is loading', () => {
    renderPanel({ loading: true });
    expect(screen.queryByRole('button', { name: /Open /i })).toBeNull();
    expect(document.querySelectorAll('.animate-pulse').length).toBe(3);
  });

  it('shows the error state and retries on demand', () => {
    const { onRetry } = renderPanel({ error: 'Saved projects storage is corrupt — expected JSON.' });
    expect(screen.getByText(/corrupt/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading saved projects' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('exposes the full project name as a title tooltip on the truncated row name', () => {
    renderPanel();
    const name = screen.getByTitle('Launch Teaser');
    expect(name).toBeDefined();
    expect(name.textContent).toBe('Launch Teaser');
    expect(name.className).toContain('truncate');
  });

  it('contains very long project names in the delete confirmation', () => {
    const longName = 'x'.repeat(300);
    renderPanel({ projects: [{ id: 'p-long', name: longName, updatedAt: '2026-10-29T10:00:00.000Z' }] });
    fireEvent.click(screen.getByRole('button', { name: `Delete ${longName}` }));
    const confirm = screen.getByText(/This can’t be undone\./);
    expect(confirm.className).toContain('break-words');
  });
});
