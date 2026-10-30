/**
 * `get_timeline` — MCP tool that reads back a saved project's timeline: the
 * ordered clip list with chained start times, effective (post-trim) and source
 * durations, track layers, total timeline duration, and the persisted playhead
 * position. Read-only — it never mutates the project.
 *
 * Ships as tool metadata (name, description, JSON-schema input) plus a pure
 * handler over the ProjectStore, so the MCP server binds them at registration
 * time:
 *
 *   server.tool(getTimelineToolName, getTimelineInputSchema,
 *     (args) => handleGetTimeline(store, args));
 */
import type { ProjectStore } from './projectStore';
import { buildTimelineSnapshot } from './timeline';

export const GET_TIMELINE_TOOL_NAME = 'get_timeline';

export const GET_TIMELINE_TOOL_DESCRIPTION =
  'Read back a saved project timeline: the ordered clip list with chained start times, ' +
  'effective (post-trim) and source durations, track layer, total timeline duration, and ' +
  'the persisted playhead position. Read-only — it never mutates the project.';

interface JsonSchemaProperty {
  type: 'string';
  description: string;
  minLength?: number;
}

interface JsonSchemaObject {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

/** JSON Schema advertised to MCP clients. */
export const getTimelineInputSchema: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: {
      type: 'string',
      minLength: 1,
      description: 'Id of the saved project to inspect.',
    },
  },
  required: ['projectId'],
};

export interface GetTimelineArgs {
  projectId: string;
}

export type ParsedGetTimelineArgs =
  | { ok: true; args: GetTimelineArgs }
  | { ok: false; error: string };

export type GetTimelineResult =
  | { ok: true; timeline: ReturnType<typeof buildTimelineSnapshot> }
  | { ok: false; error: string };

/** Validate raw MCP tool arguments against the tool's own contract. */
export function parseGetTimelineArgs(input: unknown): ParsedGetTimelineArgs {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'get_timeline arguments must be an object.' };
  }
  const { projectId } = input as Record<string, unknown>;

  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return { ok: false, error: 'projectId must be a non-empty string.' };
  }
  return { ok: true, args: { projectId: projectId.trim() } };
}

/** Tool handler: validate, resolve the project, serialize the timeline. */
export async function handleGetTimeline(store: ProjectStore, input: unknown): Promise<GetTimelineResult> {
  const parsed = parseGetTimelineArgs(input);
  // Literal-equality narrowing: the project compiles without `strict`, and non-strict
  // tsc does not narrow discriminated unions through `!parsed.ok` in this branch.
  if (parsed.ok === false) return parsed;

  const project = await store.getProject(parsed.args.projectId);
  if (!project) {
    return { ok: false, error: `Project not found: ${parsed.args.projectId}` };
  }
  return { ok: true, timeline: buildTimelineSnapshot(project) };
}
