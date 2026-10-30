// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CaptionStyle, ProjectSnapshot } from '../types';
import {
  saveProject,
  listSavedProjects,
  loadSavedProject,
  deleteSavedProject,
} from './savedProjects';

const STORAGE_KEY = 'syncro_saved_projects';

const SNAPSHOT: ProjectSnapshot = {
  clips: [
    {
      id: 'clip-1',
      name: 'intro.mp4',
      duration: 12,
      startTime: 0,
      track: 0,
      transitionIn: 'cut',
    },
  ],
  voiceover: null,
  captionStyle: {
    mode: 'lower-third',
    fontSize: 24,
    color: '#ffffff',
    bgColor: '#000000',
    position: 'bottom',
  } satisfies CaptionStyle,
  captionsEnabled: true,
};

describe('savedProjects store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves a project and lists it newest first as summaries without snapshots', () => {
    saveProject('Older Draft', SNAPSHOT);
    const first = saveProject('Launch Teaser', SNAPSHOT);
    // give the second project a strictly newer updatedAt
    const later = new Date(Date.parse(first.createdAt) + 1000).toISOString();

    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '');
    (raw as { projects: Array<{ updatedAt: string }> }).projects[1].updatedAt = later;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    const summaries = listSavedProjects();
    expect(summaries.map(s => s.name)).toEqual(['Launch Teaser', 'Older Draft']);
    expect(summaries[0]).toEqual({ id: first.id, name: 'Launch Teaser', updatedAt: later });
  });

  it('round-trips the full snapshot through load', () => {
    const saved = saveProject('Launch Teaser', SNAPSHOT);
    expect(loadSavedProject(saved.id)).toEqual(saved);
  });

  it('throws when loading an unknown id', () => {
    expect(() => loadSavedProject('nope')).toThrow('No saved project with id "nope".');
  });

  it('deletes a saved project', () => {
    const saved = saveProject('Launch Teaser', SNAPSHOT);
    deleteSavedProject(saved.id);
    expect(listSavedProjects()).toEqual([]);
    expect(() => loadSavedProject(saved.id)).toThrow();
  });

  it('throws when deleting an id that no longer exists', () => {
    const saved = saveProject('Launch Teaser', SNAPSHOT);
    deleteSavedProject(saved.id);
    expect(() => deleteSavedProject(saved.id)).toThrow('No saved project with id');
  });

  it('throws a descriptive error on corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all');
    expect(() => listSavedProjects()).toThrow('Saved projects storage is corrupt');
  });

  it('throws when storage holds an unexpected shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, projects: [{ id: 1 }] }));
    expect(() => listSavedProjects()).toThrow('unexpected shape');
  });

  it('surfaces quota failures instead of swallowing them', () => {
    saveProject('Launch Teaser', SNAPSHOT);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveProject('Another One', SNAPSHOT)).toThrow('Could not save project');
    vi.restoreAllMocks();
  });
});
