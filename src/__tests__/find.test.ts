/**
 * find() — Unified search tests.
 *
 * Tests FTS + Vector merge, deduplication, ranking, and graceful degradation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteAdapter } from '../storage/sqlite.js';
import { find } from '../search/find.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { GOLDEN_MEMORIES, GOLDEN_OWNER, fakeEmbedding } from '../__fixtures__/golden-dataset.js';
import type { Category } from '../types.js';

function tempDb(): string {
  return join(tmpdir(), `brain-find-test-${randomUUID()}.db`);
}

/** Mock embedding provider that returns deterministic vectors */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'jina' as const;
  readonly dimensions = 8;

  async embed(text: string): Promise<number[]> {
    // Simple hash-based: use text length as seed
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
    }
    return fakeEmbedding(Math.abs(seed));
  }
}

/** No-op embedding provider */
class NoneEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'none' as const;
  readonly dimensions = 0;

  async embed(): Promise<number[]> {
    return [];
  }
}

describe('find()', () => {
  let adapter: SQLiteAdapter;
  let mockEmbed: MockEmbeddingProvider;
  let noneEmbed: NoneEmbeddingProvider;

  beforeEach(async () => {
    adapter = new SQLiteAdapter(tempDb());
    await adapter.initialize();
    mockEmbed = new MockEmbeddingProvider();
    noneEmbed = new NoneEmbeddingProvider();

    for (const m of GOLDEN_MEMORIES) {
      await adapter.insert(m);
    }
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should return results combining FTS and vector', async () => {
    const results = await find('Claude AI', adapter, mockEmbed);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should tag results with match_source', async () => {
    const results = await find('Supabase', adapter, mockEmbed);
    for (const r of results) {
      expect(['vector', 'fulltext']).toContain(r.match_source);
    }
  });

  it('should deduplicate results appearing in both FTS and vector', async () => {
    const results = await find('Claude', adapter, mockEmbed);
    const ids = results.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should rank vector results before fulltext', async () => {
    const results = await find('Claude AI', adapter, mockEmbed);
    if (results.length >= 2) {
      const firstVectorIdx = results.findIndex(r => r.match_source === 'vector');
      const lastFulltextIdx = results.findLastIndex(r => r.match_source === 'fulltext');
      if (firstVectorIdx >= 0 && lastFulltextIdx >= 0) {
        // All vector results should come before fulltext results
        const vectorIndices = results.map((r, i) => r.match_source === 'vector' ? i : -1).filter(i => i >= 0);
        const fulltextIndices = results.map((r, i) => r.match_source === 'fulltext' ? i : -1).filter(i => i >= 0);
        if (vectorIndices.length > 0 && fulltextIndices.length > 0) {
          expect(Math.max(...vectorIndices)).toBeLessThan(Math.min(...fulltextIndices));
        }
      }
    }
  });

  it('should work with none embedding (FTS only)', async () => {
    const results = await find('Futursonanz', adapter, noneEmbed);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.match_source).toBe('fulltext');
    }
  });

  it('should respect limit', async () => {
    const results = await find('AI', adapter, mockEmbed, { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should respect category filter', async () => {
    const results = await find('AI', adapter, mockEmbed, { category: 'signal' as Category });
    for (const r of results) {
      expect(r.category).toBe('signal');
    }
  });

  it('should respect owner filter', async () => {
    const results = await find('AI', adapter, mockEmbed, { owner: GOLDEN_OWNER });
    for (const r of results) {
      expect(r.owner).toBe(GOLDEN_OWNER);
    }
  });

  it('should return empty for gibberish query', async () => {
    const results = await find('xyzqwerty999', adapter, noneEmbed);
    expect(results.length).toBe(0);
  });

  it('should include similarity score for vector matches', async () => {
    const results = await find('AI automation', adapter, mockEmbed);
    const vectorResults = results.filter(r => r.match_source === 'vector');
    for (const r of vectorResults) {
      expect(r.similarity).toBeDefined();
      expect(r.similarity).toBeGreaterThan(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    }
  });
});
