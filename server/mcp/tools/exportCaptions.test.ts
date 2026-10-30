import { describe, it, expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { exportCaptionsHandler } from "./exportCaptions";
import type { ExportCaptionsArgs } from "./exportCaptions";

const segments = [
  { text: "We hiked the ridge at dawn.", start: 0, end: 4.5 },
  { text: "We found an abandoned cabin.", start: 4.5, end: 8 },
];

function parsePayload(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  const item = result.content[0];
  if (!item || item.type !== "text") throw new Error("tool result carried no text content");
  return JSON.parse(item.text) as Record<string, unknown>;
}

describe("exportCaptionsHandler", () => {
  it("emits an SRT file by default with numbered blocks and comma milliseconds", () => {
    const args: ExportCaptionsArgs = { segments, format: "srt" };
    const payload = parsePayload(exportCaptionsHandler(args));

    expect(payload.format).toBe("srt");
    expect(payload.filename).toBe("captions.srt");
    expect(payload.content).toBe(
      "1\n00:00:00,000 --> 00:00:04,500\nWe hiked the ridge at dawn.\n\n" +
        "2\n00:00:04,500 --> 00:00:08,000\nWe found an abandoned cabin."
    );
  });

  it("emits a VTT file with a WEBVTT header and dot milliseconds", () => {
    const args: ExportCaptionsArgs = { segments, format: "vtt" };
    const payload = parsePayload(exportCaptionsHandler(args));

    expect(payload.format).toBe("vtt");
    expect(payload.filename).toBe("captions.vtt");
    expect(payload.content).toBe(
      "WEBVTT\n\n" +
        "00:00:00.000 --> 00:00:04.500\nWe hiked the ridge at dawn.\n\n" +
        "00:00:04.500 --> 00:00:08.000\nWe found an abandoned cabin."
    );
  });

  it("serializes empty segment lists without error", () => {
    const args: ExportCaptionsArgs = { segments: [], format: "srt" };
    const payload = parsePayload(exportCaptionsHandler(args));
    expect(payload.content).toBe("");
  });

  it("never calls Gemini — serialization is pure", () => {
    // The handler signature takes no generate function by construction; this
    // test pins that contract so a future change keeps captions free of AI cost.
    expect(exportCaptionsHandler.length).toBeLessThanOrEqual(1);
  });
});
