/**
 * PostgresAdapter — Power-User Storage Backend with pgvector.
 *
 * Uses raw `pg` package — no Supabase SDK dependency.
 * Requires PostgreSQL with pgvector extension.
 */

import type { StorageAdapter, MemoryInsert } from './adapter.js';
import type { Memory, MemoryWithSimilarity, ScanFilter, CategoryStats, Category } from '../types.js';
import type { Pool as PgPool } from 'pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pg: any;
try {
  pg = await import('pg');
} catch {
  // pg is optional — will throw when PostgresAdapter is instantiated
}

interface PgRow {
  id: string;
  owner: string;
  category: string;
  title: string;
  content: string;
  raw_content: string | null;
  domain: string | null;
  tags: string[];
  importance: number;
  embedding: string | number[] | null;
  access_count: number;
  last_accessed_at: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  similarity?: string;
  rank?: number;
  count?: number;
  avg_importance?: number;
  latest?: string;
}

export class PostgresAdapter implements StorageAdapter {
  private pool: PgPool;

  constructor(private connectionString: string) {
    if (!pg) {
      throw new Error(
        'PostgreSQL adapter requires the "pg" package. Install it: npm install pg'
      );
    }
    this.pool = new pg.Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          owner TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          raw_content TEXT,
          domain TEXT,
          tags TEXT[] DEFAULT '{}',
          importance SMALLINT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
          embedding vector(256),
          access_count INT DEFAULT 0,
          last_accessed_at TIMESTAMPTZ,
          valid_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Indices
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_owner_category ON memories(owner, category)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags)');

