import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { projectUri, PROJECT_LIST_URI, PROJECT_URI_PREFIX } from './resources';
import { createSyncroMcpServer } from './server';
import { InMemoryProjectStore, type ProjectReader, type StoredProject } from './projectStore';

function makeProject(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    id: 'proj-1',
    name: 'Launch teaser',
    state: {
      clips: [{ id: 'clip-1', name: 'intro.mp4', startTime: 0, duration: 12.5 }],
      voiceover: null,
      captionStyle: { mode: 'word-highlight', fontSize: 24 },
      captionsEnabled: true,
    },
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T11:00:00.000Z',
    ...overrides,
  };
}

/**
 * Connect a real MCP client to a fresh server over an in-memory transport, so
 * every listing/read assertion exercises the actual wire protocol.
 */
async function connectProjectClient(store: ProjectReader): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createSyncroMcpServer(store);
  const client = new Client({ name: 'vitest-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Every resource this server serves is JSON text; narrow the contents union accordingly. */
function readText(contents: ReadResourceResult['contents'], index = 0): string {
  const item = contents[index];
  if (!('text' in item)) throw new Error(`Expected text contents at index ${index}`);
  return item.text;
}

describe('syncro MCP server — saved project resources', () => {
  let close = async (): Promise<void> => {};
  afterEach(async () => {
    await close();
    close = async (): Promise<void> => {};
  });

  it('lists the collection resource plus one entry per saved project', async () => {
    const store = new InMemoryProjectStore([
      makeProject(),
      makeProject({ id: 'proj-2', name: 'Podcast clip', updatedAt: '2026-10-30T12:00:00.000Z' }),
    ]);
    const connected = await connectProjectClient(store);
    close = connected.close;

    const { resources } = await connected.client.listResources();

    // Collection first, then per-project entries, most recently updated first.
    expect(resources.map((r) => r.uri)).toEqual([
      PROJECT_LIST_URI,
      projectUri('proj-2'),
      projectUri('proj-1'),
    ]);
    expect(resources[0]).toMatchObject({
      uri: PROJECT_LIST_URI,
      name: 'Saved projects',
      mimeType: 'application/json',
    });
    expect(resources[0].description).toContain('2 saved Syncro project(s)');
    expect(resources[1]).toMatchObject({
      uri: 'syncro://projects/proj-2',
      name: 'Podcast clip',
      mimeType: 'application/json',
    });
    expect(resources[2].name).toBe('Launch teaser');
  });

  it('lists only the collection when the store is empty', async () => {
    const connected = await connectProjectClient(new InMemoryProjectStore());
    close = connected.close;

    const { resources } = await connected.client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe(PROJECT_LIST_URI);
  });

  it('advertises the single-project URI template', async () => {
    const connected = await connectProjectClient(new InMemoryProjectStore());
    close = connected.close;

    const { resourceTemplates } = await connected.client.listResourceTemplates();
    expect(resourceTemplates).toHaveLength(1);
    expect(resourceTemplates[0]).toMatchObject({
      uriTemplate: `${PROJECT_URI_PREFIX}{projectId}`,
      name: 'Saved project',
      mimeType: 'application/json',
    });
  });

  it('reads the collection as a JSON array of summaries without state', async () => {
    const store = new InMemoryProjectStore([
      makeProject(),
      makeProject({ id: 'proj-2', name: 'Podcast clip', updatedAt: '2026-10-30T12:00:00.000Z' }),
    ]);
    const connected = await connectProjectClient(store);
    close = connected.close;

    const { contents } = await connected.client.readResource({ uri: PROJECT_LIST_URI });
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ uri: PROJECT_LIST_URI, mimeType: 'application/json' });
    const summaries = JSON.parse(readText(contents)) as Array<Record<string, unknown>>;
    expect(summaries).toEqual([
      {
        id: 'proj-2',
        name: 'Podcast clip',
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T12:00:00.000Z',
      },
      {
        id: 'proj-1',
        name: 'Launch teaser',
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T11:00:00.000Z',
      },
    ]);
  });

  it('reads a single project as the full record including state', async () => {
    const project = makeProject();
    const connected = await connectProjectClient(new InMemoryProjectStore([project]));
    close = connected.close;

    const { contents } = await connected.client.readResource({ uri: projectUri('proj-1') });
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({ uri: projectUri('proj-1'), mimeType: 'application/json' });
    expect(JSON.parse(readText(contents))).toEqual(project);
  });

  it('reads a project whose id contains special characters', async () => {
    const project = makeProject({ id: 'proj/with spaces&chars' });
    const connected = await connectProjectClient(new InMemoryProjectStore([project]));
    close = connected.close;

    const { contents } = await connected.client.readResource({ uri: projectUri(project.id) });
    expect(JSON.parse(readText(contents))).toEqual(project);
  });

  it('rejects reads of unknown projects with a protocol error', async () => {
    const connected = await connectProjectClient(new InMemoryProjectStore([makeProject()]));
    close = connected.close;

    await expect(
      connected.client.readResource({ uri: projectUri('proj-404') }),
    ).rejects.toThrow(/Unknown project: proj-404/);
  });

  it('rejects reads of unknown resource URIs', async () => {
    const connected = await connectProjectClient(new InMemoryProjectStore());
    close = connected.close;

    await expect(
      connected.client.readResource({ uri: 'syncro://media' }),
    ).rejects.toThrow(/Unknown resource/);
  });
});
