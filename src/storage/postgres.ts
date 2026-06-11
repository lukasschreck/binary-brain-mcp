/**
 * PostgresAdapter — Power-User Storage Backend with pgvector.
 *
 * Uses raw `pg` package — no Supabase SDK dependency.
 * Requires PostgreSQL with pgvector extension.
 */

import type {
  StorageAdapter,
  MemoryInsert,
  EntityFindOpts,
  EntityFindResult,
  EntityRecord,
  EntityMention,
  Realm,
  RealmHit,
  MatchedVia,
  CrossRealmSearchOpts,
  CrossRealmSearchResult,
} from './adapter.js';
import type { Memory, MemoryWithSimilarity, ScanFilter, CategoryStats, Category } from '../types.js';
import {
  clamp01,
  foldExternalHits,
  assembleResult,
  type EntityRef,
} from '../search/cross-realm-assemble.js';
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

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

export class PostgresAdapter implements StorageAdapter {
  private pool: PgPool;
  private dimensions: number;

  constructor(private connectionString: string, dimensions: number = 256) {
    if (!pg) {
      throw new Error(
        'PostgreSQL adapter requires the "pg" package. Install it: npm install pg'
      );
    }
    this.dimensions = dimensions;
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
          embedding vector(${this.dimensions}),
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

  // --- Touch ---

  async touch(id: string): Promise<void> {
    await this.pool.query(
      'UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1',
      [id]
    );
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

    const dateField = filter.date_field ?? 'created_at';
    if (filter.since) { conditions.push(`${dateField} >= $${paramIdx++}`); params.push(filter.since.toISOString()); }
    if (filter.until) { conditions.push(`${dateField} <= $${paramIdx++}`); params.push(filter.until.toISOString()); }

    if (!filter.include_expired) {
      conditions.push('(valid_until IS NULL OR valid_until > NOW())');
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  // ---------------------------------------------------------------------
  // Zwischenschicht: entity_find
  // ---------------------------------------------------------------------
  async entityFind(query: string, opts: EntityFindOpts): Promise<EntityFindResult> {
    const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
    const params: unknown[] = [query.trim().toLowerCase()];
    const conds: string[] = [
      `(LOWER(canonical_name) = $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE LOWER(a) = $1))`,
    ];
    let p = 2;
    if (opts.entity_type) {
      conds.push(`entity_type = $${p++}`);
      params.push(opts.entity_type);
    }
    params.push(limit);
    const entityRows = await this.pool.query(
      `SELECT id, canonical_name, entity_type, aliases, notes, world_model_version
       FROM entities
       WHERE ${conds.join(' AND ')}
       ORDER BY canonical_name
       LIMIT $${p}`,
      params,
    );

    if (entityRows.rowCount === 0) {
      return { entities: [], match_count: 0, ambiguous: false };
    }

    const ids: string[] = entityRows.rows.map((r: { id: string }) => r.id);
    const mentionParams: unknown[] = [ids];
    let mp = 2;
    let realmCond = '';
    if (opts.realm_filter && opts.realm_filter.length > 0) {
      realmCond = ` AND realm = ANY($${mp++})`;
      mentionParams.push(opts.realm_filter);
    }
    const mentionRows = await this.pool.query(
      `SELECT entity_id, realm, realm_table, realm_id, realm_field, confidence
       FROM entity_mentions
       WHERE entity_id = ANY($1)${realmCond}
       ORDER BY confidence DESC`,
      mentionParams,
    );

    const byEntity = new Map<string, EntityMention[]>();
    for (const m of mentionRows.rows) {
      const arr = byEntity.get(m.entity_id) ?? [];
      arr.push({
        realm: m.realm,
        realm_table: m.realm_table,
        realm_id: m.realm_id,
        realm_field: m.realm_field ?? null,
        confidence: Number(m.confidence),
      });
      byEntity.set(m.entity_id, arr);
    }

    const entities: EntityRecord[] = entityRows.rows.map((r: {
      id: string;
      canonical_name: string;
      entity_type: EntityRecord['entity_type'];
      aliases: string[] | null;
      notes: string | null;
      world_model_version: string | null;
    }) => ({
      id: r.id,
      canonical_name: r.canonical_name,
      entity_type: r.entity_type,
      aliases: r.aliases ?? [],
      notes: r.notes ?? null,
      world_model_version: r.world_model_version ?? null,
      mentions: byEntity.get(r.id) ?? [],
    }));

    return {
      entities,
      match_count: entities.length,
      ambiguous: entities.length > 1,
    };
  }

  async crossRealmSearch(query: string, opts: CrossRealmSearchOpts): Promise<CrossRealmSearchResult> {
    const realms: Realm[] = opts.realms && opts.realms.length > 0
      ? opts.realms
      : ['brain', 'futursonanz', 'library'];
    const limit = Math.max(1, Math.min(50, opts.limit_per_realm ?? 10));
    const minSim = opts.min_similarity ?? 0.3;
    const FULLTEXT_FLOOR = 0.3;
    const ilikePat = `%${query.trim()}%`;

    const maps: Record<Realm, Map<string, RealmHit>> = {
      brain: new Map(),
      futursonanz: new Map(),
      library: new Map(),
    };
    let brainMemoryIds: string[] = [];

    // --- Brain: Volltext + Vector (bestehende Helfer) ---
    if (realms.includes('brain')) {
      const filter: ScanFilter = { owner: opts.owner, limit };
      const ftsRows = await this.fulltext(query, filter);
      const vecRows = opts.brain_query_embedding && opts.brain_query_embedding.length > 0
        ? await this.vectorSearch(opts.brain_query_embedding, filter, minSim)
        : [];
      for (const m of vecRows) {
        maps.brain.set(m.id, this.brainHit(m, m.similarity, 'embedding'));
      }
      for (const m of ftsRows) {
        const existing = maps.brain.get(m.id);
        if (existing) existing.matched_via = 'both';
        else maps.brain.set(m.id, this.brainHit(m, FULLTEXT_FLOOR, 'fulltext'));
      }
      brainMemoryIds = [...maps.brain.keys()];
    } else if (opts.brain_query_embedding && opts.brain_query_embedding.length > 0) {
      // Brain nicht im Output, aber Vector-Treffer dienen als Resonanz-Pivot für futursonanz/library
      const vecRows = await this.vectorSearch(
        opts.brain_query_embedding, { owner: opts.owner, limit }, minSim,
      );
      brainMemoryIds = vecRows.map((m) => m.id);
    }

    // --- Futursonanz: brain_resonances (Volltext auf signal_title + Resonanz-Pivot) ---
    if (realms.includes('futursonanz')) {
      const rows = await this.pool.query(
        `SELECT DISTINCT ON (signal_id)
           signal_id, signal_title, cosine_similarity, matched_at,
           (signal_title ILIKE $1) AS via_title,
           (memory_id = ANY($2::uuid[])) AS via_embed
         FROM brain_resonances
         WHERE signal_title ILIKE $1 OR memory_id = ANY($2::uuid[])
         ORDER BY signal_id, cosine_similarity DESC
         LIMIT $3`,
        [ilikePat, brainMemoryIds, limit * 3],
      );
      for (const r of rows.rows) {
        const via: MatchedVia = r.via_title && r.via_embed ? 'both' : (r.via_title ? 'fulltext' : 'embedding');
        maps.futursonanz.set(r.signal_id, {
          realm: 'futursonanz',
          realm_id: r.signal_id,
          title: r.signal_title ?? `Signal ${String(r.signal_id).slice(0, 8)}`,
          preview: (r.signal_title ?? '').slice(0, 300),
          created_at: r.matched_at ? new Date(r.matched_at).toISOString() : undefined,
          similarity: clamp01(Number(r.cosine_similarity)),
          matched_via: via,
        });
      }
      // Entity-Mention-Pfad: Signale, die über eine exakt getroffene Entity verlinkt sind
      const mentionSignalIds = await this.entityMentionRealmIds(query, 'futursonanz');
      for (const sid of mentionSignalIds) {
        if (maps.futursonanz.has(sid)) continue;
        maps.futursonanz.set(sid, {
          realm: 'futursonanz',
          realm_id: sid,
          title: `Signal ${sid.slice(0, 8)}`,
          preview: `signals/${sid}`,
          similarity: FULLTEXT_FLOOR,
          matched_via: 'entity_mention',
        });
      }
    }

    // --- Library: library_resonances (owner-scoped, Volltext auf title+passage + Pivot) ---
    if (realms.includes('library')) {
      const rows = await this.pool.query(
        `SELECT DISTINCT ON (book_id)
           book_id, book_title, passage, cosine_similarity, matched_at,
           (book_title ILIKE $1 OR passage ILIKE $1) AS via_text,
           (memory_id = ANY($3::uuid[])) AS via_embed
         FROM library_resonances
         WHERE owner = $2
           AND (book_title ILIKE $1 OR passage ILIKE $1 OR memory_id = ANY($3::uuid[]))
         ORDER BY book_id, cosine_similarity DESC
         LIMIT $4`,
        [ilikePat, opts.owner, brainMemoryIds, limit * 3],
      );
      for (const r of rows.rows) {
        const via: MatchedVia = r.via_text && r.via_embed ? 'both' : (r.via_text ? 'fulltext' : 'embedding');
        maps.library.set(r.book_id, {
          realm: 'library',
          realm_id: r.book_id,
          title: r.book_title ?? 'Unbekanntes Buch',
          preview: (r.passage ?? r.book_title ?? '').slice(0, 300),
          created_at: r.matched_at ? new Date(r.matched_at).toISOString() : undefined,
          similarity: clamp01(Number(r.cosine_similarity)),
          matched_via: via,
        });
      }
    }

    // --- V3 external hits einfalten + Per-Realm-Cap + Entity-Grouping (pure Logik) ---
    foldExternalHits(maps, opts.external_hits, realms);

    if (opts.entity_grouping === false) {
      return assembleResult(query, maps, { entity_grouping: false, limit_per_realm: limit }, new Map());
    }

    // Hits sammeln, um Entities nur für die tatsächlich relevanten realm_ids zu laden.
    const previewHits: RealmHit[] = [];
    for (const realm of ['brain', 'futursonanz', 'library'] as Realm[]) {
      previewHits.push(...maps[realm].values());
    }
    const entityByKey = await this.entitiesForHits(previewHits);
    return assembleResult(query, maps, { entity_grouping: true, limit_per_realm: limit }, entityByKey);
  }

  private brainHit(m: Memory, similarity: number, via: MatchedVia): RealmHit {
    return {
      realm: 'brain',
      realm_id: m.id,
      title: m.title,
      preview: (m.content ?? '').slice(0, 300),
      created_at: m.created_at instanceof Date ? m.created_at.toISOString() : undefined,
      similarity: clamp01(similarity),
      matched_via: via,
    };
  }

  /** Exakt getroffene Entity (canonical/alias = query) → ihre realm_ids im gegebenen Realm. */
  private async entityMentionRealmIds(query: string, realm: Realm): Promise<string[]> {
    const q = query.trim().toLowerCase();
    const res = await this.pool.query(
      `SELECT em.realm_id
       FROM entities e
       JOIN entity_mentions em ON em.entity_id = e.id AND em.realm = $2
       WHERE LOWER(e.canonical_name) = $1
          OR EXISTS (SELECT 1 FROM unnest(e.aliases) a WHERE LOWER(a) = $1)
       ORDER BY em.confidence DESC
       LIMIT 50`,
      [q, realm],
    );
    return res.rows.map((r: { realm_id: string }) => r.realm_id);
  }

  /** Mappt (realm, realm_id) der Hits auf ihre Entity (höchste confidence gewinnt). */
  private async entitiesForHits(hits: RealmHit[]): Promise<Map<string, EntityRef>> {
    const byKey = new Map<string, EntityRef>();
    const byRealm: Partial<Record<Realm, string[]>> = {};
    for (const h of hits) (byRealm[h.realm] ??= []).push(h.realm_id);

    for (const realm of Object.keys(byRealm) as Realm[]) {
      const ids = byRealm[realm]!;
      if (ids.length === 0) continue;
      const res = await this.pool.query(
        `SELECT em.realm, em.realm_id, e.id, e.canonical_name, e.entity_type, e.world_model_version
         FROM entity_mentions em
         JOIN entities e ON e.id = em.entity_id
         WHERE em.realm = $1 AND em.realm_id = ANY($2::text[])
         ORDER BY em.confidence DESC`,
        [realm, ids],
      );
      for (const r of res.rows) {
        const key = `${r.realm}::${r.realm_id}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            id: r.id,
            canonical_name: r.canonical_name,
            entity_type: r.entity_type,
            world_model_version: r.world_model_version ?? null,
          });
        }
      }
    }
    return byKey;
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