      // IVFFlat index for vector search (only if enough rows exist)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memories_embedding') THEN
            CREATE INDEX idx_memories_embedding ON memories
            USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);
          END IF;
        END $$
      `);

      // Updated_at trigger
      await client.query(`
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'memories_updated_at') THEN
            CREATE TRIGGER memories_updated_at
            BEFORE UPDATE ON memories
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
        END $$
      `);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // --- CRUD ---

  async insert(memory: MemoryInsert): Promise<Memory> {
    const embedding = memory.embedding ? `[${memory.embedding.join(',')}]` : null;
    const result = await this.pool.query(
      `INSERT INTO memories (owner, category, title, content, raw_content, domain, tags, importance, embedding, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        memory.owner, memory.category, memory.title, memory.content,
        memory.raw_content ?? null, memory.domain ?? null,
        memory.tags ?? [], memory.importance ?? 5,
        embedding, memory.valid_until?.toISOString() ?? null,
      ]
    );
    return this.rowToMemory(result.rows[0]);
  }

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (name: string, value: unknown) => {
      fields.push(`${name} = $${paramIdx++}`);
      values.push(value);
    };

    if (updates.title !== undefined) addField('title', updates.title);
    if (updates.content !== undefined) addField('content', updates.content);
    if (updates.raw_content !== undefined) addField('raw_content', updates.raw_content);
    if (updates.category !== undefined) addField('category', updates.category);
    if (updates.domain !== undefined) addField('domain', updates.domain);
    if (updates.tags !== undefined) addField('tags', updates.tags);
    if (updates.importance !== undefined) addField('importance', updates.importance);
    if (updates.embedding !== undefined) addField('embedding', updates.embedding ? `[${updates.embedding.join(',')}]` : null);
    if (updates.valid_until !== undefined) addField('valid_until', updates.valid_until?.toISOString() ?? null);

    if (fields.length === 0) return existing;

    values.push(id);
    const result = await this.pool.query(
      `UPDATE memories SET ${fields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );
    return this.rowToMemory(result.rows[0]);
  }

  async delete(id: string): Promise<Memory> {
    const result = await this.pool.query('DELETE FROM memories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) throw new Error(`Memory ${id} not found`);
    return this.rowToMemory(result.rows[0]);
  }

  async getById(id: string): Promise<Memory | null> {
    const result = await this.pool.query('SELECT * FROM memories WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.rowToMemory(result.rows[0]) : null;
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

    params.push(limit);
    const result = await this.pool.query(
      `SELECT * FROM memories ${where} ORDER BY ${order} LIMIT $${params.length}`,
      params
    );
    return result.rows.map((r: PgRow) => this.rowToMemory(r));
  }

  async fulltext(query: string, filter?: ScanFilter): Promise<Memory[]> {
    const limit = filter?.limit ?? 20;
    const tsQuery = query
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => w.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, ''))
      .filter(Boolean)
      .join(' | ');

    if (!tsQuery) return [];

    const conditions: string[] = [];
    const params: unknown[] = [tsQuery];
    let paramIdx = 2;

    if (filter?.owner) { conditions.push(`owner = $${paramIdx++}`); params.push(filter.owner); }
    if (filter?.category) { conditions.push(`category = $${paramIdx++}`); params.push(filter.category); }
    if (filter?.domain) { conditions.push(`domain = $${paramIdx++}`); params.push(filter.domain); }

    const extraWhere = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

    params.push(limit);
    const result = await this.pool.query(
      `SELECT *, ts_rank(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || coalesce(raw_content,'')), plainto_tsquery('simple', $1)) as rank
       FROM memories
       WHERE to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || coalesce(raw_content,'')) @@ plainto_tsquery('simple', $1)
       ${extraWhere}
       ORDER BY rank DESC
       LIMIT $${paramIdx}`,
      params
    );
    return result.rows.map((r: PgRow) => this.rowToMemory(r));
  }

  async vectorSearch(
    embedding: number[],
    filter?: ScanFilter,
    threshold: number = 0.3
  ): Promise<MemoryWithSimilarity[]> {
    if (embedding.length === 0) return [];

    const vecStr = `[${embedding.join(',')}]`;
    const conditions: string[] = ['embedding IS NOT NULL'];
    const params: unknown[] = [vecStr, threshold];
    let paramIdx = 3;

    if (filter?.owner) { conditions.push(`owner = $${paramIdx++}`); params.push(filter.owner); }
    if (filter?.category) { conditions.push(`category = $${paramIdx++}`); params.push(filter.category); }
    if (filter?.domain) { conditions.push(`domain = $${paramIdx++}`); params.push(filter.domain); }
    conditions.push('(valid_until IS NULL OR valid_until > NOW())');

    const limit = filter?.limit ?? 20;
    params.push(limit);

    const result = await this.pool.query(
      `SELECT *, 1 - (embedding <=> $1) as similarity
       FROM memories
       WHERE ${conditions.join(' AND ')}
         AND 1 - (embedding <=> $1) >= $2
       ORDER BY embedding <=> $1
       LIMIT $${paramIdx}`,
      params
    );

    return result.rows.map((r: PgRow) => ({
      ...this.rowToMemory(r),
      similarity: parseFloat(r.similarity ?? '0'),
    }));
  }

  // --- Bulk ---

  async snapshot(owner: string, domain?: string, limit: number = 50): Promise<Memory[]> {
    const conditions = ['owner = $1', '(valid_until IS NULL OR valid_until > NOW())'];
    const params: unknown[] = [owner];

    if (domain) {
      conditions.push('domain = $2');
      params.push(domain);
    }

    params.push(limit);
    const result = await this.pool.query(
      `SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY importance DESC, created_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map((r: PgRow) => this.rowToMemory(r));
  }

  async stats(owner?: string): Promise<CategoryStats[]> {
    const where = owner ? 'WHERE owner = $1' : '';
    const params = owner ? [owner] : [];

    const result = await this.pool.query(
      `SELECT category, COUNT(*)::int as count, AVG(importance)::float as avg_importance, MAX(created_at) as latest
       FROM memories ${where} GROUP BY category ORDER BY count DESC`,
      params
    );

    return result.rows.map((r: PgRow) => ({
      category: r.category as Category,
      count: r.count ?? 0,
      avg_importance: Math.round((r.avg_importance ?? 0) * 10) / 10,
      latest: new Date(r.latest ?? Date.now()),
    }));
  }

  async forgotten(owner: string, olderThanDays: number, limit: number = 20): Promise<Memory[]> {
    const result = await this.pool.query(
      `SELECT * FROM memories
       WHERE owner = $1
         AND access_count = 0
         AND created_at < NOW() - INTERVAL '1 day' * $2
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY importance DESC, created_at ASC
       LIMIT $3`,
      [owner, olderThanDays, limit]
    );
    return result.rows.map((r: PgRow) => this.rowToMemory(r));
  }

  // --- Helpers ---

  private buildWhereClause(filter?: ScanFilter): { where: string; params: unknown[] } {
    if (!filter) return { where: '', params: [] };

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter.owner) { conditions.push(`owner = $${paramIdx++}`); params.push(filter.owner); }
    if (filter.category) { conditions.push(`category = $${paramIdx++}`); params.push(filter.category); }
    if (filter.domain) { conditions.push(`domain = $${paramIdx++}`); params.push(filter.domain); }
    if (filter.tag) { conditions.push(`$${paramIdx++} = ANY(tags)`); params.push(filter.tag); }
    if (!filter.include_expired) {
      conditions.push('(valid_until IS NULL OR valid_until > NOW())');
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  private rowToMemory(row: PgRow): Memory {
    return {
      id: row.id,
      owner: row.owner,
      category: row.category as Category,
      title: row.title,
      content: row.content,
      raw_content: row.raw_content ?? undefined,
      domain: row.domain ?? undefined,
      tags: row.tags ?? [],
      importance: row.importance,
      embedding: row.embedding ? parseVector(row.embedding) : undefined,
      access_count: row.access_count,
      last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at) : undefined,
      valid_until: row.valid_until ? new Date(row.valid_until) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

function parseVector(vec: string | number[]): number[] {
  if (Array.isArray(vec)) return vec;
  if (typeof vec === 'string') {
    return vec.replace(/[\[\]]/g, '').split(',').map(Number);
  }
  return [];
}
