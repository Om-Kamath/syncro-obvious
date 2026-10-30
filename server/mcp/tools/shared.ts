import { z } from "zod";

/**
 * Shared zod shapes for the Syncro MCP publish tools. Result helpers live in
 * `server/mcp/results.ts` (the module shared by every tool family).
 */

export const captionSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export type CaptionSegmentArgs = z.infer<typeof captionSegmentSchema>;
