import { ProjectSnapshot, SavedProject, SavedProjectSummary } from '../types';

// Client-side saved-projects store over localStorage. The server-backed
// projects API lives behind open PRs; this stand-in keeps the UI slice
// independently mergeable — swap the read/write helpers when the API lands.

const STORAGE_KEY = 'syncro_saved_projects';
const SCHEMA_VERSION = 1;

interface SavedProjectsFile {
  version: number;
  projects: SavedProject[];
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `proj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isProject(value: unknown): value is SavedProject {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.createdAt === 'string' &&
    typeof p.updatedAt === 'string' &&
    typeof p.snapshot === 'object' &&
    p.snapshot !== null
  );
}

// Storage may hold data written by an older or newer schema version — validate
// the envelope before trusting it instead of handing back malformed objects.
function isProjectsFile(value: unknown): value is SavedProjectsFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.version === 'number' &&
    Array.isArray(file.projects) &&
    file.projects.every(isProject)
  );
}

function readStore(): SavedProject[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved projects storage is corrupt — expected JSON.');
  }
  if (!isProjectsFile(parsed)) {
    throw new Error('Saved projects storage has an unexpected shape.');
  }
  return parsed.projects;
}

function writeStore(projects: SavedProject[]): void {
  const file: SavedProjectsFile = { version: SCHEMA_VERSION, projects };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch (err) {
    throw new Error('Could not save project: storage write failed.', { cause: err });
  }
}

export function saveProject(name: string, snapshot: ProjectSnapshot): SavedProject {
  const now = new Date().toISOString();
  const project: SavedProject = { id: makeId(), name, createdAt: now, updatedAt: now, snapshot };
  writeStore([...readStore(), project]);
  return project;
}

export function listSavedProjects(): SavedProjectSummary[] {
  return readStore()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
}

export function loadSavedProject(id: string): SavedProject {
  const project = readStore().find(p => p.id === id);
  if (!project) {
    throw new Error(`No saved project with id "${id}".`);
  }
  return project;
}

export function deleteSavedProject(id: string): void {
  const projects = readStore();
  if (!projects.some(p => p.id === id)) {
    throw new Error(`No saved project with id "${id}".`);
  }
  writeStore(projects.filter(p => p.id !== id));
}
