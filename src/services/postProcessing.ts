import { Type } from "@google/genai";
import { generateContent, normalizeErrorMessage } from "./geminiClient";
import { modelFor } from "./models";
import { finishLog, startLog } from "./logger";

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

/** Short input preview for log detail lines — same idiom as gemini.ts. */
function logDetail(transcription: string, segmentCount: number): string {
  return `${segmentCount} segments | "${transcription.slice(0, 80)}${transcription.length > 80 ? '…' : ''}"`;
}

export async function generateDescription(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): Promise<{ summary: string; chapters: Array<{ time: number; label: string }>; hashtags: string[] }> {
  const MODEL = modelFor('description');
  const log = startLog('Generate Description', MODEL, logDetail(transcription, segments.length));
  try {
    const prompt = `You are generating a YouTube-style video description.

Voiceover transcription:
"${transcription}"

Timed transcript segments: ${JSON.stringify(segments)}

Video content descriptions: ${videoAnalyses.join(' | ')}

Generate:
1. A compelling 2-3 sentence summary of the video content
2. Chapter timestamps (3-8 chapters) derived from topic shifts in the transcript. Each chapter needs a timestamp (in seconds from the start) and a short descriptive label (2-5 words)
3. 8-12 relevant hashtags for YouTube/social media (without the # symbol)`;

    const response = await generateContent({
      model: MODEL,
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
    }, log);

    return parseModelJson<{ summary: string; chapters: Array<{ time: number; label: string }>; hashtags: string[] }>(
      response.text,
      "Description generation"
    );
  } catch (err) {
    finishLog(log, normalizeErrorMessage(err));
    throw err;
  }
}

export async function identifyKeyMoments(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): Promise<Array<{ timestamp: number; quote: string; reason: string }>> {
  const MODEL = modelFor('thumbnails');
  const log = startLog('Identify Key Moments', MODEL, logDetail(transcription, segments.length));
  try {
    const prompt = `Analyze this video and identify the 4-5 most emotionally charged, surprising, or compelling moments that would make great video thumbnails for click-through on YouTube or social media.

Full transcription: "${transcription}"

Timed segments: ${JSON.stringify(segments)}

Video content: ${videoAnalyses.join(' | ')}

For each moment provide:
- The exact timestamp in seconds (must be within the segment times above)
- A short punchy quote or label (max 7 words) suitable as thumbnail text
- Why this moment is visually and emotionally compelling for a thumbnail`;

    const response = await generateContent({
      model: MODEL,
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
    }, log);

    return parseModelJson<Array<{ timestamp: number; quote: string; reason: string }>>(
      response.text,
      "Thumbnail key-moment identification"
    );
  } catch (err) {
    finishLog(log, normalizeErrorMessage(err));
    throw err;
  }
}
