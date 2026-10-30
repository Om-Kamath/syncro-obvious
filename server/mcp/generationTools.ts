import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  TRANSCRIPTION_PROMPT,
  buildNarrationPrompt,
  estimateSegments,
  inlineAudioToWavBytes,
} from '../../src/services/gemini';
import { MODELS } from '../../src/services/models';
import { startLog } from '../../src/services/logger';
import { generateContent, uploadAudioBytes } from './geminiClient';

/**
 * MCP generation tools — the server-side equivalents of the UI's Gemini
 * features (`generateNarrationFromVideos`, `generateAudioFromScript`,
 * `analyzeVoiceover`), routed through the same patterns: shared prompts and
 * parsers from `gemini.ts`, logging via `startLog`, and the logged + costed
 * `generateContent` wrapper from `geminiClient.ts`. Prompt text and fallback
 * behavior stay word-identical across both surfaces by construction.
 *
 * Unlike the media tools, these call Gemini directly from this process (the
 * Express API has no Gemini capability) and require GEMINI_API_KEY.
 */

const DEFAULT_TTS_VOICE = 'Aoede';

/** z.string() that also rejects whitespace-only input — the old hand-rolled
 *  expectString semantics, so validation behavior is unchanged. */
function nonBlank(): z.ZodString {
  return z
    .string()
    .min(1)
    .refine(v => v.trim().length > 0, { message: 'must be a non-empty string' });
}

// Result helpers mirror mediaTools.ts' private ones — kept local so the two
// tool modules stay independently reviewable.
function textResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

// -------------------------------------------------------------------
// WAV duration — lets generate_captions time captions without the caller
// passing a duration when the audio is a WAV (e.g. generate_tts output).
// -------------------------------------------------------------------
/** Reads duration in seconds from a RIFF/WAVE container (data size ÷ byte
 *  rate), walking chunks for robustness. Null when not a parsable WAV. */
export function readWavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let byteRate: number | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 16 <= bytes.byteLength) {
      byteRate = view.getUint32(offset + 16, true); // fmt+8: sampleRate; fmt+12: byteRate
    } else if (id === 'data' && byteRate !== null && byteRate > 0) {
      return size / byteRate;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** Register the generation tools on the shared MCP server. */
export function registerGenerationTools(server: McpServer): void {
  // -----------------------------------------------------------------
  // generate_narration
  // -----------------------------------------------------------------
  server.registerTool(
    'generate_narration',
    {
      title: 'Generate narration',
      description:
        'Write a narration script for a set of video clips with server-side Gemini. ' +
        'Returns the script text; pair with generate_tts to voice it.',
      inputSchema: {
        clips: z
          .array(
            z.object({
              name: nonBlank().describe('Clip file name.'),
              analysis: nonBlank().describe('What the clip shows (visual content).'),
              duration: z.number().finite().positive().describe('Clip duration in seconds.'),
            }),
          )
          .min(1)
          .describe('The timeline clips in playback order.'),
      },
    },
    async ({ clips }) => {
      try {
        const MODEL = MODELS.flashLite;
        const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
        const log = startLog(
          'MCP Generate Narration',
          MODEL,
          `${clips.length} clips | total ${totalDuration.toFixed(1)}s`,
        );
        const response = await generateContent(
          { model: MODEL, contents: buildNarrationPrompt(clips) },
          log,
        );
        const script = response.text?.trim() || 'No narration could be generated.';
        return textResult({ script });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -----------------------------------------------------------------
  // generate_tts
  // -----------------------------------------------------------------
  server.registerTool(
    'generate_tts',
    {
      title: 'Generate TTS audio',
      description:
        'Convert a script to spoken audio (WAV) with server-side Gemini TTS. ' +
        'Returns base64 WAV bytes plus their duration in seconds.',
      inputSchema: {
        script: nonBlank().describe('The words to speak.'),
        voice: nonBlank()
          .describe(`Prebuilt Gemini voice name (default: ${DEFAULT_TTS_VOICE}).`)
          .optional(),
      },
    },
    async ({ script, voice }) => {
      try {
        const effectiveVoice = voice ?? DEFAULT_TTS_VOICE;
        const MODEL = MODELS.tts;
        const log = startLog(
          'MCP TTS',
          MODEL,
          `voice=${effectiveVoice} | "${script.slice(0, 80)}${script.length > 80 ? '…' : ''}"`,
        );
        const response = await generateContent(
          {
            model: MODEL,
            contents: [{ parts: [{ text: script }] }],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: effectiveVoice } } },
            },
          },
          log,
        );

        const part = response.candidates?.[0]?.content?.parts?.[0] as
          | { inlineData?: { data?: string; mimeType?: string } }
          | undefined;
        if (!part?.inlineData?.data) throw new Error('No audio returned from TTS');

        const wavBytes = inlineAudioToWavBytes(part.inlineData.data, part.inlineData.mimeType);
        return textResult({
          audioBase64: Buffer.from(wavBytes).toString('base64'),
          mimeType: 'audio/wav',
          durationSeconds: readWavDurationSeconds(wavBytes),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -----------------------------------------------------------------
  // generate_captions
  // -----------------------------------------------------------------
  server.registerTool(
    'generate_captions',
    {
      title: 'Generate captions',
      description:
        'Transcribe audio into caption segments with server-side Gemini. ' +
        'Timestamps are estimated from the audio duration (pass durationSeconds, ' +
        'or send WAV audio and it is read from the header).',
      inputSchema: {
        audioBase64: nonBlank().describe('Base64-encoded audio bytes to transcribe.'),
        mimeType: nonBlank().describe('Audio MIME type, e.g. audio/wav.'),
        name: nonBlank().describe('Optional file name for the upload.').optional(),
        durationSeconds: z
          .number()
          .finite()
          .positive()
          .describe('Audio duration in seconds. Optional for WAV input.')
          .optional(),
      },
    },
    async ({ audioBase64, mimeType, name, durationSeconds }) => {
      try {
        const bytes = new Uint8Array(Buffer.from(audioBase64, 'base64'));
        if (bytes.byteLength === 0) {
          throw new Error('arguments.audioBase64 did not decode to any bytes');
        }

        const totalDuration = durationSeconds ?? readWavDurationSeconds(bytes);
        if (totalDuration === undefined || totalDuration === null || totalDuration <= 0) {
          throw new Error(
            'Could not determine audio duration — pass arguments.durationSeconds so caption timings can be estimated.',
          );
        }

        const MODEL = MODELS.flashLite;
        const uploadName = name ?? 'voiceover.audio';
        const log = startLog('MCP Captions', MODEL, uploadName);
        const fileUri = await uploadAudioBytes(bytes, mimeType, uploadName);
        const response = await generateContent(
          {
            model: MODEL,
            contents: {
              parts: [{ fileData: { mimeType, fileUri } }, { text: TRANSCRIPTION_PROMPT }],
            },
            config: { temperature: 0 },
          },
          log,
        );

        const transcription = response.text?.trim() ?? '';
        const segments = estimateSegments(transcription, totalDuration);
        return textResult({
          transcription,
          segments,
          durationSeconds: totalDuration,
          timingSource: durationSeconds !== undefined ? 'provided' : 'wav-header',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
