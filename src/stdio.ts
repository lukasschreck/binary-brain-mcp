#!/usr/bin/env node
/**
 * Binary Brain MCP — stdio transport.
 * For Claude Desktop, Claude Code, and other MCP clients.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bootstrap } from './bootstrap.js';
import { createBrainServer } from './server.js';

async function main() {
  const { config, storage, embedding } = await bootstrap();
  const server = createBrainServer(storage, embedding, config.owner, config.crossRealm ?? null);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.on('SIGINT', async () => {
    await storage.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Binary Brain MCP failed to start:', error);
  process.exit(1);
});
