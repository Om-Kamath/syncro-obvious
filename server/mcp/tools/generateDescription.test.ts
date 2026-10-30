import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  generateDescriptionHandler,
  buildDescriptionPrompt,
  DESCRIPTION_RESPONSE_SCHEMA,
} from "./generateDescription";
import type { GenerateFn, GenerateResult } from "../gemini";
import { MODELS } from "../../../src/services/models";

const DESCRIPTION_PAYLOAD = {
  summary: "A dawn hike leads to a forgotten cabin.",
  chapters: [
    { time: 0, label: "The hike begins" },
    { time: 42.5, label: "Cabin discovery" },
  ],
  hashtags: ["hiking", "exploration", "abandoned"],
};

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
  videoAnalyses: ["A mountain ridge at sunrise", "A weathered cabin door"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDescriptionHandler — mocked Gemini", () => {
  it("calls Gemini with the registry flash model and a JSON OBJECT response schema", async () => {
    const generate = fakeGenerate(JSON.stringify(DESCRIPTION_PAYLOAD));
    await generateDescriptionHandler(args, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    const params = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.model).toBe(MODELS.flash);
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseSchema).toEqual(DESCRIPTION_RESPONSE_SCHEMA);
  });

  it("embeds the transcription, serialized segments, and pipe-joined analyses in the prompt", async () => {
    const generate = fakeGenerate(JSON.stringify(DESCRIPTION_PAYLOAD));
    await generateDescriptionHandler(args, generate);

    const params = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.contents).toBe(buildDescriptionPrompt(args.transcription, args.segments, args.videoAnalyses));
    expect(params.contents).toContain(args.transcription);
    expect(params.contents).toContain(JSON.stringify(args.segments));
    expect(params.contents).toContain(args.videoAnalyses.join(" | "));
  });

  it("returns the parsed description as JSON text content on a success result", async () => {
    const generate = fakeGenerate(JSON.stringify(DESCRIPTION_PAYLOAD));
    const result = await generateDescriptionHandler(args, generate);

    expect(result.isError).toBeUndefined();
    expect(parsePayload(result)).toEqual(DESCRIPTION_PAYLOAD);
  });

  it("returns an isError result on malformed model JSON instead of silent empty output", async () => {
    const generate = fakeGenerate("}}{{ garbage");
    const result = await generateDescriptionHandler(args, generate);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Description generation: Gemini returned malformed JSON/i);
  });

  it("returns an isError result on an empty model response", async () => {
    const generate = fakeGenerate("   ");
    const result = await generateDescriptionHandler(args, generate);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/empty response/i);
  });

  it("returns an isError result carrying the Gemini failure message", async () => {
    const generate = fakeGenerate(new Error("API error: quota exceeded"));
    const result = await generateDescriptionHandler(args, generate);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("API error: quota exceeded");
  });
});
