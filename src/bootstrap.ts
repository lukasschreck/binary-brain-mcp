/**
 * Bootstrap — Factory for StorageAdapter + EmbeddingProvider from config.
 */

import { loadConfig } from './config.js';
import type { BrainConfig } from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import type { EmbeddingProvider } from './embedding/provider.js';
import { SQLiteAdapter } from './storage/sqlite.js';
import { NoneProvider } from './embedding/none.js';

export interface BrainComponents {
  config: BrainConfig;
  storage: StorageAdapter;
  embedding: EmbeddingProvider;
}

export async function bootstrap(configPath?: string): Promise<BrainComponents> {
  const config = loadConfig(configPath);

  // Storage
  const storage = await createStorage(config);
  await storage.initialize();

  // Embedding
  const embedding = await createEmbedding(config);

  return { config, storage, embedding };
}

async function createStorage(config: BrainConfig): Promise<StorageAdapter> {
  switch (config.storage) {
    case 'sqlite': {
      const path = config.sqlite?.path ?? `${config.dataDir}/brain.db`;
      return new SQLiteAdapter(path);
    }
    case 'postgres': {
      if (!config.postgres?.connectionString) {
        throw new Error('PostgreSQL requires postgres.connectionString in config.');
      }
      const { PostgresAdapter } = await import('./storage/postgres.js');
      return new PostgresAdapter(config.postgres.connectionString);
    }
    default:
      throw new Error(`Unknown storage backend: ${config.storage}`);
  }
}

async function createEmbedding(config: BrainConfig): Promise<EmbeddingProvider> {
  switch (config.embedding) {
    case 'none':
      return new NoneProvider();

    case 'jina': {
      if (!config.jina?.apiKey) throw new Error('Jina requires jina.apiKey in config.');
      const { JinaProvider } = await import('./embedding/jina.js');
      return new JinaProvider(config.jina.apiKey, config.jina.dimensions ?? 256);
    }

    case 'openai': {
      if (!config.openai?.apiKey) throw new Error('OpenAI requires openai.apiKey in config.');
      const { OpenAIProvider } = await import('./embedding/openai.js');
      return new OpenAIProvider(config.openai.apiKey, config.openai.dimensions ?? 256);
    }

    case 'ollama': {
      const { OllamaProvider } = await import('./embedding/ollama.js');
      return new OllamaProvider(
        config.ollama?.baseUrl ?? 'http://localhost:11434',
        config.ollama?.model ?? 'nomic-embed-text'
      );
    }

    default:
      throw new Error(`Unknown embedding provider: ${config.embedding}`);
  }
}
