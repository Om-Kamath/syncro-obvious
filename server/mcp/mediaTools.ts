import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  SyncroApiClient,
  guessMimeFromFilename,
  type MediaAsset,
  type SerializedClip,
  type SerializedVoiceover,
} from './apiClient';
import { registerProjectTools } from './projectTools';
import { ToolFailure, errorResult, jsonResult, toErrorResult } from './results';

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Parse a byte-limit from env (`SYNCRO_MCP_MAX_UPLOAD_BYTES`).
 * Returns null when the value is missing or not a positive integer, so the
 * caller can warn and fall back to the default instead of failing silently.
 */
export function parseMaxUploadBytes(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Strict base64: rejects whitespace-only input and malformed padding instead of silently decoding garbage. */
function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, '');
  const valid = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/.test(compact);
  if (compact.length === 0 || !valid) {
    throw new ToolFailure('`bytes` is not valid base64.');
  }
  return new Uint8Array(Buffer.from(compact, 'base64'));
}

async function readMediaFile(path: string, maxUploadBytes: number): Promise<Uint8Array> {
  let fileSize: number;
  try {
    fileSize = (await stat(path)).size;
  } catch {
    throw new ToolFailure(`File not readable: ${path}`);
  }
  if (fileSize > maxUploadBytes) {
    throw new ToolFailure(`Media too large: ${fileSize} bytes exceeds the ${maxUploadBytes}-byte upload limit.`);
  }
  return new Uint8Array(await readFile(path));
}

/** End of the current timeline — where a newly attached clip chains to by default. */
function timelineEnd(clips: SerializedClip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clip.startTime + (clip.trimmedDuration ?? clip.duration)), 0);
}

export interface SyncroMcpOptions {
  apiClient: SyncroApiClient;
  maxUploadBytes: number;
}

/**
 * Build the Syncro MCP server: read-only project tools (list_projects,
 * get_project) plus the media tools (upload_media, attach_media).
 *
 * Tests drive it through an in-memory client, so no stdio or HTTP listener
 * is involved.
 */
export function createSyncroMcpServer(options: SyncroMcpOptions): McpServer {
  const { apiClient, maxUploadBytes } = options;

  const server = new McpServer(
    { name: 'syncro-mcp', version: '0.1.0' },
    {
      instructions:
        'Tools for driving the Syncro video editor: list and read saved projects, upload media to the Syncro server, and attach uploaded media to saved projects as timeline clips or the voiceover. ' +
        'Requires the Syncro server to be running (default http://localhost:3001).',
    },
  );

  server.registerTool(
    'upload_media',
    {
      title: 'Upload media',
      description:
        'Upload a media file to the Syncro server (POST /api/media). Provide either a local file `path` or raw `bytes` (base64). ' +
        'Returns the media id and URL to use with attach_media. Fails cleanly when the file exceeds the configured maximum upload size.',
      inputSchema: {
        path: z.string().describe('Local filesystem path of the media file. Mutually exclusive with `bytes`.').optional(),
        bytes: z.string().describe('Raw file contents as base64. Mutually exclusive with `path`.').optional(),
        filename: z.string().describe('Filename for the upload; defaults to the basename of `path`.').optional(),
        contentType: z
          .string()
          .describe('MIME type; guessed from the filename when omitted (falls back to application/octet-stream).')
          .optional(),
      },
    },
    async (args) => {
      if (args.path !== undefined && args.bytes !== undefined) {
        return errorResult('Provide exactly one of `path` or `bytes`.');
      }
      try {
        let bytes: Uint8Array;
        let filename = args.filename;
        if (args.path !== undefined) {
          bytes = await readMediaFile(args.path, maxUploadBytes);
          filename ??= basename(args.path);
        } else if (args.bytes !== undefined) {
          bytes = decodeBase64(args.bytes);
        } else {
          return errorResult('Provide exactly one of `path` or `bytes`.');
        }
        if (bytes.byteLength > maxUploadBytes) {
          throw new ToolFailure(
            `Media too large: ${bytes.byteLength} bytes exceeds the ${maxUploadBytes}-byte upload limit.`,
          );
        }
        const asset: MediaAsset = await apiClient.uploadMedia({
          bytes,
          filename,
          contentType: args.contentType ?? guessMimeFromFilename(filename),
        });
        return jsonResult({ ok: true, ...asset });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'attach_media',
    {
      title: 'Attach media to project',
      description:
        'Attach an uploaded media asset to a saved Syncro project: as a timeline `clip` (chained to the end of the timeline by default) ' +
        'or as the project `voiceover`. Reads the project via GET /api/projects/:id and saves the updated state via PUT.',
      inputSchema: {
        projectId: z.string().describe('Id of the saved project to update.'),
        mediaId: z.string().describe('Media id returned by upload_media.'),
        target: z.enum(['clip', 'voiceover']).describe('Attach as a timeline clip or as the project voiceover.'),
        duration: z.number().positive().describe('Media duration in seconds (required; the server cannot probe it from bytes).'),
        name: z.string().describe('Clip name; defaults to the media filename or the media id.').optional(),
        startTime: z.number().min(0).describe('Timeline start in seconds; defaults to the end of the current timeline.').optional(),
        track: z.number().int().min(0).describe('Video track layer (0 = default).').optional(),
        transcription: z.string().describe('Transcription text to store on the voiceover (target=voiceover only).').optional(),
      },
    },
    async (args) => {
      try {
        const project = await apiClient.getProject(args.projectId);
        const state = { ...project.state };
        let attached: Record<string, unknown>;
        if (args.target === 'clip') {
          const clip: SerializedClip = {
            id: randomUUID(),
            name: args.name ?? `media-${args.mediaId}`,
            duration: args.duration,
            startTime: args.startTime ?? timelineEnd(project.state.clips),
          };
          if (args.track !== undefined) clip.track = args.track;
          state.clips = [...project.state.clips, clip];
          attached = { target: 'clip', clip };
        } else {
          const voiceover: SerializedVoiceover = { duration: args.duration };
          if (args.transcription !== undefined) voiceover.transcription = args.transcription;
          state.voiceover = voiceover;
          attached = { target: 'voiceover', voiceover };
        }
        const updated = await apiClient.updateProject(project.id, { name: project.name, state });
        return jsonResult({
          ok: true,
          project: { id: updated.id, name: updated.name },
          mediaId: args.mediaId,
          ...attached,
          clipCount: state.clips.length,
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  registerProjectTools(server, apiClient);

  return server;
}
