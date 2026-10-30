# Driving Syncro from agents — the MCP guide

Syncro ships a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents — Claude Desktop, Claude Code, Cursor, or any harness that speaks MCP — can read saved projects and drive exports without opening the UI. The stdio server is a thin, stateless client of Syncro's REST API: it holds no database, and every tool call is answered from the running Syncro server on `:3001`.

This guide covers what the MCP surface is today, how to launch it in each transport, and copy-paste configs for the common clients. Example config files live in [`docs/examples/`](docs/examples/).

```
┌────────────────────┐   stdio (JSON-RPC       ┌────────────────────┐   HTTP    ┌─────────────────────┐
│ MCP client         │ ── over the process's ──┤  Syncro MCP server │ ────────▶ │ Syncro REST API     │
│ (Claude Desktop,   │    stdin/stdout)        │  server/mcp/       │  fetch    │ :3001 (Express +    │
│  agent harness)    │ ── streamable HTTP ──── │                    │           │ better-sqlite3)     │
└────────────────────┘    :3010/mcp           └────────────────────┘           └─────────────────────┘
```

## Prerequisites

1. **Node.js** (18 or newer) and the repo checked out: `git clone https://github.com/Om-Kamath/syncro-obvious && cd syncro-obvious && npm install`
2. **The Syncro REST API running** — the MCP server reads everything through it:

   ```sh
   npm run server:start        # Express + SQLite on http://localhost:3001
   ```

   The database file defaults to `syncro.db` in the repo root; set `SYNCRO_DB_PATH` to change it. Create a project from the UI ("Save" in the editor) or `POST /api/projects` — the MCP tools can only see what the REST API returns.
