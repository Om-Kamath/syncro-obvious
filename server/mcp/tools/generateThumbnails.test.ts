import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  generateThumbnailsHandler,
  buildKeyMomentsPrompt,
  KEY_MOMENTS_RESPONSE_SCHEMA,
} from "./generateThumbnails";
import type { GenerateFn, GenerateResult } from "../gemini";
import { MODELS } from "../../../src/services/models";

const MOMENTS_PAYLOAD = [
  { timestamp: 3, quote: "The cabin door creaks", reason: "Sudden tension" },
  { timestamp: 61.25, quote: "Sunrise over the ridge", reason: "Visually striking" },
];

function fakeGenerate(text: string | Error): GenerateFn {
  if (text instanceof Error) return vi.fn().mockRejectedValue(text);
  return vi.fn().mockResolvedValue({ text } as GenerateResult);
}

function firstText(result: CallToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== "text") throw new Error("tool result carried no text content");
  return item.text;
}

function parsePayload(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  return JSON.parse(firstText(result)) as Record<string, unknown>;
}

const args = {
  transcription: "We hiked the ridge at dawn and found an abandoned cabin.",
  segments: [
    { text: "We hiked the ridge at dawn.", start: 0, end: 4 },
    { text: "We found an abandoned cabin.", start: 4, end: 8 },
  ],
  videoAnalyses: ["A mountain ridge at sunrise"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateThumbnailsHandler — mocked Gemini", () => {
  it("calls Gemini with the registry flash model and an ARRAY response schema", async () => {
    const generate = fakeGenerate(JSON.stringify(MOMENTS_PAYLOAD));
    await generateThumbnailsHandler(args, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    const params = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.model).toBe(MODELS.flash);
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseSchema).toEqual(KEY_MOMENTS_RESPONSE_SCHEMA);
  });

  it("embeds the transcription, serialized segments, and analyses in the prompt", async () => {
    const generate = fakeGenerate(JSON.stringify(MOMENTS_PAYLOAD));
    await generateThumbnailsHandler(args, generate);

    const params = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.contents).toBe(buildKeyMomentsPrompt(args.transcription, args.segments, args.videoAnalyses));
    expect(params.contents).toContain(args.transcription);
    expect(params.contents).toContain(JSON.stringify(args.segments));
  });

  it("returns the moments wrapped in a keyMoments field on a success result", async () => {
    const generate = fakeGenerate(JSON.stringify(MOMENTS_PAYLOAD));
    const result = await generateThumbnailsHandler(args, generate);

    expect(result.isError).toBeUndefined();
    const payload = parsePayload(result);
    expect(payload).toEqual({ keyMoments: MOMENTS_PAYLOAD });
  });

  it("returns an isError result on malformed model JSON instead of silent empty output", async () => {
    const generate = fakeGenerate("{broken");
    const result = await generateThumbnailsHandler(args, generate);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(
      /Thumbnail key-moment identification: Gemini returned malformed JSON/i
    );
  });

  it("returns an isError result carrying the Gemini failure message", async () => {
    const generate = fakeGenerate(new Error("safety block"));
    const result = await generateThumbnailsHandler(args, generate);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("safety block");
  });
});
