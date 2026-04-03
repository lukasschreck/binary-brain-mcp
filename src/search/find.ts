/**
 * brain_find — Unified intelligent search.
 *
 * Combines FTS fulltext + vector similarity (when available).
 * Merges, deduplicates, and ranks results.
 */

import type { StorageAdapter } from '../storage/adapter.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import type { Memory, MemoryWithSimilarity, ScanFilter } from '../types.js';
import { prepareEmbeddingText } from '../embedding/provider.js';

export interface FindResult extends Memory {
  similarity?: number;
  match_source: 'vector' | 'fulltext';
}

export async function find(
  query: string,
  storage: StorageAdapter,
  embedding: EmbeddingProvider,
  filter?: ScanFilter
): Promise<FindResult[]> {
  const limit = filter?.limit ?? 20;

  // Run searches in parallel
  const searches: Promise<Array<Memory | MemoryWithSimilarity>>[] = [
    storage.fulltext(query, { ...filter, limit }),
  ];

  if (embedding.type !== 'none') {
    const queryVec = await embedding.embed(prepareEmbeddingText(query, ''));
    searches.push(storage.vectorSearch(queryVec, filter));
  }

  const [ftsResults, vectorResults = []] = await Promise.all(searches);

  // Merge + deduplicate
  const seen = new Set<string>();
  const merged: FindResult[] = [];

  // Vector results first (higher quality match)
  for (const r of vectorResults) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push({
      ...r,
      similarity: 'similarity' in r ? (r as MemoryWithSimilarity).similarity : undefined,
      match_source: 'vector',
    });
  }

  // Then FTS results
  for (const r of ftsResults) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push({
      ...r,
      match_source: 'fulltext',
    });
  }

  // Rank: vector results first (by similarity), then FTS (by importance)
  merged.sort((a, b) => {
    // Vector matches before fulltext
    if (a.match_source === 'vector' && b.match_source !== 'vector') return -1;
    if (a.match_source !== 'vector' && b.match_source === 'vector') return 1;

    // Within same source: by similarity (if available) then importance
    if (a.similarity !== undefined && b.similarity !== undefined) {
      return b.similarity - a.similarity;
    }
    return b.importance - a.importance;
  });

  return merged.slice(0, limit);
}
