import { Type } from "@google/genai";
import { generateContent } from "./geminiClient";
import { MODELS } from "./models";
import {
  PLATFORM_PRESETS,
  DEFAULT_PLATFORM_PRESET,
  buildDescriptionPrompt,
  type PlatformId,
} from "../utils/platformPresets";

/**
 * Parses the model's JSON response, raising on empty or malformed output
 * instead of silently degrading to empty results (which read as "no data").
 */
export function parseModelJson<T>(text: string | undefined, context: string): T {
  if (!text || !text.trim()) {
    throw new Error(`${context}: Gemini returned an empty response.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${context}: Gemini returned malformed JSON — got: ${text.slice(0, 200)}`);
  }
}

export async function generateDescription(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[],
  platform: PlatformId = DEFAULT_PLATFORM_PRESET
): Promise<{ summary: string; chapters: Array<{ time: number; label: string }>; hashtags: string[] }> {
  const prompt = buildDescriptionPrompt(PLATFORM_PRESETS[platform], transcription, segments, videoAnalyses);

  const response = await generateContent({
    model: MODELS.flash,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
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
      },
    },
  });

  return parseModelJson<{ summary: string; chapters: Array<{ time: number; label: string }>; hashtags: string[] }>(
    response.text,
    "Description generation"
  );
}

export async function identifyKeyMoments(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): Promise<Array<{ timestamp: number; quote: string; reason: string }>> {
  const prompt = `Analyze this video and identify the 4-5 most emotionally charged, surprising, or compelling moments that would make great video thumbnails for click-through on YouTube or social media.

Full transcription: "${transcription}"

Timed segments: ${JSON.stringify(segments)}

Video content: ${videoAnalyses.join(' | ')}

For each moment provide:
- The exact timestamp in seconds (must be within the segment times above)
- A short punchy quote or label (max 7 words) suitable as thumbnail text
- Why this moment is visually and emotionally compelling for a thumbnail`;

  const response = await generateContent({
    model: MODELS.flash,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
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
      },
    },
  });

  return parseModelJson<Array<{ timestamp: number; quote: string; reason: string }>>(
    response.text,
    "Thumbnail key-moment identification"
  );
}
