/**
 * Binary Brain MCP — Server with 9 Tools.
 *
 * brain_ingest    — Neues Wissen aufnehmen
 * brain_compose   — Synthese aus N Memories
 * brain_decompose — Tiefenbohrung zu einem Thema
 * brain_search    — Gezieltes Filtern
 * brain_scan      — Zeitfenster-Filter (since/until + Timestamps im Output)
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
import { CATEGORIES, CATEGORY_LABELS, type Category, type Memory } from './types.js';
import {
  entityFindInputSchema,
  entityLinksInputSchema,
  decisionTraceInputSchema,
  crossRealmSearchInputSchema,
} from './generated/entity-tools.js';

const CategoryEnum = z.enum(CATEGORIES as unknown as [string, ...string[]]);

// --- Shared rendering helper ---
interface RenderOptions {
  verbosity?: 'compact' | 'full';
  include_raw_content?: boolean;
  /** Extra inline note appended to the meta line (e.g. similarity) */
  extraMeta?: string;
  /** Default truncate length when verbosity='compact' */
  truncate?: number;
}

function renderMemoryEntry(m: Memory, index: number, opts: RenderOptions = {}): string {
  const verbosity = opts.verbosity ?? 'compact';
  const truncate = opts.truncate ?? 150;
  const lines: string[] = [];
  lines.push(`### ${index + 1}. [${m.category}] ${m.title}`);

  const meta: string[] = [
    `id: \`${m.id}\``,
    `importance: ${m.importance}`,
    ...(m.domain ? [`domain: \`${m.domain}\``] : []),
    `created_at: ${m.created_at.toISOString()}`,
    `updated_at: ${m.updated_at.toISOString()}`,
    `access_count: ${m.access_count}`,
    ...(m.last_accessed_at ? [`last_accessed_at: ${m.last_accessed_at.toISOString()}`] : []),
    ...(m.valid_until ? [`valid_until: ${m.valid_until.toISOString()}`] : []),
    ...(opts.extraMeta ? [opts.extraMeta] : []),
  ];
  lines.push(`- ${meta.join(' · ')}`);

  if (m.tags && m.tags.length > 0) {
    lines.push(`- tags: ${m.tags.map(t => `\`${t}\``).join(', ')}`);
  }

  const content = verbosity === 'full'
    ? m.content
    : (m.content.length > truncate ? `${m.content.slice(0, truncate)}…` : m.content);
  lines.push('');
  lines.push('**content:**');
  lines.push(content);

  if (opts.include_raw_content && m.raw_content) {
    lines.push('');
    lines.push('**raw_content:**');
    lines.push(m.raw_content);
  }

  return lines.join('\n');
}

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

      // Touch all source memories (increment access_count)
      await Promise.all(results.map(r => storage.touch(r.id)));

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

      // Touch all found memories (increment access_count)
      await Promise.all(memories.map(r => storage.touch(r.id)));

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
    'Gezieltes Suchen: Strukturiertes Filtern nach Owner, Category, Domain, Tags. Mit verbosity="full" wird der komplette content statt Truncate ausgegeben; mit include_raw_content=true zusaetzlich der Volltext.',
    {
      owner: z.string().default(defaultOwner).describe('Owner-Filter'),
      category: CategoryEnum.optional().describe('Kategorie-Filter'),
      domain: z.string().optional().describe('Domain-Filter'),
      tag: z.string().optional().describe('Tag-Filter'),
      limit: z.number().min(1).max(100).default(20).describe('Max Ergebnisse'),
      sort_by: z.enum(['importance', 'created_at', 'updated_at', 'access_count']).default('importance').describe('Sortierung'),
      verbosity: z.enum(['compact', 'full']).default('compact').describe('compact: 150-Zeichen-Truncate. full: kompletter content.'),
      include_raw_content: z.boolean().default(false).describe('Wenn true, raw_content (Volltext) zusaetzlich ausgeben.'),
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

      // Touch all results (increment access_count)
      await Promise.all(memories.map(r => storage.touch(r.id)));

      const output = memories.map((m, i) =>
        renderMemoryEntry(m, i, { verbosity: args.verbosity, include_raw_content: args.include_raw_content })
      ).join(args.verbosity === 'full' || args.include_raw_content ? '\n\n---\n\n' : '\n\n');

      return {
        content: [{
          type: 'text' as const,
          text: `${memories.length} Memories gefunden:\n\n${output}`,
        }],
      };
    }
  );

  // --- brain_scan ---
  server.tool(
    'brain_scan',
    'Zeitfenster-Scan: Memories aus einem Datums-Range listen — mit echten Timestamps und allen Metadaten im Output (Tags, Domain, access_count, updated_at). Mit verbosity="full" auch der komplette content statt Truncate; mit include_raw_content=true zusaetzlich das ungekuerzte Original. Gut fuer "letzte 48h", "seit letzter Woche", oder gezielte ISO-Date-Bereiche. Default Sortierung: created_at DESC.',
    {
      owner: z.string().default(defaultOwner).describe('Owner-Filter'),
      category: CategoryEnum.optional().describe('Kategorie-Filter'),
      domain: z.string().optional().describe('Domain-Filter'),
      tag: z.string().optional().describe('Tag-Filter (genau ein Tag)'),
      since: z.string().optional().describe('ISO 8601 untere Grenze, inkl. (z.B. "2026-05-04T00:00:00Z")'),
      until: z.string().optional().describe('ISO 8601 obere Grenze, inkl.'),
      since_hours_ago: z.number().min(0).optional().describe('Convenience: untere Grenze als Stunden zurueck. Wird ignoriert wenn since gesetzt ist.'),
      since_days_ago: z.number().min(0).optional().describe('Convenience: untere Grenze als Tage zurueck. since > since_hours_ago > since_days_ago.'),
      date_field: z.enum(['created_at', 'updated_at']).default('created_at').describe('Welches Datum zaehlt fuer since/until.'),
      limit: z.number().min(1).max(200).default(50).describe('Max Ergebnisse'),
      sort_by: z.enum(['created_at', 'updated_at', 'importance', 'access_count']).default('created_at').describe('Sortierung (created_at = neueste zuerst)'),
      verbosity: z.enum(['compact', 'full']).default('compact').describe('compact: 200-Zeichen-Truncate. full: kompletter content.'),
      include_raw_content: z.boolean().default(false).describe('Wenn true, raw_content (Volltext / Originaltranskript) zusaetzlich ausgeben.'),
      include_expired: z.boolean().default(false).describe('Wenn true, auch abgelaufene Memories einbeziehen (valid_until in der Vergangenheit).'),
    },
    async (args) => {
      // Resolve since: explicit > hours > days
      let since: Date | undefined;
      if (args.since) {
        const parsed = new Date(args.since);
        if (Number.isNaN(parsed.getTime())) {
          return { content: [{ type: 'text' as const, text: `Ungueltiges since-Datum: "${args.since}". Erwartet ISO 8601.` }] };
        }
        since = parsed;
      } else if (args.since_hours_ago !== undefined) {
        since = new Date(Date.now() - args.since_hours_ago * 3_600_000);
      } else if (args.since_days_ago !== undefined) {
        since = new Date(Date.now() - args.since_days_ago * 86_400_000);
      }

      let until: Date | undefined;
      if (args.until) {
        const parsed = new Date(args.until);
        if (Number.isNaN(parsed.getTime())) {
          return { content: [{ type: 'text' as const, text: `Ungueltiges until-Datum: "${args.until}". Erwartet ISO 8601.` }] };
        }
        until = parsed;
      }

      const memories = await storage.scan({
        owner: args.owner,
        category: args.category as Category | undefined,
        domain: args.domain,
        tag: args.tag,
        limit: args.limit,
        sort_by: args.sort_by,
        since,
        until,
        date_field: args.date_field,
        include_expired: args.include_expired,
      });

      if (memories.length === 0) {
        const range = since || until
          ? ` (${since ? since.toISOString() : '-∞'} → ${until ? until.toISOString() : 'jetzt'})`
          : '';
        return { content: [{ type: 'text' as const, text: `Keine Memories im Zeitfenster${range} gefunden.` }] };
      }

      // Touch all results
      await Promise.all(memories.map(r => storage.touch(r.id)));

      const header = [
        `${memories.length} Memories`,
        since ? `seit ${since.toISOString()}` : null,
        until ? `bis ${until.toISOString()}` : null,
        `sortiert nach ${args.sort_by}`,
        `verbosity=${args.verbosity}`,
        args.include_raw_content ? 'mit raw_content' : null,
      ].filter(Boolean).join(', ');

      const output = memories.map((m, i) =>
        renderMemoryEntry(m, i, {
          verbosity: args.verbosity,
          include_raw_content: args.include_raw_content,
          truncate: 200,
        })
      ).join('\n\n---\n\n');

      return {
        content: [{ type: 'text' as const, text: `${header}:\n\n${output}` }],
      };
    }
  );

  // --- brain_find ---
  server.tool(
    'brain_find',
    'Ergebnisoffenes Finden: Intelligente Suche ueber FTS + Vektor (wenn verfuegbar). Fuer Fragen und explorative Suchen. Mit verbosity="full" wird der komplette content statt Truncate ausgegeben; mit include_raw_content=true zusaetzlich der Volltext.',
    {
      query: z.string().describe('Suchbegriff oder Frage'),
      owner: z.string().default(defaultOwner).describe('Owner-Filter'),
      category: CategoryEnum.optional().describe('Optional: Kategorie-Filter'),
      domain: z.string().optional().describe('Optional: Domain-Filter'),
      limit: z.number().min(1).max(50).default(10).describe('Max Ergebnisse'),
      verbosity: z.enum(['compact', 'full']).default('compact').describe('compact: 150-Zeichen-Truncate. full: kompletter content.'),
      include_raw_content: z.boolean().default(false).describe('Wenn true, raw_content (Volltext) zusaetzlich ausgeben.'),
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

      // Touch all results (increment access_count)
      await Promise.all(results.map(r => storage.touch(r.id)));

      const output = results.map((r, i) => {
        const simNote = r.similarity !== undefined
          ? ` · similarity: ${(r.similarity * 100).toFixed(0)}% · via: ${r.match_source}`
          : ` · via: ${r.match_source}`;
        return renderMemoryEntry(r, i, {
          verbosity: args.verbosity,
          include_raw_content: args.include_raw_content,
          extraMeta: simNote.replace(/^ · /, ''),
        });
      }).join(args.verbosity === 'full' || args.include_raw_content ? '\n\n---\n\n' : '\n\n');

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
      title: z.string().min(1).optional().describe('Neuer Titel'),
      content: z.string().min(1).optional().describe('Neuer Content (Summary)'),
      raw_content: z.string().min(1).optional().describe('Neuer Raw Content'),
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

  // -------------------------------------------------------------------------
  // Zwischenschicht-Tools (Library V3 §4.2 Spec-First)
  // Schemas leben in generated/entity-tools.ts (Single-Source-of-Truth: specs/entity/*).
  // -------------------------------------------------------------------------

  // --- entity_find: Telefonbuch-Lookup ---
  server.tool(
    'entity_find',
    'Telefonbuch-Lookup. Finde eine Entity (Person/Organisation/Konzept/Buch/Werk/Ort) per Name oder Alias und liefere alle Mentions cross-realm (brain, futursonanz, library).',
    entityFindInputSchema.shape,
    async (args) => {
      if (typeof storage.entityFind !== 'function') {
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: 'entity_find ist nur in PostgreSQL-Backend verfügbar (Zwischenschicht-Tabellen). Aktuelles Backend hat keine entities-Tabelle.',
          }],
        };
      }
      const result = await storage.entityFind(args.query, {
        entity_type: args.entity_type,
        realm_filter: args.realm_filter,
        limit: args.limit,
      });
      if (result.match_count === 0) {
        return {
          content: [{ type: 'text' as const, text: `Keine Entity gefunden für "${args.query}".` }],
        };
      }
      const lines: string[] = [];
      lines.push(`**${result.match_count} ${result.match_count === 1 ? 'Entity' : 'Entities'} gefunden**${result.ambiguous ? ' (ambig)' : ''}`);
      for (const e of result.entities) {
        lines.push('');
        lines.push(`### ${e.canonical_name} [${e.entity_type}]`);
        lines.push(`- id: \`${e.id}\``);
        if (e.aliases.length > 0) lines.push(`- aliases: ${e.aliases.map((a) => `\`${a}\``).join(', ')}`);
        if (e.notes) lines.push(`- notes: ${e.notes}`);
        if (e.mentions.length === 0) {
          lines.push(`- mentions: _keine_`);
        } else {
          const byRealm: Record<string, number> = {};
          for (const m of e.mentions) byRealm[m.realm] = (byRealm[m.realm] ?? 0) + 1;
          lines.push(`- mentions: ${Object.entries(byRealm).map(([r, c]) => `${r}=${c}`).join(', ')} (total ${e.mentions.length})`);
          const sample = e.mentions.slice(0, 5);
          for (const m of sample) {
            lines.push(`  - \`${m.realm}.${m.realm_table}/${m.realm_id}\` (confidence ${m.confidence.toFixed(2)})`);
          }
          if (e.mentions.length > 5) lines.push(`  - … ${e.mentions.length - 5} weitere`);
        }
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // --- entity_links: Karte (Stub bis Phase 2 Edge-Extraction live) ---
  server.tool(
    'entity_links',
    'Karte. Liefere alle Edges (Beziehungen), die an einer Entity hängen — eingehend, ausgehend oder beidseitig.',
    entityLinksInputSchema.shape,
    async (args) => {
      void args;
      return {
        content: [{
          type: 'text' as const,
          text: 'entity_links: Edges-Tabelle ist bis Phase 2 (Edge-Extraction) leer. Tool wird scharf, sobald LLM-extrahierte Edges vorhanden sind. Plan: docs/plans/20260518_zwischenschicht-knowledge-layer.md Phase 2.',
        }],
      };
    },
  );

  // --- decision_trace: Quellen-Chain (Stub bis Phase 3) ---
  server.tool(
    'decision_trace',
    'Quellen-Chain für einen Anchor. Liefere die Memories/Signals/Bücher die wahrscheinlich zur Entscheidung beigetragen haben — mit Rolle (evidence/trigger/counter), Score und optional Confirmation-Status.',
    decisionTraceInputSchema.shape,
    async (args) => {
      void args;
      return {
        content: [{
          type: 'text' as const,
          text: 'decision_trace: decision_traces-Tabelle ist bis Phase 3 leer. Tool wird scharf, sobald Trace-Detector live ist. Plan: docs/plans/20260518_zwischenschicht-knowledge-layer.md Phase 3.',
        }],
      };
    },
  );

  // --- cross_realm_search: Volltext+Entity über drei Räume (Stub V1) ---
  server.tool(
    'cross_realm_search',
    'Volltext+Entity-Suche über alle drei Räume (brain, futursonanz, library). Gruppiert Treffer nach Entity, damit nicht 47 isolierte Hits sondern 8 thematische Cluster zurückkommen.',
    crossRealmSearchInputSchema.shape,
    async (args) => {
      void args;
      return {
        content: [{
          type: 'text' as const,
          text: 'cross_realm_search: Cross-DB-Implementation pending. Brain-only-Suche bereits via entity_find verfügbar; Futursonanz-Mentions sind seit Phase 1c im Brain verlinkt — Cross-Realm-Volltext-Join folgt in V2.',
        }],
      };
    },
  );

  return server;
}
