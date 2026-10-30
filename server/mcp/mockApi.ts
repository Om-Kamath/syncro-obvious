import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ProjectRecord } from './apiClient';

export interface MockApi {
  baseUrl: string;
  close(): Promise<void>;
  /** Requests the mock received, for asserting client behavior. */
  readonly requests: Array<{ method: string; path: string }>;
}

const DEFAULT_CAPTION_STYLE = {
  mode: 'lower-third',
  fontSize: 24,
  color: '#ffffff',
  bgColor: '#000000',
  position: 'bottom',
  fontFamily: 'Inter, Arial, sans-serif',
  wordHighlightColor: '#7c3aed',
} as const;

/** Fixture factory for saved-project records matching the REST contract. */
export function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'proj_1',
    name: 'Launch teaser',
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    state: {
      clips: [],
      voiceover: null,
      captionStyle: { ...DEFAULT_CAPTION_STYLE },
      captionsEnabled: false,
    },
    ...overrides,
  };
}

/**
 * Minimal stand-in for the Express projects API (server/projects/*): serves
 * GET /api/projects and GET /api/projects/:id on a random localhost port,
 * with the same error shape (`{ error: string }`) as the real router.
 */
export async function startMockProjectApi(projects: ProjectRecord[]): Promise<MockApi> {
  const requests: MockApi['requests'] = [];
  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    requests.push({ method, path: req.url ?? '/' });

    const notFound = (message: string): void => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };

    if (method !== 'GET') {
      notFound('Method not supported by the mock API');
      return;
    }
    if (req.url === '/api/projects') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(projects));
      return;
    }
    const match = /^\/api\/projects\/([^/]+)$/.exec(req.url ?? '');
    if (match) {
      const id = decodeURIComponent(match[1] ?? '');
      const project = projects.find((p) => p.id === id);
      if (!project) {
        notFound(`Project not found: ${id}`);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(project));
      return;
    }
    notFound('Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
