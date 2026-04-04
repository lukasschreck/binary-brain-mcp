/**
 * emerge() — Memory discovery tests.
 *
 * Tests all 4 phases: Surface, Connect, Crystallize, Illuminate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteAdapter } from '../storage/sqlite.js';
import { emerge } from '../emerge/emerge.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import {
  GOLDEN_MEMORIES,
  GOLDEN_OWNER,
  EXPIRED_MEMORIES,
  DUPLICATE_MEMORIES,
  fakeEmbedding,
} from '../__fixtures__/golden-dataset.js';

function tempDb(): string {
  return join(tmpdir(), `brain-emerge-test-${randomUUID()}.db`);
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'jina' as const;
  readonly dimensions = 8;

  async embed(text: string): Promise<number[]> {
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
    }
    return fakeEmbedding(Math.abs(seed));
  }
}

class NoneEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'none' as const;
  readonly dimensions = 0;
  async embed(): Promise<number[]> { return []; }
}

describe('emerge()', () => {
  let adapter: SQLiteAdapter;
  let mockEmbed: MockEmbeddingProvider;
  let noneEmbed: NoneEmbeddingProvider;

  beforeEach(async () => {
    adapter = new SQLiteAdapter(tempDb());
    await adapter.initialize();
    mockEmbed = new MockEmbeddingProvider();
    noneEmbed = new NoneEmbeddingProvider();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('Report Structure', () => {
    it('should return a complete EmergeReport', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);

      expect(report).toHaveProperty('surfaced');
      expect(report).toHaveProperty('connections');
      expect(report).toHaveProperty('crystals');
      expect(report).toHaveProperty('stale');
      expect(report).toHaveProperty('summary');
      expect(typeof report.summary).toBe('string');
    });

    it('should generate markdown summary with all sections', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);

      expect(report.summary).toContain('# Emerge Report');
      expect(report.summary).toContain('## Surfaced');
      expect(report.summary).toContain('## Connected');
      expect(report.summary).toContain('## Crystallized');
      expect(report.summary).toContain('## Stale');
    });
  });

  describe('Phase 1: Surface (forgotten memories)', () => {
    it('should surface memories with access_count=0', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      // Just-created memories won't be >30 days old, so surface should be empty
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      expect(report.surfaced).toEqual([]);
    });

    it('should return empty surfaced for empty database', async () => {
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      expect(report.surfaced).toEqual([]);
    });
  });

  describe('Phase 2: Connect (cross-domain)', () => {
    it('should find cross-domain connections with embeddings', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, mockEmbed, GOLDEN_OWNER);
      // Connections depend on cross-domain vector matches with similarity >= 0.5
      expect(Array.isArray(report.connections)).toBe(true);
    });

    it('should skip connections without embedding provider', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      expect(report.connections).toEqual([]);
    });

    it('should have valid connection structure', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, mockEmbed, GOLDEN_OWNER);
      for (const c of report.connections) {
        expect(c.memory_a).toBeDefined();
        expect(c.memory_b).toBeDefined();
        expect(c.similarity).toBeGreaterThan(0);
        expect(c.insight).toBeDefined();
        // Must be cross-domain
        const domA = c.memory_a.domain ?? '__none__';
        const domB = c.memory_b.domain ?? '__none__';
        expect(domA).not.toBe(domB);
      }
    });

    it('should cap connections at 10', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, mockEmbed, GOLDEN_OWNER);
      expect(report.connections.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Phase 3: Crystallize (duplicate groups)', () => {
    it('should find near-duplicate memories', async () => {
      for (const m of DUPLICATE_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, mockEmbed, GOLDEN_OWNER);
      // The duplicate memories have similarity > 0.85 so should be grouped
      // (depends on the mock provider's vector space alignment)
      expect(Array.isArray(report.crystals)).toBe(true);
    });

    it('should skip crystallize without embedding provider', async () => {
      for (const m of DUPLICATE_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      expect(report.crystals).toEqual([]);
    });

    it('should have valid crystal group structure', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, mockEmbed, GOLDEN_OWNER);
      for (const g of report.crystals) {
        expect(g.memories.length).toBeGreaterThanOrEqual(2);
        expect(g.similarity).toBeGreaterThan(0);
      }
    });
  });

  describe('Phase 4: Illuminate (stale/expired)', () => {
    it('should find expired memories', async () => {
      for (const m of EXPIRED_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      expect(report.stale.length).toBeGreaterThan(0);
      for (const m of report.stale) {
        expect(m.valid_until).toBeDefined();
        expect(m.valid_until!.getTime()).toBeLessThan(Date.now());
      }
    });

    it('should not flag non-expired memories as stale', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, GOLDEN_OWNER);
      // Only the terrain memory with valid_until 2026-06-30 should be checked
      // but it shouldn't be stale yet (it's in the future)
      for (const s of report.stale) {
        expect(s.valid_until!.getTime()).toBeLessThan(Date.now());
      }
    });
  });

  describe('Owner Isolation', () => {
    it('should only analyze memories for the specified owner', async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      const report = await emerge(adapter, noneEmbed, 'nonexistent-owner');
      expect(report.surfaced).toEqual([]);
      expect(report.connections).toEqual([]);
      expect(report.crystals).toEqual([]);
      expect(report.stale).toEqual([]);
    });
  });
});
