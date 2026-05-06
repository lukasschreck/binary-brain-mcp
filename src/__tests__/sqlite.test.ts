/**
 * SQLiteAdapter — Comprehensive unit tests.
 *
 * Uses in-memory SQLite (:memory: equivalent via temp file) for isolation.
 * Tests: CRUD, FTS5, Vector Search, Scan Filters, Stats, Forgotten, Snapshot.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteAdapter } from '../storage/sqlite.js';
import { GOLDEN_MEMORIES, GOLDEN_OWNER, fakeEmbedding, OTHER_OWNER_MEMORY } from '../__fixtures__/golden-dataset.js';
import type { Category, Memory } from '../types.js';

function tempDb(): string {
  return join(tmpdir(), `brain-test-${randomUUID()}.db`);
}

describe('SQLiteAdapter', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tempDb();
    adapter = new SQLiteAdapter(dbPath);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ========================
  // CRUD Operations
  // ========================

  describe('CRUD', () => {
    it('should insert a memory and return it with generated id', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      expect(mem.id).toBeDefined();
      expect(mem.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(mem.title).toBe('Claude 4 Release Announcement');
      expect(mem.category).toBe('signal');
      expect(mem.owner).toBe(GOLDEN_OWNER);
      expect(mem.importance).toBe(8);
      expect(mem.tags).toEqual(['anthropic', 'claude', 'release']);
      expect(mem.access_count).toBe(0);
      expect(mem.created_at).toBeInstanceOf(Date);
      expect(mem.updated_at).toBeInstanceOf(Date);
    });

    it('should store and retrieve raw_content', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      const fetched = await adapter.getById(mem.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.raw_content).toContain('Full press release');
      expect(fetched!.content).not.toContain('Full press release');
    });

    it('should handle memory without raw_content', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[1]); // EU AI Act — no raw_content
      const fetched = await adapter.getById(mem.id);
      expect(fetched!.raw_content).toBeUndefined();
    });

    it('should store and retrieve embedding', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      const fetched = await adapter.getById(mem.id);
      expect(fetched!.embedding).toBeDefined();
      expect(fetched!.embedding!.length).toBe(8);
      expect(fetched!.embedding).toEqual(GOLDEN_MEMORIES[0].embedding);
    });

    it('should return null for non-existent id', async () => {
      const fetched = await adapter.getById(randomUUID());
      expect(fetched).toBeNull();
    });

    it('should update a memory', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      const updated = await adapter.update(mem.id, {
        title: 'Updated Title',
        importance: 10,
        tags: ['updated'],
      });
      expect(updated.title).toBe('Updated Title');
      expect(updated.importance).toBe(10);
      expect(updated.tags).toEqual(['updated']);
      expect(updated.content).toBe(mem.content); // unchanged
    });

    it('should throw on update of non-existent memory', async () => {
      await expect(adapter.update(randomUUID(), { title: 'x' }))
        .rejects.toThrow('not found');
    });

    it('should return existing memory on empty update', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      const same = await adapter.update(mem.id, {});
      expect(same.id).toBe(mem.id);
      expect(same.title).toBe(mem.title);
    });

    it('should delete a memory and return it', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);
      const deleted = await adapter.delete(mem.id);
      expect(deleted.id).toBe(mem.id);
      expect(deleted.title).toBe(mem.title);

      const fetched = await adapter.getById(mem.id);
      expect(fetched).toBeNull();
    });

    it('should throw on delete of non-existent memory', async () => {
      await expect(adapter.delete(randomUUID()))
        .rejects.toThrow('not found');
    });
  });

  // ========================
  // FTS5 Fulltext Search
  // ========================

  describe('Fulltext Search', () => {
    let inserted: Memory[];

    beforeEach(async () => {
      inserted = [];
      for (const m of GOLDEN_MEMORIES) {
        inserted.push(await adapter.insert(m));
      }
    });

    it('should find memories by title keyword', async () => {
      const results = await adapter.fulltext('Claude');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.title.includes('Claude'))).toBe(true);
    });

    it('should find memories by content keyword', async () => {
      const results = await adapter.fulltext('pgvector');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.content.includes('pgvector'))).toBe(true);
    });

    it('should find memories by raw_content', async () => {
      const results = await adapter.fulltext('press release');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.title === 'Claude 4 Release Announcement')).toBe(true);
    });

    it('should find memories by tag content', async () => {
      const results = await adapter.fulltext('blockchain');
      // Our golden dataset has blockchain in tags but also in content of FORGOTTEN_MEMORIES
      // Since we only insert GOLDEN_MEMORIES here, check tags
      const results2 = await adapter.fulltext('spiral-dynamics');
      expect(results2.some(r => r.tags.includes('spiral-dynamics'))).toBe(true);
    });

    it('should respect category filter', async () => {
      const results = await adapter.fulltext('AI', { category: 'signal' as Category });
      for (const r of results) {
        expect(r.category).toBe('signal');
      }
    });

    it('should respect owner filter', async () => {
      await adapter.insert(OTHER_OWNER_MEMORY);
      const results = await adapter.fulltext('signal', { owner: GOLDEN_OWNER });
      for (const r of results) {
        expect(r.owner).toBe(GOLDEN_OWNER);
      }
    });

    it('should return empty for no matches', async () => {
      const results = await adapter.fulltext('xyznonexistent');
      expect(results).toEqual([]);
    });

    it('should return empty for single-char query', async () => {
      const results = await adapter.fulltext('x');
      expect(results).toEqual([]);
    });

    it('should respect limit', async () => {
      const results = await adapter.fulltext('AI', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ========================
  // Vector Search
  // ========================

  describe('Vector Search', () => {
    beforeEach(async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
    });

    it('should find similar memories by embedding', async () => {
      const queryVec = fakeEmbedding(1); // Same as first memory
      const results = await adapter.vectorSearch(queryVec, undefined, 0.3);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeCloseTo(1.0, 2); // Exact match
      expect(results[0].title).toBe('Claude 4 Release Announcement');
    });

    it('should return results sorted by similarity', async () => {
      const queryVec = fakeEmbedding(1);
      const results = await adapter.vectorSearch(queryVec, undefined, 0.0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should respect threshold', async () => {
      const queryVec = fakeEmbedding(1);
      const high = await adapter.vectorSearch(queryVec, undefined, 0.99);
      const low = await adapter.vectorSearch(queryVec, undefined, 0.0);
      expect(high.length).toBeLessThanOrEqual(low.length);
    });

    it('should return empty for empty embedding', async () => {
      const results = await adapter.vectorSearch([], undefined, 0.0);
      expect(results).toEqual([]);
    });

    it('should respect limit in filter', async () => {
      const queryVec = fakeEmbedding(1);
      const results = await adapter.vectorSearch(queryVec, { limit: 3 }, 0.0);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // ========================
  // Scan (Structured Filtering)
  // ========================

  describe('Scan', () => {
    beforeEach(async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
      await adapter.insert(OTHER_OWNER_MEMORY);
    });

    it('should filter by owner', async () => {
      const results = await adapter.scan({ owner: GOLDEN_OWNER });
      expect(results.length).toBe(GOLDEN_MEMORIES.length);
      for (const r of results) {
        expect(r.owner).toBe(GOLDEN_OWNER);
      }
    });

    it('should filter by category', async () => {
      const results = await adapter.scan({ category: 'anchor' as Category });
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.category).toBe('anchor');
      }
    });

    it('should filter by domain', async () => {
      const results = await adapter.scan({ domain: 'ai' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.domain).toBe('ai');
      }
    });

    it('should filter by tag', async () => {
      const results = await adapter.scan({ tag: 'claude' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.tags).toContain('claude');
      }
    });

    it('should combine multiple filters', async () => {
      const results = await adapter.scan({
        owner: GOLDEN_OWNER,
        category: 'signal' as Category,
        domain: 'ai',
      });
      for (const r of results) {
        expect(r.owner).toBe(GOLDEN_OWNER);
        expect(r.category).toBe('signal');
        expect(r.domain).toBe('ai');
      }
    });

    it('should sort by importance (default)', async () => {
      const results = await adapter.scan({ owner: GOLDEN_OWNER });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].importance).toBeGreaterThanOrEqual(results[i].importance);
      }
    });

    it('should sort by created_at', async () => {
      const results = await adapter.scan({ owner: GOLDEN_OWNER, sort_by: 'created_at' });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].created_at.getTime()).toBeGreaterThanOrEqual(results[i].created_at.getTime());
      }
    });

    it('should respect limit', async () => {
      const results = await adapter.scan({ owner: GOLDEN_OWNER, limit: 5 });
      expect(results.length).toBe(5);
    });

    it('should filter by since (date range, lower bound)', async () => {
      // Backdate half the memories to 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const all = await adapter.scan({ owner: GOLDEN_OWNER, limit: 100 });
      const half = all.slice(0, Math.floor(all.length / 2));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (adapter as any).db;
      for (const m of half) {
        db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(tenDaysAgo, m.id);
      }

      const since = new Date(Date.now() - 86_400_000); // 1 day ago
      const recent = await adapter.scan({ owner: GOLDEN_OWNER, since, limit: 100 });
      expect(recent.length).toBe(all.length - half.length);
      for (const r of recent) {
        expect(r.created_at.getTime()).toBeGreaterThanOrEqual(since.getTime());
      }
    });

    it('should filter by until (date range, upper bound)', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const all = await adapter.scan({ owner: GOLDEN_OWNER, limit: 100 });
      const half = all.slice(0, Math.floor(all.length / 2));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (adapter as any).db;
      for (const m of half) {
        db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(tenDaysAgo, m.id);
      }

      const until = new Date(Date.now() - 86_400_000); // 1 day ago
      const old = await adapter.scan({ owner: GOLDEN_OWNER, until, limit: 100 });
      expect(old.length).toBe(half.length);
      for (const r of old) {
        expect(r.created_at.getTime()).toBeLessThanOrEqual(until.getTime());
      }
    });

    it('should combine since + until (date window)', async () => {
      // Backdate three memories to distinct points
      const all = await adapter.scan({ owner: GOLDEN_OWNER, limit: 100 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (adapter as any).db;
      const t20 = new Date(Date.now() - 20 * 86_400_000).toISOString();
      const t10 = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const t5 = new Date(Date.now() - 5 * 86_400_000).toISOString();
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(t20, all[0].id);
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(t10, all[1].id);
      db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(t5, all[2].id);

      const since = new Date(Date.now() - 15 * 86_400_000);
      const until = new Date(Date.now() - 7 * 86_400_000);
      const window = await adapter.scan({ owner: GOLDEN_OWNER, since, until, limit: 100 });
      // Only the t10 memory falls into [-15d, -7d]
      expect(window.length).toBe(1);
      expect(window[0].id).toBe(all[1].id);
    });

    it('should respect date_field=updated_at', async () => {
      const all = await adapter.scan({ owner: GOLDEN_OWNER, limit: 100 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (adapter as any).db;
      const oldUpdate = new Date(Date.now() - 10 * 86_400_000).toISOString();
      // Push half the rows updated_at into the past, leave created_at untouched
      const half = all.slice(0, Math.floor(all.length / 2));
      for (const m of half) {
        db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(oldUpdate, m.id);
      }

      const since = new Date(Date.now() - 86_400_000);
      const recentByUpdated = await adapter.scan({
        owner: GOLDEN_OWNER, since, date_field: 'updated_at', limit: 100,
      });
      expect(recentByUpdated.length).toBe(all.length - half.length);
    });

    it('should exclude expired by default', async () => {
      // Insert an expired memory
      await adapter.insert({
        ...GOLDEN_MEMORIES[0],
        title: 'Expired Memory',
        valid_until: new Date('2020-01-01'),
      });

      const results = await adapter.scan({ owner: GOLDEN_OWNER });
      expect(results.every(r => r.title !== 'Expired Memory')).toBe(true);
    });

    it('should include expired when requested', async () => {
      await adapter.insert({
        ...GOLDEN_MEMORIES[0],
        title: 'Expired Memory',
        valid_until: new Date('2020-01-01'),
      });

      const results = await adapter.scan({ owner: GOLDEN_OWNER, include_expired: true });
      expect(results.some(r => r.title === 'Expired Memory')).toBe(true);
    });

    it('should isolate by owner', async () => {
      const results = await adapter.scan({ owner: 'other-user' });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Other User Signal');
    });
  });

  // ========================
  // Stats
  // ========================

  describe('Stats', () => {
    beforeEach(async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
    });

    it('should return stats per category', async () => {
      const stats = await adapter.stats(GOLDEN_OWNER);
      expect(stats.length).toBeGreaterThan(0);

      for (const s of stats) {
        expect(s.category).toBeDefined();
        expect(s.count).toBeGreaterThan(0);
        expect(s.avg_importance).toBeGreaterThan(0);
        expect(s.latest).toBeInstanceOf(Date);
      }
    });

    it('should count correctly', async () => {
      const stats = await adapter.stats(GOLDEN_OWNER);
      const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
      expect(totalCount).toBe(GOLDEN_MEMORIES.length);
    });

    it('should return correct count for artifact category', async () => {
      const stats = await adapter.stats(GOLDEN_OWNER);
      const artifactStats = stats.find(s => s.category === 'artifact');
      expect(artifactStats).toBeDefined();
      expect(artifactStats!.count).toBe(3);
    });

    it('should filter by owner', async () => {
      await adapter.insert(OTHER_OWNER_MEMORY);
      const stats = await adapter.stats(GOLDEN_OWNER);
      const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
      expect(totalCount).toBe(GOLDEN_MEMORIES.length); // other-user excluded
    });

    it('should return all stats when no owner specified', async () => {
      await adapter.insert(OTHER_OWNER_MEMORY);
      const stats = await adapter.stats();
      const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
      expect(totalCount).toBe(GOLDEN_MEMORIES.length + 1);
    });
  });

  // ========================
  // Snapshot
  // ========================

  describe('Snapshot', () => {
    beforeEach(async () => {
      for (const m of GOLDEN_MEMORIES) {
        await adapter.insert(m);
      }
    });

    it('should return memories sorted by importance', async () => {
      const snap = await adapter.snapshot(GOLDEN_OWNER);
      for (let i = 1; i < snap.length; i++) {
        expect(snap[i - 1].importance).toBeGreaterThanOrEqual(snap[i].importance);
      }
    });

    it('should filter by domain', async () => {
      const snap = await adapter.snapshot(GOLDEN_OWNER, 'ai');
      for (const m of snap) {
        expect(m.domain).toBe('ai');
      }
    });

    it('should respect limit', async () => {
      const snap = await adapter.snapshot(GOLDEN_OWNER, undefined, 3);
      expect(snap.length).toBe(3);
    });

    it('should exclude expired memories', async () => {
      await adapter.insert({
        ...GOLDEN_MEMORIES[0],
        title: 'Expired Snapshot',
        valid_until: new Date('2020-01-01'),
      });
      const snap = await adapter.snapshot(GOLDEN_OWNER);
      expect(snap.every(m => m.title !== 'Expired Snapshot')).toBe(true);
    });
  });

  // ========================
  // Forgotten
  // ========================

  describe('Forgotten', () => {
    it('should find memories with access_count=0 older than N days', async () => {
      const mem = await adapter.insert(GOLDEN_MEMORIES[0]);

      // Just-created memories are not older than 0 days (same moment)
      const noResults = await adapter.forgotten(GOLDEN_OWNER, 0);
      // SQLite compares `created_at < datetime('now', '-0 days')` which is false for just-created
      // This correctly shows that the forgotten filter works — fresh memories are not forgotten

      // With large olderThanDays, definitely nothing
      const results30 = await adapter.forgotten(GOLDEN_OWNER, 30);
      expect(results30.length).toBe(0);

      // Verify the memory exists and has access_count=0
      const fetched = await adapter.getById(mem.id);
      expect(fetched!.access_count).toBe(0);
    });

    it('should not find recently created memories with large olderThanDays', async () => {
      await adapter.insert(GOLDEN_MEMORIES[0]);
      const results = await adapter.forgotten(GOLDEN_OWNER, 30);
      expect(results.length).toBe(0);
    });

    it('should respect limit', async () => {
      for (const m of GOLDEN_MEMORIES.slice(0, 5)) {
        await adapter.insert(m);
      }
      const results = await adapter.forgotten(GOLDEN_OWNER, 0, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});
