import { z } from "zod";
import { Type } from "@google/genai";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MODELS } from "../../../src/services/models";
import { parseModelJson } from "../../../src/services/postProcessing";
import { normalizeErrorMessage } from "../../../src/services/geminiClient";
import type { GenerateFn } from "../gemini";
import { captionSegmentSchema } from "./shared";
import { errorResult, jsonResult } from "../results";

/**
 * generate_thumbnails — identifies the most compelling key moments for
 * thumbnail text and framing. Mirrors the UI path in
 * src/services/postProcessing.ts (identifyKeyMoments) but runs server-side.
 * Returns the key moments (timestamp + quote + reason); rendering actual
 * thumbnail images stays client-side, where the video frames live.
 */

export interface KeyMoment {
  timestamp: number;
  quote: string;
  reason: string;
}

export const KEY_MOMENTS_RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      timestamp: { type: Type.NUMBER },
      quote: { type: Type.STRING },
      reason: { type: Type.STRING },
    },
    required: ["timestamp", "quote", "reason"],
  },
} as const;

export function buildKeyMomentsPrompt(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): string {
  return `Analyze this video and identify the 4-5 most emotionally charged, surprising, or compelling moments that would make great video thumbnails for click-through on YouTube or social media.

Full transcription: "${transcription}"

Timed segments: ${JSON.stringify(segments)}

Video content: ${videoAnalyses.join(" | ")}

For each moment provide:
- The exact timestamp in seconds (must be within the segment times above)
- A short punchy quote or label (max 7 words) suitable as thumbnail text
- Why this moment is visually and emotionally compelling for a thumbnail`;
}

export const generateThumbnailsInputSchema = {
  transcription: z.string().describe("Full voiceover transcription text"),
  segments: z
    .array(captionSegmentSchema)
    .default([])
    .describe("Timed transcript segments in seconds"),
  videoAnalyses: z
    .array(z.string())
    .default([])
    .describe("Short descriptions of what each video clip shows"),
};

export type GenerateThumbnailsArgs = {
  transcription: string;
  segments: Array<{ text: string; start: number; end: number }>;
  videoAnalyses: string[];
};

export async function generateThumbnailsHandler(
  args: GenerateThumbnailsArgs,
  generate: GenerateFn
): Promise<CallToolResult> {
  try {
    const response = await generate({
      model: MODELS.flash,
      contents: buildKeyMomentsPrompt(args.transcription, args.segments, args.videoAnalyses),
      config: {
        responseMimeType: "application/json",
        responseSchema: KEY_MOMENTS_RESPONSE_SCHEMA,
      },
    });
    const keyMoments = parseModelJson<KeyMoment[]>(
      response.text,
      "Thumbnail key-moment identification"
    );
    return jsonResult({ keyMoments });
  } catch (err) {
    return errorResult(normalizeErrorMessage(err));
  }
}
