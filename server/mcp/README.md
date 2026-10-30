# Syncro MCP server

A Model Context Protocol server that lets MCP clients (Claude Desktop, custom
agents, inspector sessions) drive Syncro without the UI. It speaks JSON-RPC
over **stdio** and is a thin client of the Syncro REST API — it holds no state
of its own. Diagnostics go to stderr; stdout carries the protocol.

## Tools

| Tool           | Kind    | What it does                                                                                    |
| -------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `list_projects` | read    | List all saved Syncro projects (id, name, timestamps), most recently updated first.             |
| `get_project`   | read    | Get one saved project by id, including its full editor state (clips, voiceover, captions).      |
| `upload_media`  | media   | Upload a local file or base64 bytes to the server (`POST /api/media`).                          |
| `attach_media`  | media   | Attach an uploaded media asset to a saved project as a timeline clip or the project voiceover.  |

Both read tools are annotated `readOnlyHint: true`. Expected failures (unknown
project id, API unreachable) surface as `isError` tool results the calling
agent can react to — they never crash the session.

## Run

```sh
npm run mcp:start   # stdio transport
```

Environment:

- `SYNCRO_SERVER_URL` — Syncro API base URL (default `http://localhost:3001`;
  matches the Express server's default port from `npm run server:dev`).
- `SYNCRO_MCP_MAX_UPLOAD_BYTES` — optional positive-integer cap for
  `upload_media` payloads (default 100 MiB).

## Example MCP client config

```json
{
  "mcpServers": {
    "syncro": {
      "command": "npm",
      "args": ["run", "mcp:start"],
      "cwd": "/path/to/syncro"
    }
  }
}
```

## Tests

`server/mcp/server.test.ts` drives the full tool set in process over an
in-memory transport; `server/mcp/stdio.test.ts` is the scripted inspector
test — it spawns this server as a real subprocess, lists its tools, and calls
`list_projects` / `get_project` end to end against a mock of the projects API.
