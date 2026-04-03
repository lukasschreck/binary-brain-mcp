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
}
