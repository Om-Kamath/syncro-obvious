import { Server } from '@modelcontextprotocol/sdk/server';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server';
import { ProjectApiError } from './projectApi';
import type { ProjectsApi } from './projectApi';
import { ValidationError, parseProjectId, parseProjectPayload } from './validation';

const TOOL_NAMES = ['create_project', 'update_project', 'delete_project'] as const;
type ToolName = (typeof TOOL_NAMES)[number];

/**
 * JSON Schema for a full serialized ProjectState. Declared for MCP clients
 * (what the agent sees); enforcement lives in `validation.ts`, which produces
 * the path-precise error messages. Unknown keys are allowed here because the
 * validator whitelist-drops them, mirroring the API.
 */
const projectStateSchema = {
  type: 'object',
  description: 'Serialized editor state to save with the project.',
  properties: {
    clips: {
      type: 'array',
      description: 'Timeline clips in array order (order is the source of truth for the timeline).',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          duration: { type: 'number', minimum: 0, description: 'Original file duration in seconds.' },
          startTime: { type: 'number', minimum: 0, description: 'Start time in the overall timeline.' },
          trimmedDuration: { type: 'number', minimum: 0 },
          trimStart: { type: 'number', minimum: 0 },
          textOverlay: { type: 'string' },
          track: { type: 'integer', minimum: 0 },
          transitionIn: { enum: ['cut', 'fade', 'dissolve', 'wipe'] },
          analysis: { type: 'string' },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                reason: { type: 'string' },
              },
              required: ['id', 'confidence', 'reason'],
            },
          },
        },
        required: ['id', 'name', 'duration', 'startTime'],
      },
    },
    voiceover: {
      description: 'Null (or omitted) when the project has no voiceover yet.',
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            duration: { type: 'number', minimum: 0 },
            trimStart: { type: 'number', minimum: 0 },
            trimEnd: { type: 'number', minimum: 0 },
            transcription: { type: 'string' },
            segments: {
              type: 'array',
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number', minimum: 0 } },
                required: ['text', 'start', 'end'],
              },
            },
            startTime: { type: 'number', minimum: 0 },
          },
          required: ['duration'],
        },
      ],
    },
    captionStyle: {
      type: 'object',
      properties: {
        mode: { enum: ['lower-third', 'word-highlight', 'speaker-labeled'] },
        fontSize: { type: 'number', exclusiveMinimum: 0 },
        color: { type: 'string' },
        bgColor: { type: 'string' },
        position: { enum: ['bottom', 'top'] },
      },
      required: ['mode', 'fontSize', 'color', 'bgColor', 'position'],
    },
    captionsEnabled: { type: 'boolean' },
  },
  required: ['clips', 'captionStyle', 'captionsEnabled'],
  additionalProperties: true,
} as const;

const TOOL_DEFS: Array<{ name: ToolName; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: 'create_project',
    description:
      'Create a saved Syncro project. Takes a project name and the full serialized editor state (clips, voiceover, caption style). Returns the stored record with its id and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name shown in the saved-projects list.' },
        state: projectStateSchema,
      },
      required: ['name', 'state'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_project',
    description:
      'Replace a saved Syncro project wholesale (name + full state — PUT semantics, not a patch). Returns the updated record. Fails with a not-found error for unknown ids.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id of the project to update, as returned by create_project or list_projects.' },
        name: { type: 'string', description: 'New project name.' },
        state: projectStateSchema,
      },
      required: ['id', 'name', 'state'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_project',
    description: 'Permanently delete a saved Syncro project by id. Returns the deleted id. Fails with a not-found error for unknown ids.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id of the project to delete.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

function successResult(record: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(record, null, 2) }],
    structuredContent: record,
  };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function errorResultFrom(error: unknown): CallToolResult {
  if (error instanceof ValidationError) {
    return errorResult(`Invalid arguments: ${error.message}`);
  }
  if (error instanceof ProjectApiError) {
    switch (error.kind) {
      case 'validation':
        return errorResult(`Invalid arguments: ${error.message}`);
      case 'notFound':
        return errorResult(error.message);
      case 'unavailable':
        return errorResult(`Syncro API unavailable: ${error.message}`);
      case 'unexpected':
        return errorResult(`Syncro API error: ${error.message}`);
    }
  }
  return errorResult(`Unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Build the Syncro MCP server exposing the project mutation tools
 * (`create_project`, `update_project`, `delete_project`) over the given API.
 * Transport-free by design: `index.ts` wires stdio, tests use an in-memory pair.
 */
export function buildSyncroMcpServer(api: ProjectsApi): McpServer {
  const server = new Server({ name: 'syncro-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'create_project': {
          const payload = parseProjectPayload(args);
          return successResult(await api.create(payload));
        }
        case 'update_project': {
          const id = parseProjectId(args?.id);
          const payload = parseProjectPayload(args);
          return successResult(await api.update(id, payload));
        }
        case 'delete_project': {
          const id = parseProjectId(args?.id);
          await api.remove(id);
          return successResult({ id, deleted: true });
        }
        default:
          return errorResult(`Unknown tool: ${name}. Available tools: ${TOOL_NAMES.join(', ')}`);
      }
    } catch (error) {
      return errorResultFrom(error);
    }
  });

  return server;
}
