/**
 * End-to-End Integration Tests — Full tool flow with Golden Dataset.
 *
 * Tests the complete lifecycle: ingest → search → find → compose → decompose → curate → emerge → dissolve
 * Uses SQLite backend + NoneEmbedding for reproducibility without external deps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteAdapter } from '../storage/sqlite.js';
import { find } from '../search/find.js';
import { emerge } from '../emerge/emerge.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import { GOLDEN_MEMORIES, GOLDEN_OWNER, EXPIRED_MEMORIES, fakeEmbedding } from '../__fixtures__/golden-dataset.js';
import type { Category } from '../types.js';

function tempDb(): string {
  return join(tmpdir(), `brain-e2e-test-${randomUUID()}.db`);
}

class NoneEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'none' as const;
  readonly dimensions = 0;
  async embed(): Promise<number[]> { return []; }
}

describe('E2E: Full Memory Lifecycle', () => {
  let adapter: SQLiteAdapter;
  let embed: NoneEmbeddingProvider;

  beforeEach(async () => {
    adapter = new SQLiteAdapter(tempDb());
    await adapter.initialize();
    embed = new NoneEmbeddingProvider();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('should support complete lifecycle: ingest → search → curate → dissolve', async () => {
    // 1. Ingest
    const memory = await adapter.insert({
      owner: GOLDEN_OWNER,
      category: 'signal' as Category,
      title: 'Test Signal',
      content: 'This is a test signal for the e2e lifecycle.',
      domain: 'testing',
      tags: ['test', 'e2e'],
      importance: 5,
    });
    expect(memory.id).toBeDefined();

    // 2. Search (scan)
    const searchResults = await adapter.scan({
      owner: GOLDEN_OWNER,
      category: 'signal' as Category,
    });
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].id).toBe(memory.id);

    // 3. Find (fulltext)
    const findResults = await find('test signal', adapter, embed);
    expect(findResults.length).toBeGreaterThan(0);
    expect(findResults[0].id).toBe(memory.id);

    // 4. Curate
    const updated = await adapter.update(memory.id, {
      importance: 9,
      tags: ['test', 'e2e', 'updated'],
      domain: 'testing-updated',
    });
    expect(updated.importance).toBe(9);
    expect(updated.tags).toContain('updated');
    expect(updated.domain).toBe('testing-updated');

    // 5. Verify update persisted
    const fetched = await adapter.getById(memory.id);
    expect(fetched!.importance).toBe(9);

    // 6. Dissolve
    const dissolved = await adapter.delete(memory.id);
    expect(dissolved.id).toBe(memory.id);

    // 7. Verify deletion
    const gone = await adapter.getById(memory.id);
    expect(gone).toBeNull();
  });

  it('should populate from golden dataset and query across categories', async () => {
    // Seed entire golden dataset
    const inserted = [];
    for (const m of GOLDEN_MEMORIES) {
      inserted.push(await adapter.insert(m));
    }
    expect(inserted.length).toBe(GOLDEN_MEMORIES.length);

    // Verify stats
    const stats = await adapter.stats(GOLDEN_OWNER);
    const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
    expect(totalCount).toBe(GOLDEN_MEMORIES.length);

    // Verify all 10 categories are present
    const categories = stats.map(s => s.category).sort();
    expect(categories).toContain('signal');
    expect(categories).toContain('anchor');
    expect(categories).toContain('spark');
    expect(categories).toContain('thread');
    expect(categories).toContain('mirror');
    expect(categories).toContain('terrain');
    expect(categories).toContain('node');
    expect(categories).toContain('artifact');
    expect(categories).toContain('north');
    expect(categories).toContain('echo');

    // Cross-category search
    const aiMemories = await adapter.scan({ domain: 'ai' });
    expect(aiMemories.length).toBeGreaterThan(0);
    const aiCategories = new Set(aiMemories.map(m => m.category));
    expect(aiCategories.size).toBeGreaterThan(1); // Multiple categories in 'ai' domain
  });

  it('should handle compose flow: find sources → synthesize', async () => {
    for (const m of GOLDEN_MEMORIES) {
      await adapter.insert(m);
    }

    // Find sources about AI
    const sources = await find('AI strategy', adapter, embed);
    expect(sources.length).toBeGreaterThan(0);

    // Simulate compose: create synthesis memory from sources
    const synthesisContent = sources
      .map(s => `[${s.category}] ${s.title}: ${s.content.slice(0, 100)}`)
      .join('\n');

    const synthesis = await adapter.insert({
      owner: GOLDEN_OWNER,
      category: 'echo' as Category,
      title: 'Synthese: AI Strategy Overview',
      content: synthesisContent,
      tags: ['composed', 'synthesis'],
      importance: 7,
    });

    expect(synthesis.category).toBe('echo');
    expect(synthesis.tags).toContain('composed');

    // Verify it appears in searches
    const found = await find('synthese AI', adapter, embed);
    expect(found.some(r => r.id === synthesis.id)).toBe(true);
  });

  it('should handle decompose flow: topic → grouped report', async () => {
    for (const m of GOLDEN_MEMORIES) {
      await adapter.insert(m);
    }

    // Decompose: find all memories about a topic
    const topic = 'strategy';
    const results = await find(topic, adapter, embed);

    // Group by category (like decompose does)
    const grouped = new Map<string, typeof results>();
    for (const m of results) {
      if (!grouped.has(m.category)) grouped.set(m.category, []);
      grouped.get(m.category)!.push(m);
    }

    expect(grouped.size).toBeGreaterThan(0);
  });

  it('should handle emerge flow with expired memories', async () => {
    for (const m of GOLDEN_MEMORIES) {
      await adapter.insert(m);
    }
    for (const m of EXPIRED_MEMORIES) {
      await adapter.insert(m);
    }

    const report = await emerge(adapter, embed, GOLDEN_OWNER);

    // Should find expired memories in stale
    expect(report.stale.length).toBeGreaterThan(0);
    expect(report.stale.some(m => m.title.includes('Expired'))).toBe(true);

    // Report should be valid markdown
    expect(report.summary).toContain('# Emerge Report');
  });

  it('should handle snapshot for context delivery', async () => {
    for (const m of GOLDEN_MEMORIES) {
      await adapter.insert(m);
    }

    const snapshot = await adapter.snapshot(GOLDEN_OWNER, 'ai');
    expect(snapshot.length).toBeGreaterThan(0);

    // All should be in 'ai' domain
    for (const m of snapshot) {
      expect(m.domain).toBe('ai');
    }

    // Should be sorted by importance
    for (let i = 1; i < snapshot.length; i++) {
      expect(snapshot[i - 1].importance).toBeGreaterThanOrEqual(snapshot[i].importance);
    }
  });

  it('should maintain FTS consistency across updates and deletes', async () => {
    const mem = await adapter.insert({
      owner: GOLDEN_OWNER,
      category: 'signal' as Category,
      title: 'Original Unique Title',
      content: 'Searching for xylophone in the moonlight.',
      tags: [],
      importance: 5,
    });

    // FTS should find it
    let results = await adapter.fulltext('xylophone');
    expect(results.length).toBe(1);

    // Update content
    await adapter.update(mem.id, {
      content: 'Now searching for accordion in the sunlight.',
    });

    // Old term should not match
    results = await adapter.fulltext('xylophone');
    expect(results.length).toBe(0);

    // New term should match
    results = await adapter.fulltext('accordion');
    expect(results.length).toBe(1);

    // Delete
    await adapter.delete(mem.id);

    // Should not be findable anymore
    results = await adapter.fulltext('accordion');
    expect(results.length).toBe(0);
  });

  it('should handle concurrent inserts without conflicts', async () => {
    const inserts = GOLDEN_MEMORIES.map(m => adapter.insert(m));
    const results = await Promise.all(inserts);

    expect(results.length).toBe(GOLDEN_MEMORIES.length);
    const ids = new Set(results.map(r => r.id));
    expect(ids.size).toBe(GOLDEN_MEMORIES.length); // All unique IDs
  });
});
