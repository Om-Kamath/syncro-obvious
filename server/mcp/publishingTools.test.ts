import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SyncroApiClient, type FetchLike } from "./apiClient";
import { DEFAULT_MAX_UPLOAD_BYTES, createSyncroMcpServer } from "./mediaTools";
import type { GenerateFn, GenerateResult } from "./gemini";

/** Protocol-level tests: the publishing tools must be listable and callable over MCP. */

const DESCRIPTION_PAYLOAD = {
  summary: "A dawn hike leads to a forgotten cabin.",
  chapters: [{ time: 0, label: "The hike begins" }],
  hashtags: ["hiking"],
};

const MOMENTS_PAYLOAD = [{ timestamp: 3, quote: "The cabin door creaks", reason: "Sudden tension" }];

const SEGMENTS = [
  { text: "We hiked the ridge at dawn.", start: 0, end: 4 },
  { text: "We found an abandoned cabin.", start: 4, end: 8 },
];

function firstText(result: CallToolResult): string {
  const item = result.content[0];
  if (!item || item.type !== "text") throw new Error("tool result carried no text content");
  return item.text;
}

// The publishing tools never touch the Syncro API — any fetch here is a routing bug.
const failFetch: FetchLike = async (input) => {
  throw new Error(`publishing tools must not call the API (${String(input)})`);
};

describe("createSyncroMcpServer publishing tools", () => {
  const generate: GenerateFn = vi.fn();
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    const apiClient = new SyncroApiClient({ baseUrl: "http://syncro.test", fetch: failFetch });
    server = createSyncroMcpServer({ apiClient, maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES, generate });
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await Promise.all([server.close(), client.close()]);
  });

  it("registers the three publishing tools alongside the media tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);

    expect(names).toContain("generate_description");
    expect(names).toContain("generate_thumbnails");
    expect(names).toContain("export_captions");
    // Coexistence with the merged media + project tool slices on the same server.
    expect(names).toContain("upload_media");
    expect(names).toContain("attach_media");
    expect(names).toContain("list_projects");
    expect(names).toContain("get_project");

    const description = tools.find(t => t.name === "generate_description");
    expect(description?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({ transcription: expect.anything() }),
    });

    const captions = tools.find(t => t.name === "export_captions");
    const format = captions?.inputSchema?.properties?.format as { type?: string; enum?: string[] } | undefined;
    expect(format?.enum).toEqual(["srt", "vtt"]);
  });

  it("calls generate_description end-to-end with the injected generate and returns parsed JSON", async () => {
    (generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(DESCRIPTION_PAYLOAD),
    } as GenerateResult);

    const result = (await client.callTool({
      name: "generate_description",
      arguments: { transcription: "hello world" },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual(DESCRIPTION_PAYLOAD);
    // Schema defaults applied: empty segments/analyses still reach the prompt.
    const params = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(params.contents).toContain('"hello world"');
  });

  it("calls generate_thumbnails and wraps the moments array", async () => {
    (generate as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify(MOMENTS_PAYLOAD),
    } as GenerateResult);

    const result = (await client.callTool({
      name: "generate_thumbnails",
      arguments: { transcription: "hello world" },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({ keyMoments: MOMENTS_PAYLOAD });
  });

  it("calls export_captions over MCP with no Gemini involvement", async () => {
    const result = (await client.callTool({
      name: "export_captions",
      arguments: { segments: SEGMENTS, format: "vtt" },
    })) as CallToolResult;

    expect(result.isError).toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
    const payload = JSON.parse(firstText(result)) as { format: string; filename: string; content: string };
    expect(payload.format).toBe("vtt");
    expect(payload.filename).toBe("captions.vtt");
    expect(payload.content).toMatch(/^WEBVTT/);
  });

  it("surfaces Gemini failures as isError results over the protocol", async () => {
    (generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error: quota exceeded"));

    const result = (await client.callTool({
      name: "generate_description",
      arguments: { transcription: "hello world" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("API error: quota exceeded");
  });

  it("rejects invalid tool arguments through schema validation", async () => {
    const result = (await client.callTool({
      name: "export_captions",
      arguments: { segments: "not-an-array" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
  });
});
