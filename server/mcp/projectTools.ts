import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SyncroApiClient } from './apiClient';
import { jsonResult, toErrorResult } from './results';

const GetProjectArgs = z.object({
  id: z.string().min(1).describe('Project id, as reported by list_projects.'),
});

/**
 * Register the read-only project tools on the shared Syncro MCP server
 * (spec PR 30): list and read saved projects without the UI. Handlers funnel
 * every failure through `toErrorResult` — expected errors are data for the
 * calling agent, never protocol faults.
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
}
