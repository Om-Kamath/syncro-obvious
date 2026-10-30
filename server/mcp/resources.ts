import {
  ErrorCode,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Resource,
  type ResourceTemplate,
  type TextResourceContents,
} from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ProjectReader } from './projectStore';

/** Collection resource: one URI listing every saved project as summaries. */
export const PROJECT_LIST_URI = 'syncro://projects';
/** Prefix for single-project URIs; `{projectId}` templates as `syncro://projects/{projectId}`. */
export const PROJECT_URI_PREFIX = 'syncro://projects/';

const MIME_JSON = 'application/json';

/** URI for a single saved project. Ids are percent-encoded so the id never contributes a path separator. */
export function projectUri(id: string): string {
  return `${PROJECT_URI_PREFIX}${encodeURIComponent(id)}`;
}

/**
 * Resource descriptors returned from `resources/list`: the collection plus one
 * entry per saved project. Rebuilt on every call, so agents always see the
 * store's current contents.
 */
export function buildProjectResources(store: ProjectReader): Resource[] {
  const projects = store.list();
  return [
    {
      uri: PROJECT_LIST_URI,
      name: 'Saved projects',
      description: `All ${projects.length} saved Syncro project(s) as a JSON array of summaries (id, name, timestamps).`,
      mimeType: MIME_JSON,
    },
    ...projects.map((project) => ({
      uri: projectUri(project.id),
      name: project.name,
      description: `Saved project "${project.name}" (created ${project.createdAt}).`,
      mimeType: MIME_JSON,
    })),
  ];
}

/** Template descriptor returned from `resources/templates/list`. */
export function getProjectResourceTemplate(): ResourceTemplate {
  return {
    uriTemplate: `${PROJECT_URI_PREFIX}{projectId}`,
    name: 'Saved project',
    description: 'A single saved Syncro project by id: full record including its state as JSON.',
    mimeType: MIME_JSON,
  };
}

function textContents(uri: string, text: string): TextResourceContents {
  return { uri, mimeType: MIME_JSON, text };
}

/** Collection read: summaries only, no state — listing N projects stays cheap. */
export function buildProjectSummaries(store: ProjectReader): TextResourceContents {
  const summaries = store.list().map(({ id, name, createdAt, updatedAt }) => ({
    id,
    name,
    createdAt,
    updatedAt,
  }));
  return textContents(PROJECT_LIST_URI, JSON.stringify(summaries, null, 2));
}

/** Read the collection or a single project; unknown URIs/ids surface as protocol errors. */
export function readProjectResource(store: ProjectReader, uri: string): TextResourceContents {
  if (uri === PROJECT_LIST_URI) return buildProjectSummaries(store);
  if (!uri.startsWith(PROJECT_URI_PREFIX)) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  }
  const id = decodeURIComponent(uri.slice(PROJECT_URI_PREFIX.length));
  const project = store.get(id);
  if (!project) throw new McpError(ErrorCode.InvalidRequest, `Unknown project: ${id}`);
  return textContents(uri, JSON.stringify(project, null, 2));
}

/** Wire the saved-project resources onto an MCP server. */
export function registerProjectResources(server: Server, store: ProjectReader): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: buildProjectResources(store),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [getProjectResourceTemplate()],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
    contents: [readProjectResource(store, request.params.uri)],
  }));
}
