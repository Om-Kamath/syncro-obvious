/**
 * CLI/env parsing for the MCP HTTP server. Pure and unit-tested; the entry
 * files only apply the result.
 */

export const DEFAULT_MCP_HTTP_PORT = 3010;

/**
 * Resolve the HTTP port: the `--port` flag wins, then the `SYNCRO_MCP_PORT`
 * env var, then the default. Throws on a non-integer or out-of-range value —
 * a typo'd flag must fail loudly rather than silently start on the default.
 */
export function resolveMcpHttpPort(argv: string[], envPort?: string): number {
  const flag = parsePortFlag(argv);
  if (flag !== undefined) return flag;
  if (envPort === undefined || envPort.trim() === '') return DEFAULT_MCP_HTTP_PORT;
  return parsePortValue(envPort);
}

/** Extract the value of `--port=<n>` or `--port <n>` from an argv list. */
export function parsePortFlag(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error('--port requires a value, e.g. --port=3010');
      }
      return parsePortValue(next);
    }
    if (arg.startsWith('--port=')) {
      return parsePortValue(arg.slice('--port='.length));
    }
  }
  return undefined;
}

function parsePortValue(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid MCP port "${raw}" — must be an integer between 1 and 65535.`);
  }
  return port;
}
