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
 * generate_description — YouTube-style description, chapters, and hashtags from
 * a voiceover transcription. Mirrors the UI path in
 * src/services/postProcessing.ts (generateDescription) but runs server-side:
 * the Gemini key comes from the environment and results reach the agent as
 * JSON. Keep the prompt and response schema in sync with the UI counterpart.
 */

export interface VideoChapter {
  time: number;
  label: string;
}

export interface DescriptionResult {
  summary: string;
  chapters: VideoChapter[];
  hashtags: string[];
}

export const DESCRIPTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          time: { type: Type.NUMBER },
          label: { type: Type.STRING },
        },
        required: ["time", "label"],
      },
    },
    hashtags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["summary", "chapters", "hashtags"],
} as const;

export function buildDescriptionPrompt(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): string {
  return `You are generating a YouTube-style video description.

Voiceover transcription:
"${transcription}"

Timed transcript segments: ${JSON.stringify(segments)}

Video content descriptions: ${videoAnalyses.join(" | ")}

Generate:
1. A compelling 2-3 sentence summary of the video content
2. Chapter timestamps (3-8 chapters) derived from topic shifts in the transcript. Each chapter needs a timestamp (in seconds from the start) and a short descriptive label (2-5 words)
3. 8-12 relevant hashtags for YouTube/social media (without the # symbol)`;
}

export const generateDescriptionInputSchema = {
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

export type GenerateDescriptionArgs = {
  transcription: string;
  segments: Array<{ text: string; start: number; end: number }>;
  videoAnalyses: string[];
};

export async function generateDescriptionHandler(
  args: GenerateDescriptionArgs,
  generate: GenerateFn
): Promise<CallToolResult> {
  try {
    const response = await generate({
      model: MODELS.flash,
      contents: buildDescriptionPrompt(args.transcription, args.segments, args.videoAnalyses),
      config: {
        responseMimeType: "application/json",
        responseSchema: DESCRIPTION_RESPONSE_SCHEMA,
      },
    });
    const parsed = parseModelJson<DescriptionResult>(response.text, "Description generation");
    return jsonResult(parsed);
  } catch (err) {
    return errorResult(normalizeErrorMessage(err));
  }
}
