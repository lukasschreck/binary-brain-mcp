#!/usr/bin/env node
/**
 * Binary Brain MCP — HTTP transport.
 * For remote access (Coolify, VPS, Docker).
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { bootstrap } from './bootstrap.js';
import { createBrainServer } from './server.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);

async function main() {
  const { config, storage, embedding } = await bootstrap();

  const app = express();
  app.use(express.json());

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // Health check
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'binary-brain-mcp', sessions: sessions.size });
  });

  // Info
  app.get('/', (_req, res) => {
    res.json({
      name: 'binary-brain-mcp',
      version: '0.1.0',
      storage: config.storage,
      embedding: embedding.type,
      owner: config.owner,
      tools: [
        'brain_ingest', 'brain_compose', 'brain_decompose', 'brain_search',
        'brain_find', 'brain_curate', 'brain_dissolve', 'brain_emerge',
      ],
    });
  });

  // MCP endpoint
  app.all('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    const server = createBrainServer(storage, embedding, config.owner, config.crossRealm ?? null);

    transport.onclose = () => {
      const sid = [...sessions.entries()].find(([, t]) => t === transport)?.[0];
      if (sid) sessions.delete(sid);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Store session after first request (session ID is set by transport)
    const newSessionId = res.getHeader('mcp-session-id') as string | undefined;
    if (newSessionId) {
      sessions.set(newSessionId, transport);
    }
  });

  app.listen(PORT, () => {
    console.log(`Binary Brain MCP running on http://localhost:${PORT}`);
    console.log(`Storage: ${config.storage} | Embedding: ${embedding.type} | Owner: ${config.owner}`);
  });

  process.on('SIGINT', async () => {
    await storage.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Binary Brain MCP HTTP failed to start:', error);
  process.exit(1);
});
