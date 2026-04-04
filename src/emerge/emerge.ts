/**
 * brain_emerge — Memory discovery and pattern recognition.
 *
 * 4 Phases: Surface → Connect → Crystallize → Illuminate
 * No automatic deletion. Only suggestions.
 */

import type { StorageAdapter } from '../storage/adapter.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import type { Memory, MemoryWithSimilarity } from '../types.js';
import { CATEGORY_LABELS, type Category } from '../types.js';
import { prepareEmbeddingText } from '../embedding/provider.js';

const THRESHOLD_CONNECTION = 0.5;    // Cross-domain matches need higher confidence
const THRESHOLD_CRYSTAL = 0.85;      // Near-duplicate detection
const MAX_CONNECTIONS = 10;

export interface EmergeReport {
  surfaced: Memory[];             // Forgotten memories (access_count=0, >30d)
  connections: Connection[];       // Cross-domain semantic matches
  crystals: CrystalGroup[];      // Duplicate/similar groups
  stale: Memory[];                // Potentially outdated (for user decision)
  summary: string;                // Markdown report
}

export interface Connection {
  memory_a: Memory;
  memory_b: Memory;
  similarity: number;
  insight: string;
}

export interface CrystalGroup {
  memories: Memory[];
  similarity: number;
}

export async function emerge(
  storage: StorageAdapter,
  embedding: EmbeddingProvider,
  owner: string,
  maxItems: number = 50
): Promise<EmergeReport> {
  // Phase 1: Surface — forgotten memories
  const surfaced = await storage.forgotten(owner, 30, 10);

  // Phase 2: Connect — cross-domain semantic matches
  const connections: Connection[] = [];
  if (embedding.type !== 'none') {
    const allMemories = await storage.scan({ owner, limit: maxItems });
    const domainsMap = new Map<string, Memory[]>();
    // Local cache for computed embeddings — avoids mutating Memory objects
    const embeddingCache = new Map<string, number[]>();

    for (const m of allMemories) {
      const domain = m.domain ?? '__none__';
      if (!domainsMap.has(domain)) domainsMap.set(domain, []);
      domainsMap.get(domain)!.push(m);
    }

    const domains = [...domainsMap.keys()];
    if (domains.length >= 2) {
      // Take top 5 memories from each domain and cross-match
      for (let i = 0; i < domains.length && connections.length < MAX_CONNECTIONS; i++) {
        const domainA = domains[i];
        const memoriesA = domainsMap.get(domainA)!.slice(0, 5);

        for (const memA of memoriesA) {
          if (connections.length >= MAX_CONNECTIONS) break;

          let memAEmbedding = memA.embedding;
          if (!memAEmbedding || memAEmbedding.length === 0) {
            if (!embeddingCache.has(memA.id)) {
              const vec = await embedding.embed(prepareEmbeddingText(memA.title, memA.content));
              embeddingCache.set(memA.id, vec);
            }
            memAEmbedding = embeddingCache.get(memA.id)!;
          }

          // Search in other domains
          const crossMatches = await storage.vectorSearch(
            memAEmbedding,
            { owner, limit: 3 },
            THRESHOLD_CONNECTION
          );

          for (const match of crossMatches) {
            if (match.id === memA.id) continue;
            const matchDomain = match.domain ?? '__none__';
            if (matchDomain === domainA) continue; // Skip same domain

            connections.push({
              memory_a: memA,
              memory_b: match,
              similarity: match.similarity,
              insight: `${CATEGORY_LABELS[memA.category as Category] ?? memA.category} (${domainA}) ↔ ${CATEGORY_LABELS[match.category as Category] ?? match.category} (${matchDomain})`,
            });
          }
        }
      }
    }
  }

  // Phase 3: Crystallize — find similar memory groups
  const crystals: CrystalGroup[] = [];
  if (embedding.type !== 'none') {
    const allWithEmbeddings = await storage.scan({ owner, limit: maxItems });
    const processed = new Set<string>();

    for (const mem of allWithEmbeddings) {
      if (processed.has(mem.id)) continue;
      if (!mem.embedding || mem.embedding.length === 0) continue;

      const similar = await storage.vectorSearch(mem.embedding, { owner, limit: 5 }, THRESHOLD_CRYSTAL);
      const group = similar.filter(s => s.id !== mem.id && !processed.has(s.id));

      if (group.length > 0) {
        const avgSim = group.reduce((sum, s) => sum + s.similarity, 0) / group.length;
        crystals.push({
          memories: [mem, ...group],
          similarity: avgSim,
        });
        for (const g of group) processed.add(g.id);
      }
      processed.add(mem.id);
    }
  }

  // Phase 4: Illuminate — find stale memories
  const stale = await storage.scan({
    owner,
    limit: 10,
    sort_by: 'updated_at',
    include_expired: true,
  });
  const staleFiltered = stale.filter(m => {
    if (!m.valid_until) return false;
    return m.valid_until < new Date();
  });

  // Build markdown report
  const summary = buildReport(surfaced, connections, crystals, staleFiltered);

  return { surfaced, connections, crystals, stale: staleFiltered, summary };
}

function buildReport(
  surfaced: Memory[],
  connections: Connection[],
  crystals: CrystalGroup[],
  stale: Memory[]
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];
  lines.push(`# Emerge Report — ${now}\n`);

  // Surfaced
  lines.push(`## Surfaced (vergessen, aber vielleicht relevant)`);
  if (surfaced.length === 0) {
    lines.push('Keine vergessenen Memories gefunden.\n');
  } else {
    for (const m of surfaced) {
      lines.push(`- **${m.title}** (${m.category}, ${m.domain ?? 'kein Domain'}, Importance: ${m.importance})`);
      lines.push(`  ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`);
    }
    lines.push('');
  }

  // Connections
  lines.push(`## Connected (domainübergreifend)`);
  if (connections.length === 0) {
    lines.push('Keine Cross-Domain Verbindungen gefunden.\n');
  } else {
    for (const c of connections) {
      lines.push(`- **${c.memory_a.title}** ↔ **${c.memory_b.title}** (Similarity: ${(c.similarity * 100).toFixed(0)}%)`);
      lines.push(`  ${c.insight}`);
    }
    lines.push('');
  }

  // Crystals
  lines.push(`## Crystallized (ähnliche Memories)`);
  if (crystals.length === 0) {
    lines.push('Keine Duplikat-Gruppen gefunden.\n');
  } else {
    for (const g of crystals) {
      lines.push(`- **Gruppe** (${g.memories.length} Memories, ~${(g.similarity * 100).toFixed(0)}% ähnlich):`);
      for (const m of g.memories) {
        lines.push(`  - ${m.title} (${m.category})`);
      }
    }
    lines.push('');
  }

  // Stale
  lines.push(`## Stale (abgelaufen — zur Entscheidung)`);
  if (stale.length === 0) {
    lines.push('Keine abgelaufenen Memories.\n');
  } else {
    for (const m of stale) {
      lines.push(`- **${m.title}** — valid_until: ${m.valid_until?.toISOString().split('T')[0]}`);
      lines.push(`  Noch aktuell? → brain_curate oder brain_dissolve`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
