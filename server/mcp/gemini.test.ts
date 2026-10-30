import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GenerateContentResponse } from "@google/genai";

const { generateContentMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContentRef = vi.fn();
  class GoogleGenAIMock {
    static constructions: Array<{ apiKey: string }> = [];
    models = { generateContent: generateContentRef };
    constructor(options: { apiKey: string }) {
      GoogleGenAIMock.constructions.push(options);
    }
  }
  return { generateContentMock: generateContentRef, GoogleGenAIMock };
});

vi.mock("@google/genai", () => ({ GoogleGenAI: GoogleGenAIMock }));

import {
  createGenerate,
  extractUsage,
  requireServerApiKey,
  MISSING_SERVER_API_KEY_MESSAGE,
} from "./gemini";

function fakeResponse(overrides: Partial<Record<string, unknown>> = {}): GenerateContentResponse {
  return {
    text: "ok",
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 7,
      totalTokenCount: 18,
    },
    ...overrides,
  } as unknown as GenerateContentResponse;
}

beforeEach(() => {
  generateContentMock.mockReset().mockResolvedValue(fakeResponse());
  GoogleGenAIMock.constructions.length = 0;
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireServerApiKey", () => {
  it("returns the GEMINI_API_KEY from the environment", () => {
    expect(requireServerApiKey({ GEMINI_API_KEY: "env-key" })).toBe("env-key");
  });

  it("throws a guidance error when the environment key is missing", () => {
    expect(() => requireServerApiKey({})).toThrow(MISSING_SERVER_API_KEY_MESSAGE);
    expect(() => requireServerApiKey({})).toThrow(/Set GEMINI_API_KEY/);
  });
});

describe("extractUsage", () => {
  it("maps the SDK usageMetadata onto the stable field triple", () => {
    expect(extractUsage(fakeResponse())).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it("returns undefined when the response carries no usageMetadata", () => {
    expect(extractUsage(fakeResponse({ usageMetadata: undefined }))).toBeUndefined();
  });
});

describe("createGenerate", () => {
  it("constructs the client from the environment key when no explicit key is passed", () => {
    createGenerate();
    expect(GoogleGenAIMock.constructions).toEqual([{ apiKey: "test-key" }]);
  });

  it("returns the response text plus captured usage", async () => {
    const generate = createGenerate();
    const result = await generate({ model: "test-model", contents: "hi" });
    expect(result.text).toBe("ok");
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it("coerces a missing text field to the empty string", async () => {
    generateContentMock.mockResolvedValue(fakeResponse({ text: undefined }));
    const generate = createGenerate();
    const result = await generate({ model: "test-model", contents: "hi" });
    expect(result.text).toBe("");
  });

  it("logs one stderr line per successful call with model, duration, and tokens", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const generate = createGenerate();
    await generate({ model: "test-model", contents: "hi" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("[syncro-mcp]");
    expect(logged).toContain('"model":"test-model"');
    expect(logged).toContain('"durationMs"');
    expect(logged).toContain('"totalTokens":18');
  });

  it("rethrows Gemini failures and logs the error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generateContentMock.mockRejectedValue(new Error("API error: quota exceeded"));
    const generate = createGenerate();

    await expect(generate({ model: "test-model", contents: "hi" })).rejects.toThrow(
      "API error: quota exceeded"
    );

    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("[syncro-mcp]");
    expect(logged).toContain('"error":"API error: quota exceeded"');
  });

  it("fails fast when no environment key is configured", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => createGenerate()).toThrow(/Set GEMINI_API_KEY/);
    expect(GoogleGenAIMock.constructions).toHaveLength(0);
  });
});
