/**
 * `trigger_export` — MCP tool that enqueues a server-side export job for a
 * saved project and reports the new job id.
 *
 * Ships as tool metadata (name, description, JSON-schema input) plus a pure
 * handler over the ExportJobStore, so the MCP server binds them at
 * registration time:
 *
 *   server.tool(triggerExportToolName, triggerExportInputSchema,
 *     (args) => handleTriggerExport(store, args));
 */
import { EXPORT_PRESETS, type ExportPresetId } from '../utils/exportPresets';
import {
  DEFAULT_EXPORT_QUALITY,
  EXPORT_QUALITIES,
  type ExportJobStore,
  type ExportQuality,
} from './exportJobQueue';

export const TRIGGER_EXPORT_TOOL_NAME = 'trigger_export';

export const TRIGGER_EXPORT_TOOL_DESCRIPTION =
  'Enqueue a server-side export job for a saved Syncro project. ' +
  'Returns the new job id and its initial queued status.';

interface JsonSchemaProperty {
  type: 'string';
  description: string;
  enum?: readonly string[];
  minLength?: number;
}

interface JsonSchemaObject {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

/** JSON Schema advertised to MCP clients. The preset enum derives from EXPORT_PRESETS so the two cannot drift. */
export const triggerExportInputSchema: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: {
      type: 'string',
      minLength: 1,
      description: 'Id of the saved project to export.',
    },
    preset: {
      type: 'string',
      enum: Object.keys(EXPORT_PRESETS),
      description: 'Aspect preset for the export canvas: wide=16:9, vertical=9:16, square=1:1.',
    },
    quality: {
      type: 'string',
      enum: [...EXPORT_QUALITIES],
      description: `Render quality tier. Defaults to ${DEFAULT_EXPORT_QUALITY} when omitted.`,
    },
  },
  required: ['projectId', 'preset'],
};

export interface TriggerExportArgs {
  projectId: string;
  preset: ExportPresetId;
  quality: ExportQuality;
}

export type ParsedTriggerExportArgs =
  | { ok: true; args: TriggerExportArgs }
  | { ok: false; error: string };

export type TriggerExportResult =
  | { ok: true; jobId: string; status: 'queued' }
  | { ok: false; error: string };

function isExportPresetId(value: string): value is ExportPresetId {
  return value in EXPORT_PRESETS;
}

function isExportQuality(value: string): value is ExportQuality {
  return (EXPORT_QUALITIES as readonly string[]).includes(value);
}

/** Validate raw MCP tool arguments against the tool's own contract. */
export function parseTriggerExportArgs(input: unknown): ParsedTriggerExportArgs {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'trigger_export arguments must be an object.' };
  }
  const { projectId, preset, quality } = input as Record<string, unknown>;

  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return { ok: false, error: 'projectId must be a non-empty string.' };
  }
  if (typeof preset !== 'string' || !isExportPresetId(preset)) {
    return { ok: false, error: `Unknown preset. Valid presets: ${Object.keys(EXPORT_PRESETS).join(', ')}.` };
  }
  let resolvedQuality: ExportQuality = DEFAULT_EXPORT_QUALITY;
  if (quality !== undefined) {
    if (typeof quality !== 'string' || !isExportQuality(quality)) {
      return { ok: false, error: `quality must be one of: ${EXPORT_QUALITIES.join(', ')}.` };
    }
    resolvedQuality = quality;
  }
  return { ok: true, args: { projectId, preset, quality: resolvedQuality } };
}

/** Tool handler: validate, enqueue, report the job id. */
export function handleTriggerExport(store: ExportJobStore, input: unknown): TriggerExportResult {
  const parsed = parseTriggerExportArgs(input);
  if (!parsed.ok) return parsed;
  const job = store.enqueue(parsed.args);
  return { ok: true, jobId: job.id, status: 'queued' };
}
