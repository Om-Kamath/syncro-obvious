import { Type } from "@google/genai";
import { generateContent, normalizeErrorMessage } from "./geminiClient";
import { MODELS } from "./models";
import { finishLog, startLog } from "./logger";
import type { TitleAngle, TitleVariant } from "../types";

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
  const MODEL = MODELS.flash;
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
  const MODEL = MODELS.flash;
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

/** The five title angles every variant set must cover — one title per angle. */
export const TITLE_ANGLES: readonly TitleAngle[] = ['how-to', 'listicle', 'question', 'bold-claim', 'curiosity'];

/**
 * Validates the model's title variants against the five-angle contract,
 * returning trimmed copies. Throws (never silently degrades) when the model
 * returns the wrong count, an unknown or repeated angle, or an empty title —
 * or repeats the same title text under two angles.
 */
export function validateTitleVariants(variants: unknown): TitleVariant[] {
  if (!Array.isArray(variants) || variants.length !== TITLE_ANGLES.length) {
    const got = Array.isArray(variants) ? variants.length : 'non-array';
    throw new Error(
      `Title variant generation: expected exactly ${TITLE_ANGLES.length} title variants, got ${got}.`
    );
  }

  const seenAngles = new Set<string>();
  const seenTitles = new Set<string>();
  const validated: TitleVariant[] = [];
  for (const variant of variants) {
    const { angle, title } = (variant ?? {}) as Partial<TitleVariant>;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (!trimmedTitle) {
      throw new Error('Title variant generation: a variant is missing a non-empty title.');
    }
    if (typeof angle !== 'string' || !TITLE_ANGLES.includes(angle as TitleAngle)) {
      throw new Error(
        `Title variant generation: unknown angle "${String(angle)}" — expected one of: ${TITLE_ANGLES.join(', ')}.`
      );
    }
    if (seenAngles.has(angle)) {
      throw new Error(`Title variant generation: angle "${angle}" appears more than once — every angle must be distinct.`);
    }
    const titleKey = trimmedTitle.toLowerCase();
    if (seenTitles.has(titleKey)) {
      throw new Error(`Title variant generation: duplicate title "${trimmedTitle}" — every title must be distinct.`);
    }
    seenAngles.add(angle);
    seenTitles.add(titleKey);
    validated.push({ angle: angle as TitleAngle, title: trimmedTitle });
  }
  return validated;
}

export async function generateTitleVariants(
  transcription: string,
  segments: Array<{ text: string; start: number; end: number }>,
  videoAnalyses: string[]
): Promise<TitleVariant[]> {
  const MODEL = MODELS.flash;
  const log = startLog('Generate Title Variants', MODEL, logDetail(transcription, segments.length));
  try {
    const prompt = `You are a YouTube title strategist writing titles for a video.

Full transcription: "${transcription}"

Timed transcript segments: ${JSON.stringify(segments)}

Video content descriptions: ${videoAnalyses.join(' | ')}

Write exactly 5 title variants, one for each of these angles:
1. how-to — teaches the viewer how to do something the video actually demonstrates
2. listicle — a numbered list (e.g. "5 ways ...") reflecting real points from the video
3. question — a question the viewer wants answered, ending with "?"
4. bold-claim — a confident, specific promise the video can back up
5. curiosity — withholds the payoff to make the viewer click

Rules:
- Every title must be grounded in what the transcription actually says — never invent claims the video cannot support
- Max 70 characters each (YouTube truncates beyond that)
- No ALL-CAPS shouting, no misleading bait

Return one variant per angle, each with its angle (exactly one of: how-to, listicle, question, bold-claim, curiosity) and the title text.`;

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
              angle: { type: Type.STRING, enum: [...TITLE_ANGLES] },
              title: { type: Type.STRING },
            },
            required: ["angle", "title"],
          },
        },
      },
    });

    return validateTitleVariants(
      parseModelJson<unknown>(response.text, "Title variant generation")
    );
  } catch (err) {
    finishLog(log, normalizeErrorMessage(err));
    throw err;
  }
}
