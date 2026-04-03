#!/usr/bin/env node
/**
 * Binary Brain MCP — Setup Wizard.
 * npx binary-brain-mcp init
 */

import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainConfig } from '../src/types.js';

const DATA_DIR = join(homedir(), '.brain');
const CONFIG_PATH = join(DATA_DIR, 'config.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function choose(question: string, options: string[], defaultIndex: number = 0): Promise<string> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? '●' : '○';
    console.log(`  ${marker} ${i + 1}) ${opt}`);
  });
  return new Promise((resolve) => {
    rl.question(`Choice [${defaultIndex + 1}]: `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      resolve(options[idx >= 0 && idx < options.length ? idx : defaultIndex]);
    });
  });
}

async function main() {
  console.log('\n🧠 Binary Brain MCP — Setup\n');

  // Check if already initialized
  if (existsSync(CONFIG_PATH)) {
    const overwrite = await ask('Config already exists. Overwrite? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup aborted.');
      rl.close();
      return;
    }
  }

  // Storage
  const storageChoice = await choose('Storage backend?', [
    'SQLite (zero config, recommended)',
    'PostgreSQL (pgvector, for power users)',
  ], 0);
  const storage = storageChoice.startsWith('SQLite') ? 'sqlite' : 'postgres';

  // Embedding
  const embeddingChoice = await choose('Embedding provider?', [
    'None (keyword search — works great for <1000 memories)',
    'Jina AI (best multilingual quality, needs API key)',
    'OpenAI (if you already have a key)',
    'Ollama (local, needs running Ollama instance)',
  ], 0);

  let embeddingType: BrainConfig['embedding'] = 'none';
  if (embeddingChoice.startsWith('Jina')) embeddingType = 'jina';
  if (embeddingChoice.startsWith('OpenAI')) embeddingType = 'openai';
  if (embeddingChoice.startsWith('Ollama')) embeddingType = 'ollama';

  // Owner
  const owner = await ask('Your name', 'user');

  // Build config
  const config: BrainConfig = {
    storage,
    embedding: embeddingType,
    owner,
    dataDir: DATA_DIR,
  };

  if (storage === 'sqlite') {
    config.sqlite = { path: join(DATA_DIR, 'brain.db') };
  }

  if (storage === 'postgres') {
    const connStr = await ask('PostgreSQL connection string');
    config.postgres = { connectionString: connStr };
  }

  if (embeddingType === 'jina') {
    const apiKey = await ask('Jina API key');
    config.jina = { apiKey, dimensions: 256 };
  }

  if (embeddingType === 'openai') {
    const apiKey = await ask('OpenAI API key');
    config.openai = { apiKey, dimensions: 256 };
  }

  if (embeddingType === 'ollama') {
    const baseUrl = await ask('Ollama base URL', 'http://localhost:11434');
    const model = await ask('Ollama model', 'nomic-embed-text');
    config.ollama = { baseUrl, model };
  }

  // Write config
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\n✅ Created ${CONFIG_PATH}`);

  // Try to update Claude Desktop config
  const claudeConfigPaths = [
    join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
  ];

  for (const claudePath of claudeConfigPaths) {
    if (existsSync(claudePath)) {
      try {
        const existing = JSON.parse(readFileSync(claudePath, 'utf-8'));
        if (!existing.mcpServers) existing.mcpServers = {};
        existing.mcpServers['binary-brain'] = {
          command: 'npx',
          args: ['-y', 'binary-brain-mcp'],
        };
        writeFileSync(claudePath, JSON.stringify(existing, null, 2));
        console.log(`✅ Updated Claude Desktop config: ${claudePath}`);
      } catch {
        console.log(`⚠️  Could not update Claude Desktop config: ${claudePath}`);
      }
      break;
    }
  }

  console.log(`\n🧠 Binary Brain ready.`);
  console.log(`   Storage: ${storage}`);
  console.log(`   Embedding: ${embeddingType}`);
  console.log(`   Owner: ${owner}`);
  console.log(`\nStart a conversation and try: "brain_ingest a new signal"\n`);

  rl.close();
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
