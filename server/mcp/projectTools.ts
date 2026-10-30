import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SyncroApiClient } from './apiClient';
import { jsonResult, toErrorResult } from './results';
import { normalizeProjectName, normalizeProjectState } from './validation';

const GetProjectArgs = z.object({
  id: z.string().min(1).describe('Project id, as reported by list_projects.'),
});

const CreateProjectArgs = z.object({
  name: z.string().describe('Project name shown in the saved-projects list.'),
  state: z
    .record(z.string(), z.unknown())
    .describe('Serialized editor state to save with the project (clips, voiceover, captionStyle, captionsEnabled).'),
});

const UpdateProjectArgs = z.object({
  id: z.string().min(1).describe('Id of the project to update, as returned by create_project or get_project.'),
  name: z.string().describe('New project name.'),
  state: z
    .record(z.string(), z.unknown())
    .describe('Serialized editor state to save with the project (replaces the existing state).'),
});

const DeleteProjectArgs = z.object({
  id: z.string().min(1).describe('Id of the project to delete, as reported by list_projects.'),
});

/**
 * Register the project tools on the shared Syncro MCP server: the read-only
 * `list_projects` and `get_project` (spec PR 30) plus the mutations
 * `create_project`, `update_project`, and `delete_project` (spec PR 31).
 *
 * Update is a full replace (name + state — PUT semantics, not a patch),
 * matching the wire contract in `src/services/projectApi.ts`. State payloads
 * are deep-validated locally (`./validation`) before any HTTP call; expected
 * failures funnel through `toErrorResult` — errors are data for the calling
 * agent, never protocol faults.
 */
export function registerProjectTools(server: McpServer, apiClient: SyncroApiClient): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List saved projects',
      description: 'List all saved Syncro projects (id, name, timestamps), most recently updated first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return jsonResult(await apiClient.listProjects());
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get saved project',
      description:
        'Get one saved Syncro project by id, including its full editor state (clips, voiceover, captions).',
      inputSchema: GetProjectArgs.shape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await apiClient.getProject(args.id));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a saved Syncro project. Takes a project name and the full serialized editor state ' +
        '(clips, voiceover, caption style). Returns the stored record with its id and timestamps.',
      inputSchema: CreateProjectArgs.shape,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        const name = normalizeProjectName(args.name);
        const state = normalizeProjectState(args.state);
        return jsonResult(await apiClient.createProject({ name, state }));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'update_project',
    {
      title: 'Update project',
      description:
        'Replace a saved Syncro project wholesale (name + full state — PUT semantics, not a patch). ' +
        'Returns the updated record. Fails with a not-found error for unknown ids.',
      inputSchema: UpdateProjectArgs.shape,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        const id = normalizeProjectName(args.id, 'id');
        const name = normalizeProjectName(args.name);
        const state = normalizeProjectState(args.state);
        return jsonResult(await apiClient.updateProject(id, { name, state }));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description:
        'Permanently delete a saved Syncro project by id. There is no undo. ' +
        'Fails with a not-found error for unknown ids.',
      inputSchema: DeleteProjectArgs.shape,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        const id = normalizeProjectName(args.id, 'id');
        await apiClient.deleteProject(id);
        return jsonResult({ id, deleted: true });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
