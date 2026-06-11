/**
 * StorageAdapter — Interface für alle Storage Backends.
 *
 * SQLite (Default) und PostgreSQL (pgvector) implementieren dieses Interface.
 * Neue Adapter (Obsidian, JSON-File, etc.) können hinzugefügt werden.
 */

import type { Memory, MemoryWithSimilarity, ScanFilter, CategoryStats } from '../types.js';

export type MemoryInsert = Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'access_count' | 'last_accessed_at'>;

export interface StorageAdapter {
  /** Initializes the storage backend (creates tables, indices, etc.) */
  initialize(): Promise<void>;

  /** Closes connections / cleans up resources */
  close(): Promise<void>;

  // --- CRUD ---

  insert(memory: MemoryInsert): Promise<Memory>;
  update(id: string, updates: Partial<Memory>): Promise<Memory>;
  delete(id: string): Promise<Memory>;
  getById(id: string): Promise<Memory | null>;

  // --- Query ---

  /** Structured filtering by owner, category, domain, tags */
  scan(filter: ScanFilter): Promise<Memory[]>;

  /** Fulltext search over title, content, raw_content */
  fulltext(query: string, filter?: ScanFilter): Promise<Memory[]>;

  /** Vector similarity search (requires embeddings) */
  vectorSearch(embedding: number[], filter?: ScanFilter, threshold?: number): Promise<MemoryWithSimilarity[]>;

  // --- Bulk ---

  /** Get memories for decompose/snapshot */
  snapshot(owner: string, domain?: string, limit?: number): Promise<Memory[]>;

  /** Statistics per category */
  stats(owner?: string): Promise<CategoryStats[]>;

  /** Get forgotten memories (access_count=0, older than days) */
  forgotten(owner: string, olderThanDays: number, limit?: number): Promise<Memory[]>;

  /** Increment access_count and update last_accessed_at */
  touch(id: string): Promise<void>;

  // --- Zwischenschicht (Entity-Layer, optional) ---
  //
  // Diese Methoden sind optional und werfen NotSupportedError in SQLite-Backends,
  // wo die Zwischenschicht-Tabellen (entities, entity_mentions, edges, decision_traces)
  // nicht existieren. Postgres-Backend (binarybrain-core) hat sie ab Migration
  // 20260523150000_zwischenschicht_v1.

  /** Find entities by name or alias, return matching entities + their mentions cross-realm. */
  entityFind?(query: string, opts: EntityFindOpts): Promise<EntityFindResult>;

  /**
   * Cross-Realm-Suche über brain/futursonanz/library, gruppiert nach Entity.
   * V2 (depth='resonance'): Brain-Volltext/-Embedding + brain_resonances + library_resonances + entity_mentions.
   * V3 (depth='deep'): die Live-Korpus-Treffer kommen als opts.external_hits rein (von der Edge Function)
   * und werden hier mit den Resonanzschicht-Treffern gemerged, dedupliziert und gemeinsam gruppiert.
   * Nur PostgreSQL-Backend (Zwischenschicht-Tabellen). SQLite wirft NotSupportedError.
   */
  crossRealmSearch?(query: string, opts: CrossRealmSearchOpts): Promise<CrossRealmSearchResult>;
}

export type Realm = 'brain' | 'futursonanz' | 'library';

export type MatchedVia = 'fulltext' | 'embedding' | 'entity_mention' | 'both';

export interface RealmHit {
  realm: Realm;
  realm_id: string;
  title: string;
  preview: string;
  created_at?: string;
  similarity: number;
  matched_via: MatchedVia;
}

export interface CrossRealmGroup {
  entity: {
    id: string;
    canonical_name: string;
    entity_type: EntityRecord['entity_type'];
  };
  hits: RealmHit[];
  summary: string;
}

export interface CrossRealmSearchOpts {
  owner: string;
  realms?: Realm[];
  depth?: 'resonance' | 'deep';
  entity_grouping?: boolean;
  since_days?: number;
  min_similarity?: number;
  limit_per_realm?: number;
  /** 256d Brain-Query-Embedding, im Tool-Layer berechnet. null/undefined → kein Brain-Vector-Pfad. */
  brain_query_embedding?: number[] | null;
  /** V3-Live-Treffer (Edge Function), werden in dieselbe Dedup+Grouping-Pipeline gefaltet. */
  external_hits?: RealmHit[];
}

export interface CrossRealmSearchResult {
  query: string;
  groups: CrossRealmGroup[];
  results: RealmHit[];
  total_hits: number;
  world_model_version: string;
}

export interface EntityFindOpts {
  entity_type?: 'person' | 'organization' | 'concept' | 'book' | 'work' | 'place';
  realm_filter?: Array<'brain' | 'futursonanz' | 'library'>;
  limit?: number;
}

export interface EntityRecord {
  id: string;
  canonical_name: string;
  entity_type: 'person' | 'organization' | 'concept' | 'book' | 'work' | 'place';
  aliases: string[];
  notes: string | null;
  world_model_version: string | null;
  mentions: EntityMention[];
}

export interface EntityMention {
  realm: 'brain' | 'futursonanz' | 'library';
  realm_table: string;
  realm_id: string;
  realm_field: string | null;
  confidence: number;
}

export interface EntityFindResult {
  entities: EntityRecord[];
  match_count: number;
  ambiguous: boolean;
}

export class NotSupportedError extends Error {
  constructor(public readonly methodName: string, public readonly backend: string) {
    super(`${methodName} is not supported in ${backend} backend`);
    this.name = 'NotSupportedError';
  }
}
