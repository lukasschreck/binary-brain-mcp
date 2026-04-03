/**
 * SQLiteAdapter — Zero-Config Storage Backend.
 *
 * Uses better-sqlite3 with FTS5 for fulltext search.
 * Optional in-memory cosine similarity for vector search (up to ~5000 memories).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StorageAdapter, MemoryInsert } from './adapter.js';
import type { Memory, MemoryWithSimilarity, ScanFilter, CategoryStats, Category } from '../types.js';

export class SQLiteAdapter implements StorageAdapter {
  private db: Database.Database;

  constructor(private dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_content TEXT,
        domain TEXT,
        tags TEXT DEFAULT '[]',
        importance INTEGER DEFAULT 5,
        embedding TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed_at TEXT,
        valid_until TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_owner_category ON memories(owner, category);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
    `);

    // FTS5 virtual table for fulltext search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title, content, raw_content, tags,
        content=memories, content_rowid=rowid
      );
    `);

    // Triggers to keep FTS5 in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content, raw_content, tags)
        VALUES (NEW.rowid, NEW.title, NEW.content, NEW.raw_content, NEW.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, raw_content, tags)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.raw_content, OLD.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content, raw_content, tags)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.raw_content, OLD.tags);
        INSERT INTO memories_fts(rowid, title, content, raw_content, tags)
        VALUES (NEW.rowid, NEW.title, NEW.content, NEW.raw_content, NEW.tags);
      END;
    `);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- CRUD ---

  async insert(memory: MemoryInsert): Promise<Memory> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tags = JSON.stringify(memory.tags ?? []);
    const embedding = memory.embedding ? JSON.stringify(memory.embedding) : null;

    this.db.prepare(`
      INSERT INTO memories (id, owner, category, title, content, raw_content, domain, tags, importance, embedding, valid_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, memory.owner, memory.category, memory.title, memory.content,
      memory.raw_content ?? null, memory.domain ?? null, tags,
      memory.importance ?? 5, embedding, memory.valid_until?.toISOString() ?? null,
      now, now
    );

    return this.mustGetById(id);
  }

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.raw_content !== undefined) { fields.push('raw_content = ?'); values.push(updates.raw_content); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
    if (updates.domain !== undefined) { fields.push('domain = ?'); values.push(updates.domain); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.importance !== undefined) { fields.push('importance = ?'); values.push(updates.importance); }
    if (updates.embedding !== undefined) { fields.push('embedding = ?'); values.push(JSON.stringify(updates.embedding)); }
    if (updates.valid_until !== undefined) { fields.push('valid_until = ?'); values.push(updates.valid_until?.toISOString() ?? null); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.mustGetById(id);
  }

  async delete(id: string): Promise<Memory> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return existing;
  }

  async getById(id: string): Promise<Memory | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as SqliteRow | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  // --- Query ---

  async scan(filter: ScanFilter): Promise<Memory[]> {
    const { where, params } = this.buildWhereClause(filter);
    const sortBy = filter.sort_by ?? 'importance';
    const orderMap: Record<string, string> = {
      importance: 'importance DESC, created_at DESC',
      created_at: 'created_at DESC',
      updated_at: 'updated_at DESC',
      access_count: 'access_count DESC, created_at DESC',
    };
    const order = orderMap[sortBy] ?? 'importance DESC, created_at DESC';
    const limit = filter.limit ?? 20;

    const rows = this.db.prepare(
      `SELECT * FROM memories ${where} ORDER BY ${order} LIMIT ?`
    ).all(...params, limit) as SqliteRow[];

    return rows.map(r => this.rowToMemory(r));
  }

  async fulltext(query: string, filter?: ScanFilter): Promise<Memory[]> {
    const limit = filter?.limit ?? 20;
    const ftsQuery = query
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => `"${w}"`)
      .join(' OR ');

    if (!ftsQuery) return [];

    // Build additional WHERE clauses for filtering
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.owner) { conditions.push('m.owner = ?'); params.push(filter.owner); }
    if (filter?.category) { conditions.push('m.category = ?'); params.push(filter.category); }
    if (filter?.domain) { conditions.push('m.domain = ?'); params.push(filter.domain); }

    const extraWhere = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

    const rows = this.db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ? ${extraWhere}
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, ...params, limit) as SqliteRow[];

    return rows.map(r => this.rowToMemory(r));
  }

  async vectorSearch(
    embedding: number[],
    filter?: ScanFilter,
    threshold: number = 0.3
  ): Promise<MemoryWithSimilarity[]> {
    if (embedding.length === 0) return [];

    // Load all memories with embeddings matching filter
    const { where, params } = this.buildWhereClause(filter);
    const extraCondition = where ? where.replace('WHERE', 'AND') : '';

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE embedding IS NOT NULL ${extraCondition}
    `).all(...params) as SqliteRow[];

    // In-memory cosine similarity
    const results: MemoryWithSimilarity[] = [];
    for (const row of rows) {
      const memEmbedding = JSON.parse(row.embedding as string) as number[];
      const similarity = cosineSimilarity(embedding, memEmbedding);
      if (similarity >= threshold) {
        results.push({ ...this.rowToMemory(row), similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, filter?.limit ?? 20);
  }

  // --- Bulk ---

  async snapshot(owner: string, domain?: string, limit: number = 50): Promise<Memory[]> {
    const conditions = ['owner = ?'];
    const params: unknown[] = [owner];

    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    conditions.push("(valid_until IS NULL OR valid_until > datetime('now'))");

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `).all(...params, limit) as SqliteRow[];

    return rows.map(r => this.rowToMemory(r));
  }

  async stats(owner?: string): Promise<CategoryStats[]> {
    const where = owner ? 'WHERE owner = ?' : '';
    const params = owner ? [owner] : [];

    const rows = this.db.prepare(`
      SELECT category, COUNT(*) as count, AVG(importance) as avg_importance, MAX(created_at) as latest
      FROM memories
      ${where}
      GROUP BY category
      ORDER BY count DESC
    `).all(...params) as Array<{ category: string; count: number; avg_importance: number; latest: string }>;

    return rows.map(r => ({
      category: r.category as Category,
      count: r.count,
      avg_importance: Math.round(r.avg_importance * 10) / 10,
      latest: new Date(r.latest),
    }));
  }

  async forgotten(owner: string, olderThanDays: number, limit: number = 20): Promise<Memory[]> {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE owner = ?
        AND access_count = 0
        AND created_at < datetime('now', ? || ' days')
        AND (valid_until IS NULL OR valid_until > datetime('now'))
      ORDER BY importance DESC, created_at ASC
      LIMIT ?
    `).all(owner, `-${olderThanDays}`, limit) as SqliteRow[];

    return rows.map(r => this.rowToMemory(r));
  }

  // --- Helpers ---

  private mustGetById(id: string): Memory {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as SqliteRow;
    return this.rowToMemory(row);
  }

  private buildWhereClause(filter?: ScanFilter): { where: string; params: unknown[] } {
    if (!filter) return { where: '', params: [] };

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.owner) { conditions.push('owner = ?'); params.push(filter.owner); }
    if (filter.category) { conditions.push('category = ?'); params.push(filter.category); }
    if (filter.domain) { conditions.push('domain = ?'); params.push(filter.domain); }
    if (filter.tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${filter.tag}"%`);
    }
    if (!filter.include_expired) {
      conditions.push("(valid_until IS NULL OR valid_until > datetime('now'))");
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  private rowToMemory(row: SqliteRow): Memory {
    return {
      id: row.id,
      owner: row.owner,
      category: row.category as Category,
      title: row.title,
      content: row.content,
      raw_content: row.raw_content ?? undefined,
      domain: row.domain ?? undefined,
      tags: JSON.parse(row.tags ?? '[]'),
      importance: row.importance,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      access_count: row.access_count,
      last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at) : undefined,
      valid_until: row.valid_until ? new Date(row.valid_until) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

// --- Cosine Similarity ---

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// --- Internal Types ---

interface SqliteRow {
  id: string;
  owner: string;
  category: string;
  title: string;
  content: string;
  raw_content: string | null;
  domain: string | null;
  tags: string;
  importance: number;
  embedding: string | null;
  access_count: number;
  last_accessed_at: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  rank?: number;
}
