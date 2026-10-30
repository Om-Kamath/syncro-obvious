// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProjectsModal, type ProjectsModalProps } from './ProjectsModal';
import type { SavedProjectSummary } from '../services/projectPersistence';

function makeProject(overrides: Partial<SavedProjectSummary> = {}): SavedProjectSummary {
  return {
    id: 'proj-1',
    name: 'Launch video',
    savedAt: '2026-10-30T10:00:00.000Z',
    clipCount: 1,
    hasVoiceover: false,
    ...overrides,
  };
}

function renderModal(overrides: Partial<ProjectsModalProps> = {}) {
  const props: ProjectsModalProps = {
    projects: [],
    loading: false,
    error: null,
    saving: false,
    canSave: true,
    currentProjectId: null,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<ProjectsModal {...props} />);
  return props;
}

describe('ProjectsModal', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the empty state when no projects are saved', () => {
    renderModal();
    expect(screen.getByText('No saved projects yet')).toBeDefined();
  });

  it('shows a loading state while the list is being fetched', () => {
    renderModal({ loading: true });
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeDefined();
  });

  it('renders the project list with clip counts', () => {
    renderModal({ projects: [makeProject(), makeProject({ id: 'proj-2', name: 'Teaser' })] });
    expect(screen.getByText('Launch video')).toBeDefined();
    expect(screen.getByText('Teaser')).toBeDefined();
    expect(screen.getAllByText(/1 clip ·/)).toHaveLength(2);
  });

  it('marks and disables the currently loaded project', () => {
    renderModal({ projects: [makeProject()], currentProjectId: 'proj-1' });
    expect(screen.getByText('Loaded')).toBeDefined();
    const loadButton = screen.getByRole('button', { name: /Load/ }) as HTMLButtonElement;
    expect(loadButton.disabled).toBe(true);
  });

  it('saves from the name input, including Enter-to-submit', () => {
    const onSave = vi.fn();
    renderModal({ onSave });

    const input = screen.getByLabelText('Project name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Launch video' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    expect(onSave).toHaveBeenCalledWith('Launch video');

    fireEvent.change(input, { target: { value: 'Second cut' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('Second cut');
  });

  it('disables saving when the editor has nothing to save', () => {
    renderModal({ canSave: false });
    const saveButton = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText(/there is nothing to save yet/)).toBeDefined();
  });

  it('loads a project by id', () => {
    const onLoad = vi.fn();
    renderModal({ projects: [makeProject()], onLoad });
    fireEvent.click(screen.getByRole('button', { name: /Load/ }));
    expect(onLoad).toHaveBeenCalledWith('proj-1');
  });

  it('renames inline: pencil → edit → confirm', () => {
    const onRename = vi.fn();
    renderModal({ projects: [makeProject()], onRename });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Launch video' }));
    const input = screen.getByLabelText('New project name') as HTMLInputElement;
    expect(input.value).toBe('Launch video');
    fireEvent.change(input, { target: { value: 'Launch video v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename of Launch video' }));

    expect(onRename).toHaveBeenCalledWith('proj-1', 'Launch video v2');
  });

  it('cancels a rename with Escape', () => {
    const onRename = vi.fn();
    renderModal({ projects: [makeProject()], onRename });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Launch video' }));
    fireEvent.keyDown(screen.getByLabelText('New project name'), { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Launch video')).toBeDefined();
  });

  it('requires a second click before deleting', () => {
    const onDelete = vi.fn();
    renderModal({ projects: [makeProject()], onDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Launch video' }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete of Launch video' }));
    expect(onDelete).toHaveBeenCalledWith('proj-1');
  });

  it('shows an error banner whose Retry triggers a refresh', () => {
    const onRefresh = vi.fn();
    renderModal({ error: 'Could not reach the Syncro server. Is it running?', onRefresh });

    expect(screen.getByRole('alert')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('closes via the backdrop and the close button', () => {
    const onClose = vi.fn();
    const { container } = render(<ProjectsModal
      projects={[]} loading={false} error={null} saving={false} canSave={true}
      currentProjectId={null} onClose={onClose} onSave={vi.fn()} onLoad={vi.fn()}
      onRename={vi.fn()} onDelete={vi.fn()} onRefresh={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Close projects' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