3. No Gemini key is needed for the read, media, and export tools — only Syncro's server itself needs one, and only for AI features. The server-side generation and publishing tools (`generate_narration`, `generate_tts`, `generate_captions`, `generate_description`, `generate_thumbnails`) are the exception: they call Gemini from the MCP server process and need `GEMINI_API_KEY` in that process's environment (see [Tool reference](#tool-reference)).

## Launching the server

The MCP server has two transports. Pick one:

| Transport | Command | Who connects | Notes |
| --- | --- | --- | --- |
| **stdio** (default) | `npm run mcp` | One client per process; the client spawns it | What Claude Desktop and most agent configs use. Protocol on stdout, diagnostics on stderr. |
| **streamable HTTP** | `npm run mcp:http` | Any number of clients against a shared server | Serves `POST/GET/DELETE /mcp` on `127.0.0.1:3010` (stateful sessions, DNS-rebinding protection, loopback bind). |

Handy invocations:

```sh
npm run mcp                                   # stdio — usually launched by the client, not you
SYNCRO_API_URL=http://localhost:3001 npm run mcp   # explicit API base (this is the default)
npm run mcp:http -- --port=4000               # HTTP on a custom port
SYNCRO_MCP_PORT=4000 npm run mcp:http         # same, via env
```

### Configuration reference

| Variable / flag | Applies to | Default | Meaning |
| --- | --- | --- | --- |
| `SYNCRO_API_URL` | both | `http://localhost:3001` | Base URL of the Syncro REST API. Trailing slashes are trimmed. |
| `--port=<n>` / `SYNCRO_MCP_PORT` | HTTP | `3010` | Port for the streamable-HTTP listener. The flag wins over the env var; non-integer or out-of-range values fail loudly at startup. |
| `SYNCRO_DB_PATH` | REST API | `syncro.db` | SQLite file the REST API persists to (set when launching `server:start`, not the MCP server). |

## Tool reference

Fifteen tools ship across the MCP branches, grouped by capability below. Every tool returns JSON, pretty-printed, as a single text content block. Expected failures — unknown project id, API unreachable, missing key — come back as tool errors (`isError: true`) with a human-readable message, so an agent can react to them; they never crash the session.

Read tools (`list_projects`, `get_project`, `get_timeline`) and `trigger_export` ship on the MCP scaffold and companion branches; mutation, media, and generation tools arrive on their own branches (each listed with its branch name). They all register into the same server entrypoint, so the launch contract in the previous section holds regardless of which tool groups have landed.

### Reading projects

#### `list_projects`

Lists all saved Syncro projects, most recently updated first. Takes no arguments.

Returns an array of project records — each with `id`, `name`, `state` (the full serialized editor state), `createdAt`, `updatedAt`:

```json
[
  {
    "id": "8cc3308b-d78d-4856-bbc3-63ffe578a314",
    "name": "Launch teaser",
    "state": {
      "clips": [
        { "id": "clip-1", "name": "intro.mp4", "duration": 12.5, "startTime": 0, "track": 0 }
      ],
      "voiceover": null,
      "captionStyle": { "mode": "lower-third", "fontSize": 24, "color": "#ffffff", "bgColor": "#000000", "position": "bottom" },
      "captionsEnabled": true
    },
    "createdAt": "2026-10-30T19:02:59.634Z",
    "updatedAt": "2026-10-30T19:02:59.634Z"
  }
]
```

#### `get_project`

Fetches one saved project by id, including its full editor state.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Project id, as reported by `list_projects` |

Returns the same record shape as `list_projects`. Unknown ids return a tool error: `Project not found: <id>`.

#### `get_timeline`

Reads back a project's timeline as an agent-friendly snapshot: the ordered clip list with chained start times, effective (post-trim) and source durations, track layers, total timeline duration, and the persisted playhead position. Read-only — it never mutates the project.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Id of the saved project to inspect |

### Exports (`task/pr-79-mcp-export-trigger-tool`)

#### `trigger_export`

Enqueues a server-side export job for a saved project. Returns the new job id and its initial queued status — the render worker advances it; poll the REST API for status.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Id of the saved project to export |
| `preset` | `wide` \| `vertical` \| `square` | yes | Aspect preset: `wide` = 16:9, `vertical` = 9:16, `square` = 1:1 |
| `quality` | `low` \| `medium` \| `high` \| `source` | no | Render quality tier. Defaults to `source` — an agent-driven export is never silently downgraded. |

Returns `{ "jobId": "…", "status": "queued" }`.

### Mutating projects (`task/pr-31-mcp-project-mutation-tools`)

#### `create_project`

Creates a saved project from a name and a full serialized editor state. Validation errors (bad clip fields, negative durations) return as tool errors; nothing partial is persisted.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Project name shown in the saved-projects list |
| `state` | object | yes | Serialized editor state: `clips` (array order is the timeline order), `voiceover`, `captionStyle`, `captionsEnabled` |

#### `update_project`

Updates name and/or state of an existing project. Unknown ids fail with a not-found error.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Project id, as returned by `create_project` or `list_projects` |
| `name` | string | no | New project name |
| `state` | object | no | Replacement serialized editor state (same shape as `create_project`) |

#### `delete_project`

Permanently deletes a saved project by id and returns the deleted id. Fails with a not-found error for unknown ids.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Project id to delete |

### Media (`task/pr-32-mcp-media-tools`)

#### `upload_media`

Uploads a media file to the Syncro server (`POST /api/media`) and returns the media id and URL. Fails cleanly when the file exceeds the configured maximum upload size.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | string | one of `path`/`bytes` | Local filesystem path of the media file |
| `bytes` | string | one of `path`/`bytes` | Raw file contents as base64 |
| `filename` | string | no | Filename for the upload; defaults to the basename of `path` |
| `contentType` | string | no | MIME type; guessed from the filename when omitted |
| `projectId` | string | no | Project id to associate the media with on the server |

#### `attach_media`

Attaches an uploaded media asset to a project as a new clip (updates the project's state via the REST API).

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `projectId` | string | yes | Id of the saved project to update |
| `mediaId` | string | yes | Media id returned by `upload_media` |
| `duration` | number | yes | Media duration in seconds — the server cannot probe it from bytes |
| `name` | string | no | Clip name; defaults to the media filename or id |

### Server-side generation (`task/pr-33-mcp-generation-tools`)

These tools call Gemini directly from the MCP server process (not through the UI), so they require **`GEMINI_API_KEY` in the MCP server's environment** — add it to the config's `env` block. Without it the tools fail fast with a clear message.

#### `generate_narration`

Writes a narration script for a set of video clips with server-side Gemini. Returns the script text; pair with `generate_tts` to voice it.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `clips` | array | yes | The timeline clips in playback order: `[{ name, analysis, duration }]` — `name`/`analysis`/`duration` (seconds) all required |

#### `generate_tts`

Converts a script to spoken audio (WAV) with server-side Gemini TTS. Returns base64 WAV bytes plus their duration in seconds.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `script` | string | yes | The words to speak |
| `voice` | string | no | Prebuilt Gemini voice name (server default when omitted) |

#### `generate_captions`

Transcribes audio into caption segments with server-side Gemini. Timestamps are estimated from the audio duration — pass `durationSeconds`, or send WAV audio and it is read from the header.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `audioBase64` | string | yes | Base64-encoded audio bytes to transcribe |
| `mimeType` | string | yes | Audio MIME type, e.g. `audio/wav` |
| `durationSeconds` | number | no | Audio duration in seconds; optional for WAV input |
| `name` | string | no | File name for the upload |

Returns `{ transcription, segments, durationSeconds, timingSource }` where `timingSource` says whether the duration came from the argument or the WAV header.

### Publishing (`task/pr-34-mcp-publishing-tools`)

`generate_description` and `generate_thumbnails` call server-side Gemini and require **`GEMINI_API_KEY` in the server environment**, like the generation tools above. `export_captions` is pure serialization — no key, no network.

#### `generate_description`

Generates a YouTube-style description (summary, chapter timestamps, hashtags) from a voiceover transcription.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `transcription` | string | yes | Full voiceover transcription text |
| `segments` | array | no | Timed transcript segments in seconds (`[{ text, start, end }]`) |
| `videoAnalyses` | array | no | Short descriptions of what each video clip shows |

#### `generate_thumbnails`

Identifies the 4–5 most compelling key moments (timestamp, quote, reason) for video thumbnails.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `transcription` | string | yes | Full voiceover transcription text |
| `segments` | array | no | Timed transcript segments in seconds |
| `videoAnalyses` | array | no | Short descriptions of what each video clip shows |

#### `export_captions`

Serializes timed caption segments into an SRT or VTT subtitle file, exactly as the UI's Captions/Export tabs download them.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `segments` | array | yes | Timed caption segments in seconds (`[{ text, start, end }]`) |
| `format` | `srt` \| `vtt` | no | Subtitle format to emit (default `srt`) |

Returns `{ format, filename, content }` with the subtitle file body.

## Resources

Alongside tools, the server exposes saved projects as MCP resources (read via your client's resource APIs):

| URI | Contains |
| --- | --- |
| `syncro://projects` | JSON array of summaries (`id`, `name`, `createdAt`, `updatedAt`) — cheap listing |
| `syncro://projects/{projectId}` | The full project record, including state |

A resource template `syncro://projects/{projectId}` is advertised via `resources/templates/list`; ids are percent-encoded, so an id can never contribute a path separator.

## Example client configs

### Claude Desktop

Put this in `claude_desktop_config.json` — macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json` — then restart Claude Desktop. Replace the `cwd` placeholder with your checkout's absolute path.

```json
{
  "mcpServers": {
    "syncro": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/syncro-obvious",
      "env": { "SYNCRO_API_URL": "http://localhost:3001" }
    }
  }
}
```

Shipped as [`docs/examples/claude_desktop_config.example.json`](docs/examples/claude_desktop_config.example.json).

If a client spawns the command from an arbitrary working directory (i.e. it ignores `cwd`), use the cwd-independent `--prefix` form instead — npm runs the script with the package root as its working directory:

```json
{
  "mcpServers": {
    "syncro": {
      "command": "npm",
      "args": ["--prefix=/absolute/path/to/syncro-obvious", "run", "mcp"],
      "env": { "SYNCRO_API_URL": "http://localhost:3001" }
    }
  }
}
```

Both stdio forms were exercised against the real server (see [Validation](#validation)); they differ only in how npm finds the repo. If your client is strict about stdout purity, the `npx tsx server/mcp/index.ts` launch (below) is the cleanest channel.

### Generic agent harnesses

Claude Code (`.mcp.json`), Cursor, Cline, Windsurf, and most harnesses share the `mcpServers` shape above — same file, different location. Shipped as [`docs/examples/generic-agent-mcp.example.json`](docs/examples/generic-agent-mcp.example.json).

For the HTTP transport, point the client at the endpoint instead of spawning a process (key and shape vary by client):

```json
{ "mcpServers": { "syncro": { "url": "http://127.0.0.1:3010/mcp" } } }
```

**Hand-rolled harness?** The wire protocol is newline-delimited JSON-RPC 2.0 on the process's stdin/stdout. A complete session (launched via `npx tsx` so stdout carries protocol messages only):

```sh
npx tsx server/mcp/index.ts <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}
EOF
```

Responses arrive on stdout, one JSON object per line; anything meant for humans (the `ready` banner, errors) goes to stderr. Launching through `npm run mcp` also works, but npm itself prints a `> syncro@… mcp` banner on stdout before the server's first response — tolerant clients skip non-JSON lines, strict ones should use the `npx tsx` form above, which we verified emits nothing but protocol messages on stdout. Prefer the official SDK (`@modelcontextprotocol/sdk`) over hand-rolling — the transcript above is the entirety of what it automates.

## Validation

The configs in this guide were executed, not just written. Every launch form below was spawned exactly as a client would spawn it, then driven through a real MCP handshake (`initialize` → `notifications/initialized` → `tools/list` → `tools/call`):

| What was validated | Against | Result |
| --- | --- | --- |
| `npm run mcp` with `cwd` (Claude Desktop form) | MCP scaffold, `2cc061c` | Handshake answered by `syncro-mcp` v0.1.0 (protocol `2024-11-05`); `tools/list` → `get_project`, `list_projects`; `list_projects` returned a project seeded through the real REST API; `get_project` by id returned its full state |
| `npm --prefix=<repo> run mcp` (no `cwd`) | MCP scaffold, `2cc061c` | Same handshake and tool calls, launched from an unrelated working directory |
| `npx tsx server/mcp/index.ts` | MCP scaffold, `2cc061c` | Same handshake; stdout verified to contain protocol messages only (0 non-JSON lines) |
| Raw JSON-RPC transcript above | MCP scaffold, `2cc061c` | All three requests answered on stdout as documented |
| `npm run mcp:http` (default port) + SDK `StreamableHTTPClientTransport` | HTTP transport branch, `6d276f2` | Listening banner on `http://127.0.0.1:3010/mcp`; handshake + `tools/list` + `list_projects` all answered |
| `SYNCRO_MCP_PORT=4000 npm run mcp:http` | HTTP transport branch, `6d276f2` | Same handshake on port 4000 |
| REST backing | projects API, `f99d14a` | Express on `:3001` with a seeded SQLite project; the MCP read tools returned exactly the seeded data |

The mutation, media, generation, and publishing tool groups are documented from their branches' code and test suites (`server/mcp/*.test.ts` on each branch) rather than live-driven here — their contracts above come straight from the registered input schemas. Everything else in the table was executed end-to-end.

The stdio servers read through `SYNCRO_API_URL` (default `http://localhost:3001`); the HTTP-transport branch runs against an in-memory store until it is rebased onto the DB-backed REST API, which is why its `list_projects` call returned an empty array in the evidence above. If this guide and the code ever disagree, the launch surface is `package.json`'s `mcp*` scripts, tool registrations live in the modules under `server/mcp/` (`tools.ts`, `mcpServer.ts`, `mediaTools.ts`, `server.ts`, …), and env handling sits beside each entrypoint (`api.ts` on the scaffold, `gemini.ts` on the publishing branch) — fix the docs against those, or the code against this guide.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tool errors say `fetch failed` / `ECONNREFUSED` | The REST API on `:3001` isn't running | Start it: `npm run server:start` |
| `list_projects` returns `[]` but the UI shows projects | The MCP server and the UI are talking to different API instances or databases | Check `SYNCRO_API_URL` and `SYNCRO_DB_PATH` on both |
| Tool error `Project not found: <id>` | Stale id (the project was deleted or re-created) | Re-run `list_projects` for current ids |
| HTTP client can't connect | The HTTP server binds `127.0.0.1` with host-allowlist protection | Use `localhost` or `127.0.0.1` in the client URL, not another host name |
| Port 3010 already in use | Another `mcp:http` instance is running | `--port=<n>` or `SYNCRO_MCP_PORT` to move it |
| Client shows no tools | The client spawned `npm` somewhere the repo isn't | Use the `--prefix` form, or a client that honors `cwd` |
| Agent "sees" nothing but logs look chatty | Logs on stdout corrupt the stdio protocol | The Syncro server already logs to stderr only; if you wrap it, keep your own logs off stdout |
