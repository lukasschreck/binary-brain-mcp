/**
 * Config Loading — reads ~/.brain/config.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainConfig } from './types.js';

const DEFAULT_DATA_DIR = join(homedir(), '.brain');
const CONFIG_FILE = 'config.json';

const DEFAULT_CONFIG: BrainConfig = {
  storage: 'sqlite',
  embedding: 'none',
  owner: 'user',
  dataDir: DEFAULT_DATA_DIR,
  sqlite: {
    path: join(DEFAULT_DATA_DIR, 'brain.db'),
  },
};

export function loadConfig(configPath?: string): BrainConfig {
  const path = configPath ?? join(DEFAULT_DATA_DIR, CONFIG_FILE);

  if (!existsSync(path)) {
    return DEFAULT_CONFIG;
  }

  const raw = readFileSync(path, 'utf-8');
  const userConfig = JSON.parse(raw) as Partial<BrainConfig>;

  const config: BrainConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  // Resolve ~ in paths
  if (config.dataDir.startsWith('~')) {
    config.dataDir = config.dataDir.replace('~', homedir());
  }
  if (config.sqlite?.path.startsWith('~')) {
    config.sqlite.path = config.sqlite.path.replace('~', homedir());
  }

  return config;
}

export function getConfigPath(): string {
  return join(DEFAULT_DATA_DIR, CONFIG_FILE);
}

export { DEFAULT_DATA_DIR };
