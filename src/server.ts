/**
 * Binary Brain MCP — Server with 8 Tools.
 *
 * brain_ingest    — Neues Wissen aufnehmen
 * brain_compose   — Synthese aus N Memories
 * brain_decompose — Tiefenbohrung zu einem Thema
 * brain_search    — Gezieltes Filtern
 * brain_find      — Ergebnisoffene Suche
 * brain_curate    — Metadaten pflegen
 * brain_dissolve  — Memory auflösen
 * brain_emerge    — Muster entdecken
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StorageAdapter } from './storage/adapter.js';
import type { EmbeddingProvider } from './embedding/provider.js';
import { prepareEmbeddingText } from './embedding/provider.js';
import { find } from './search/find.js';
import { emerge } from './emerge/emerge.js';
import { CATEGORIES, CATEGORY_LABELS, type Category } from './types.js';

const CategoryEnum = z.enum(CATEGORIES as unknown as [string, ...string[]]);

export function createBrainServer(
  storage: StorageAdapter,
  embedding: EmbeddingProvider,
  defaultOwner: string
): McpServer {
  const server = new McpServer({
    name: 'binary-brain-mcp',
    version: '0.1.0',
  });

  // --- brain_ingest ---
  server.tool(
    'brain_ingest',
    'Neues Wissen ins Brain aufnehmen. Content = Summary (wird embedded), raw_content = optionales Original (Transkript, ungekürzt).',
    {
      owner: z.string().default(defaultOwner).describe('Wem gehört dieses Memory?'),
      category: CategoryEnum.describe('Kategorie: signal, anchor, spark, thread, mirror, terrain, node, artifact, north, echo'),
      title: z.string().describe('Kurzer, prägnanter Titel'),
      content: z.string().describe('Summary / destillierter Inhalt'),
      raw_content: z.string().optional().describe('Vollständiges Original (Transkript, ungekürzt)'),
      domain: z.string().optional().describe('Domäne: personal, career, project-name, etc.'),
      tags: z.array(z.string()).optional().describe('Tags für Filterung'),
      importance: z.number().min(1).max(10).default(5).describe('Wichtigkeit 1-10'),
    },
    async (args) => {
      const embeddingVec = embedding.type !== 'none'
        ? await embedding.embed(prepareEmbeddingText(args.title, args.content))
        : undefined;

      const memory = await storage.insert({
        owner: args.owner,
        category: args.category as Category,
        title: args.title,
        content: args.content,
        raw_content: args.raw_content,
        domain: args.domain,
        tags: args.tags ?? [],
        importance: args.importance,
        embedding: embeddingVec,
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Ingested: [${memory.category}] "${memory.title}" (id: ${memory.id}, importance: ${memory.importance})`,
        }],
      };
    }
  );

  // --- brain_compose ---
  server.tool(
    'brain_compose',
    'Komponieren: Aus bestehenden Memories eine neue Synthese erzeugen. Sucht relevante Memories und fasst sie zusammen.',
    {
      query: z.string().describe('Thema oder Frage für die Synthese'),
      owner: z.string().default(defaultOwner).describe('Wessen Memories?'),
      domain: z.string().optional().describe('Optional: Domain-Filter'),
      max_sources: z.number().min(1).max(50).default(10).describe('Max Quell-Memories'),
      save_as_memory: z.boolean().default(false).describe('Synthese als neues Memory speichern?'),
    },
    async (args) => {
      // Find relevant memories
      const results = await find(args.query, storage, embedding, {
        owner: args.owner,
        domain: args.domain,
        limit: args.max_sources,
      });

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Keine relevanten Memories gefunden.' }],
        };
      }

      // Build synthesis context
      const sources = results.map((r, i) =>
        `[${i + 1}] [${r.category}] ${r.title} (Importance: ${r.importance})\n${r.content}`
      ).join('\n\n');

      const synthesis = [
        `# Synthese: ${args.query}`,
        `\n_Basierend auf ${results.length} Memories:_\n`,
        sources,
        `\n---\n_Quell-IDs: ${results.map(r => r.id.slice(0, 8)).join(', ')}_`,
      ].join('\n');

      // Optionally save as new memory
      if (args.save_as_memory) {
        const embeddingVec = embedding.type !== 'none'
          ? await embedding.embed(prepareEmbeddingText(`Synthese: ${args.query}`, synthesis))
          : undefined;

        const saved = await storage.insert({
          owner: args.owner,
          category: 'echo',
          title: `Synthese: ${args.query}`,
          content: synthesis,
          domain: args.domain,
          tags: ['composed', 'synthesis'],
          importance: 7,
          embedding: embeddingVec,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `${synthesis}\n\n---\nGespeichert als Memory: ${saved.id}`,
          }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: synthesis }],
      };
    }
  );

  // --- brain_decompose ---
  server.tool(
    'brain_decompose',
    'Kompostieren: Tiefenbohrung zu einem Thema. Findet alle relevanten Memories und gruppiert sie nach Kategorie.',
    {
      topic: z.string().describe('Thema für die Tiefenbohrung'),
      owner: z.string().default(defaultOwner).describe('Wessen Memories?'),
      domain: z.string().optional().describe('Optional: Domain-Filter'),
      max_items: z.number().min(1).max(100).default(50).describe('Max Memories im Report'),
    },
    async (args) => {
      // If topic is empty or generic, use snapshot (all memories)
      let memories;
      if (args.topic === '*' || args.topic.toLowerCase() === 'alles') {
        memories = await storage.snapshot(args.owner, args.domain, args.max_items);
      } else {
        // Find memories related to topic
        const results = await find(args.topic, storage, embedding, {
          owner: args.owner,
          domain: args.domain,
          limit: args.max_items,
        });
        memories = results;
      }

      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Keine Memories zu "${args.topic}" gefunden.` }],
        };
      }

      // Group by category
      const grouped = new Map<Category, typeof memories>();
      for (const m of memories) {
        const cat = m.category as Category;
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(m);
      }

      // Build markdown report
      const lines: string[] = [
        `# Decompose: ${args.topic}`,
        `_${memories.length} Memories, Owner: ${args.owner}${args.domain ? `, Domain: ${args.domain}` : ''}_\n`,
      ];

      for (const [category, items] of grouped) {
        const label = CATEGORY_LABELS[category] ?? category;
        lines.push(`## ${label}`);
        for (const m of items) {
          lines.push(`- **${m.title}** (Importance: ${m.importance})`);
          lines.push(`  ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
        }
        lines.push('');
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  // --- brain_search ---
  server.tool(
    'brain_search',
    'Gezieltes Suchen: Strukturiertes Filtern nach Owner, Category, Domain, Tags.',
    {
      owner: z.string().default(defaultOwner).describe('Owner-Filter'),
      category: CategoryEnum.optional().describe('Kategorie-Filter'),
      domain: z.string().optional().describe('Domain-Filter'),
      tag: z.string().optional().describe('Tag-Filter'),
      limit: z.number().min(1).max(100).default(20).describe('Max Ergebnisse'),
      sort_by: z.enum(['importance', 'created_at', 'updated_at', 'access_count']).default('importance').describe('Sortierung'),
    },
    async (args) => {
      const memories = await storage.scan({
        owner: args.owner,
        category: args.category as Category | undefined,
        domain: args.domain,
        tag: args.tag,
        limit: args.limit,
        sort_by: args.sort_by,
      });

      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Keine Memories gefunden.' }],
        };
      }

      const output = memories.map((m, i) =>
        `${i + 1}. [${m.category}] **${m.title}** (id: ${m.id}, importance: ${m.importance}${m.domain ? `, domain: ${m.domain}` : ''})\n   ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text' as const,
          text: `${memories.length} Memories gefunden:\n\n${output}`,
        }],
      };
    }
  );

  // --- brain_find ---
  server.tool(
    'brain_find',
    'Ergebnisoffenes Finden: Intelligente Suche über FTS + Vektor (wenn verfügbar). Für Fragen und explorative Suchen.',
    {
      query: z.string().describe('Suchbegriff oder Frage'),
      owner: z.string().default(defaultOwner).describe('Owner-Filter'),
      category: CategoryEnum.optional().describe('Optional: Kategorie-Filter'),
      domain: z.string().optional().describe('Optional: Domain-Filter'),
      limit: z.number().min(1).max(50).default(10).describe('Max Ergebnisse'),
    },
    async (args) => {
      const results = await find(args.query, storage, embedding, {
        owner: args.owner,
        category: args.category as Category | undefined,
        domain: args.domain,
        limit: args.limit,
      });

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `Nichts gefunden für "${args.query}".` }],
        };
      }

      const output = results.map((r, i) => {
        const sim = r.similarity !== undefined ? `, similarity: ${(r.similarity * 100).toFixed(0)}%` : '';
        return `${i + 1}. [${r.category}] **${r.title}** (id: ${r.id}${sim}, via: ${r.match_source})\n   ${r.content.slice(0, 150)}${r.content.length > 150 ? '...' : ''}`;
      }).join('\n\n');

      return {
        content: [{
          type: 'text' as const,
          text: `${results.length} Ergebnisse für "${args.query}":\n\n${output}`,
        }],
      };
    }
  );

  // --- brain_curate ---
  server.tool(
    'brain_curate',
    'Kuratieren: Metadaten eines Memory pflegen — Tags, Importance, Domain, Category anpassen.',
    {
      id: z.string().describe('Memory UUID'),
      title: z.string().optional().describe('Neuer Titel'),
      content: z.string().optional().describe('Neuer Content (Summary)'),
      raw_content: z.string().optional().describe('Neuer Raw Content'),
      category: CategoryEnum.optional().describe('Neue Kategorie'),
      domain: z.string().optional().describe('Neue Domain'),
      tags: z.array(z.string()).optional().describe('Neue Tags'),
      importance: z.number().min(1).max(10).optional().describe('Neue Wichtigkeit'),
      valid_until: z.string().optional().describe('Ablaufdatum (ISO 8601) oder "null" zum Entfernen'),
    },
    async (args) => {
      const updates: Record<string, unknown> = {};

      if (args.title !== undefined) updates.title = args.title;
      if (args.content !== undefined) updates.content = args.content;
      if (args.raw_content !== undefined) updates.raw_content = args.raw_content;
      if (args.category !== undefined) updates.category = args.category;
      if (args.domain !== undefined) updates.domain = args.domain;
      if (args.tags !== undefined) updates.tags = args.tags;
      if (args.importance !== undefined) updates.importance = args.importance;
      if (args.valid_until !== undefined) {
        updates.valid_until = args.valid_until === 'null' ? null : new Date(args.valid_until);
      }

      // Re-embed if title or content changed
      if ((args.title !== undefined || args.content !== undefined) && embedding.type !== 'none') {
        const existing = await storage.getById(args.id);
        if (existing) {
          const newTitle = args.title ?? existing.title;
          const newContent = args.content ?? existing.content;
          updates.embedding = await embedding.embed(prepareEmbeddingText(newTitle, newContent));
        }
      }

      const memory = await storage.update(args.id, updates);

      return {
        content: [{
          type: 'text' as const,
          text: `Curated: [${memory.category}] "${memory.title}" (id: ${memory.id})`,
        }],
      };
    }
  );

  // --- brain_dissolve ---
  server.tool(
    'brain_dissolve',
    'Auflösen: Memory permanent entfernen.',
    {
      id: z.string().describe('Memory UUID'),
    },
    async (args) => {
      const memory = await storage.delete(args.id);

      return {
        content: [{
          type: 'text' as const,
          text: `Dissolved: [${memory.category}] "${memory.title}" (id: ${memory.id})`,
        }],
      };
    }
  );

  // --- brain_emerge ---
  server.tool(
    'brain_emerge',
    'Auftauchen: Vergessene Memories bergen, domainübergreifende Verbindungen entdecken, ähnliche Memories identifizieren.',
    {
      owner: z.string().default(defaultOwner).describe('Wessen Memories analysieren?'),
      max_items: z.number().min(10).max(100).default(50).describe('Max Memories für Analyse'),
    },
    async (args) => {
      const report = await emerge(storage, embedding, args.owner, args.max_items);

      const stats = [
        `Surfaced: ${report.surfaced.length}`,
        `Connected: ${report.connections.length}`,
        `Crystal Groups: ${report.crystals.length}`,
        `Stale: ${report.stale.length}`,
      ].join(' | ');

      return {
        content: [{
          type: 'text' as const,
          text: `${report.summary}\n---\n_${stats}_`,
        }],
      };
    }
  );

  return server;
}
