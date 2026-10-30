import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { generateSRT, generateVTT } from "../../../src/utils/captionUtils";
import { captionSegmentSchema } from "./shared";
import { errorResult, jsonResult } from "../results";

/**
 * export_captions — serializes timed caption segments into an SRT or VTT
 * subtitle file, exactly as the UI's Captions/Export tabs download them.
 * Pure serialization: no Gemini call is involved.
 */

export const exportCaptionsInputSchema = {
  segments: z
    .array(captionSegmentSchema)
    .describe("Timed caption segments in seconds"),
  format: z
    .enum(["srt", "vtt"])
    .default("srt")
    .describe("Subtitle format to emit"),
};

export type ExportCaptionsArgs = {
  segments: Array<{ text: string; start: number; end: number }>;
  format: "srt" | "vtt";
};

export function exportCaptionsHandler(args: ExportCaptionsArgs): CallToolResult {
  try {
    const content = args.format === "vtt" ? generateVTT(args.segments) : generateSRT(args.segments);
    const extension = args.format === "vtt" ? "vtt" : "srt";
    return jsonResult({
      format: args.format,
      filename: `captions.${extension}`,
      content,
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
