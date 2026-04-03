/**
 * NoneProvider — No embedding, FTS5/fulltext only.
 * Default provider. Zero config, zero dependencies.
 */

import type { EmbeddingProvider } from './provider.js';

export class NoneProvider implements EmbeddingProvider {
  readonly type = 'none' as const;
  readonly dimensions = 0;

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}
