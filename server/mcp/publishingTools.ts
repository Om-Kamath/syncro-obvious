import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GenerateFn } from './gemini';
import { generateDescriptionHandler, generateDescriptionInputSchema } from './tools/generateDescription';
import { exportCaptionsHandler, exportCaptionsInputSchema } from './tools/exportCaptions';
import { generateThumbnailsHandler, generateThumbnailsInputSchema } from './tools/generateThumbnails';

/** Lazy Gemini transport: built on first use so a media-only MCP server runs without GEMINI_API_KEY. */
export interface PublishingToolDeps {
  generate: () => GenerateFn;
}

/**
 * Registers the publishing tools (generate_description, generate_thumbnails,
 * export_captions) on the shared Syncro MCP server. Generation tools call
 * Gemini server-side; export_captions is a pure serializer.
 */
export function registerPublishingTools(server: McpServer, deps: PublishingToolDeps): void {
  server.registerTool(
    'generate_description',
    {
      title: 'Generate video description',
      description:
        'Generate a YouTube-style description (summary, chapter timestamps, hashtags) from a voiceover transcription',
      inputSchema: generateDescriptionInputSchema,
    },
    (args) => generateDescriptionHandler(args, deps.generate()),
  );

  server.registerTool(
    'generate_thumbnails',
    {
      title: 'Generate thumbnail key moments',
      description:
        'Identify the 4-5 most compelling key moments (timestamp, quote, reason) for video thumbnails',
      inputSchema: generateThumbnailsInputSchema,
    },
    (args) => generateThumbnailsHandler(args, deps.generate()),
  );

  server.registerTool(
    'export_captions',
    {
      title: 'Export captions',
      description: 'Serialize timed caption segments into an SRT or VTT subtitle file',
      inputSchema: exportCaptionsInputSchema,
    },
    (args) => exportCaptionsHandler(args),
  );
}
