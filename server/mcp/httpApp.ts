import { randomUUID } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

export interface StartMcpHttpOptions {
  /** Builds the MCP server instance to serve; one instance per session. */
  createServer: () => McpServer;
  /** Requested port; 0 picks an ephemeral port. */
  port: number;
  /** Bind address. Defaults to loopback — the MCP surface stays local. */
  host?: string;
}

export interface RunningMcpHttpServer {
  /** The actually-bound port (differs from the request when port 0 was passed). */
  port: number;
  close(): Promise<void>;
}

const MCP_ENDPOINT = '/mcp';

/**
 * Serve the Syncro MCP server over streamable HTTP with stateful sessions:
 * POST /mcp for client requests, GET /mcp for the SSE stream, DELETE /mcp to
 * terminate a session. Binds loopback by default with DNS rebinding
 * protection on, so a browser page cannot reach the editor's MCP surface.
 */
export async function startMcpHttpServer(options: StartMcpHttpOptions): Promise<RunningMcpHttpServer> {
  const { createServer, port, host = '127.0.0.1' } = options;
  const app = express();
  app.use(express.json());
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Set once the listener is up, before any request can arrive.
  let boundPort = port;

  const makeTransport = (): StreamableHTTPServerTransport => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
      },
      onsessionclosed: (sessionId) => {
        transports.delete(sessionId);
      },
      enableDnsRebindingProtection: true,
      // The SDK compares the full Host header, port included.
      allowedHosts: ['localhost', `localhost:${boundPort}`, '127.0.0.1', `127.0.0.1:${boundPort}`],
    });
    return transport;
  };

  const respondJsonError = (
    res: express.Response,
    status: number,
    code: number,
    message: string,
  ): void => {
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
  };

  app.post(MCP_ENDPOINT, async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    try {
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) {
          respondJsonError(res, 404, -32001, 'Session not found');
          return;
        }
        await existing.handleRequest(req, res, req.body);
        return;
      }
      // New session: one transport + server instance per session.
      const transport = makeTransport();
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp:http] error handling request:', error);
      if (!res.headersSent) {
        respondJsonError(res, 500, -32603, 'Internal server error');
      }
    }
  });

  const getSession = (
    req: express.Request,
    res: express.Response,
  ): StreamableHTTPServerTransport | undefined => {
    const sessionId = req.header('mcp-session-id');
    if (!sessionId) {
      respondJsonError(res, 400, -32600, 'Missing Mcp-Session-Id header');
      return undefined;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      respondJsonError(res, 404, -32001, 'Session not found');
      return undefined;
    }
    return transport;
  };

  app.get(MCP_ENDPOINT, async (req, res) => {
    const transport = getSession(req, res);
    if (transport) await transport.handleRequest(req, res);
  });

  app.delete(MCP_ENDPOINT, async (req, res) => {
    const transport = getSession(req, res);
    if (transport) await transport.handleRequest(req, res);
  });

  return await new Promise<RunningMcpHttpServer>((resolve, reject) => {
    const httpServer = app.listen(port, host, () => {
      const address = httpServer.address();
      boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: boundPort,
        close: async () => {
          for (const transport of transports.values()) {
            await transport.close();
          }
          transports.clear();
          httpServer.closeAllConnections();
          await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
        },
      });
    });
    httpServer.once('error', reject);
  });
}
