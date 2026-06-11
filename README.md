# Binary Brain MCP

**Your AI's long-term memory. Model-agnostic. Provider-independent.**

> Because your memories shouldn't belong to your AI provider.

Claude, GPT, Gemini — they all have built-in memory. But switch providers, and your memories stay behind. Binary Brain gives your AI persistent memory that **you** own, stored locally, accessible from any MCP-compatible client.

## Quickstart (30 seconds)

```bash
npx binary-brain-mcp init
```

The wizard creates `~/.brain/config.json`, initializes a SQLite database, and configures your Claude Desktop. No Docker, no server, no API key needed.

Then start a conversation:

> "brain_ingest a new anchor: We chose PostgreSQL because we need pgvector for semantic search."

## The 9 Tools

| Tool | What it does | Metaphor |
|------|-------------|----------|
| `brain_ingest` | Store new knowledge | **Aufnehmen** — raw knowledge enters the brain |
| `brain_compose` | Synthesize N memories into something new | **Komponieren** — create a new symphony from existing parts |
| `brain_decompose` | Deep-dive into a topic across all memories | **Kompostieren** — break down into rich, fertile context |
| `brain_search` | Filter by category, tags, domain, owner | **Suchen** — open the right drawer, find exactly what you need |
| `brain_scan` | Time-window filter (since/until) with timestamps in output | **Zeitfenster** — what entered the brain in this window? |
| `brain_find` | Intelligent search (fulltext + vector) | **Finden** — explore openly, discover what's relevant |
| `brain_curate` | Update metadata (tags, importance, domain) | **Kuratieren** — label, classify, maintain your collection |
| `brain_dissolve` | Remove a memory | **Auflösen** — a memory dissolves |
| `brain_emerge` | Discover patterns, surface forgotten knowledge | **Auftauchen** — hidden connections rise to the surface |

`brain_search`, `brain_find`, and `brain_scan` accept `verbosity: 'compact' | 'full'` and `include_raw_content: boolean` for full content + raw transcript output. Default is compact (150–200 char preview).

### Why these names?

**Compose** and **Decompose** carry a deliberate duality:

- **Compose** (komponieren) — like composing music, you take individual notes (memories) and create something greater than the sum of its parts.
- **Decompose** (kompostieren) — like composting, you break down accumulated knowledge into rich, fertile ground that nourishes new understanding.

One builds up. The other breaks down. Both create value.

## The 10 Categories

Every memory gets a category — not a generic label, but a meaningful classification:

| Category | Meaning | Example |
|----------|---------|---------|
| `signal` | A discrete fact or piece of information | "PostgreSQL supports pgvector since v0.5.0" |
| `anchor` | A decision and its reasoning | "We chose Jina over OpenAI embeddings for multilingual support" |
| `spark` | An observation or insight | "Users interact more with visual dashboards than tables" |
| `thread` | A recurring pattern | "Every migration needs an idempotent rollback" |
| `mirror` | Feedback or correction | "Don't mock the database in integration tests" |
| `terrain` | Current context or project landscape | "Sprint 12, focusing on auth refactor" |
| `node` | A person or relationship | "Pavel Luksha — EDG author, contacted March 2026" |
| `artifact` | A book, tool, article, or resource | "Designing Data-Intensive Applications by Kleppmann" |
| `north` | A goal or intention | "Launch open-source brain-mcp by April 2026" |
| `echo` | A meta-reflection | "I tend to over-architect when a simple solution would work" |

## Nightly Brain Dreaming

When Binary Brain runs on PostgreSQL with pgvector (e.g. Supabase), it gains an autonomous maintenance pipeline — **Brain Dreaming**. Like the human brain during sleep, the system consolidates, connects, and cleans your memories every night.

### The Dream Pipeline

```
04:30 Uhr — das Brain schläft ein

  🕸️ Weave (Vernetzung)
  │  pgvector cross-match: findet semantisch ähnliche Memory-Paare
  │  und persistiert sie als memory_links (link_type='similar')
  │
  🔍 Lint (Gesundheit)
  │  6 Health-Checks: vergessene Memories, Kategorie-Balance,
  │  Orphan-Tags, ablaufende Memories, Widersprüche, fehlende Embeddings
  │
  🌱 Emerge (Mustererkennung)
  │  Entdeckt dichte Memory-Cluster (5+ Members, Ø Similarity > 0.6)
  │  und fasst sie via Mistral AI zu neuen Pattern-Memories zusammen
  │
  🌘 Fade (Vergessen)
     Natürliches Vergessen: reduziert importance für ungenutzte
     Memories (>90 Tage, nie abgerufen) und abgelaufene Einträge

  → Telegram: Detaillierter Nachtbericht mit Erkenntnissen
```

### Example Nightly Report

```
🌙 Brain Dreaming — Nachtbericht

📅 18.04.2026 04:30 | Run: a1b2c3d4
⏱️ Dauer: 42s | ✅ Erfolgreich

━━━ 🕸️ Vernetzung (5s) ━━━
• 500 Verbindungen entdeckt (Threshold: 0.55)
• 500 neu persistiert

━━━ 🔍 Gesundheit (2s) ━━━
• 171 Memories | 6 Checks
• 📊 Dominant: spark (26%)
• 🏷️ 398/495 Orphan-Tags (80%)

━━━ 🌱 Mustererkennung (28s) ━━━
• 2 Cluster → 2 Threads erstellt
  └ "Integrale KI-Perspektiven" (8 Memories, Ø0.72)
  └ "Embodiment & Praxis" (5 Memories, Ø0.65)

━━━ 🌘 Vergessen (1s) ━━━
• 0 forgotten decayed | 0 expired
• Alle Memories sind frisch

━━━ 💡 Erkenntnisse ━━━
• Brain: 171 Memories in 10 Kategorien
• Starke Vernetzung: 500 semantische Brücken
• ⚠️ Tag-Hygiene: 80% sind Einzel-Tags
• Neue Muster: "Integrale KI-Perspektiven"
```

### Extending the Pipeline

Adding a new dream step requires two files:

```
1. _shared/dream-reflect.ts       ← Core logic (export fn + schema)
2. _shared/dream-registry.ts      ← Add one entry to DREAM_PIPELINE array
```

No workflow changes, no redeployment of other functions.

### Architecture

The dreaming pipeline runs as Supabase Edge Functions, orchestrated by a single `nightly-dream-orchestrator` function. n8n triggers it via cron (04:30 daily) and forwards the report to Telegram.

```
n8n (Schedule)
  └─▶ POST /nightly-dream-orchestrator (JWT auth)
        ├─▶ weave()    ← _shared/dream-weave.ts
        ├─▶ lint()     ← _shared/dream-lint.ts
        ├─▶ emerge()   ← _shared/dream-emerge.ts
        └─▶ fade()     ← _shared/dream-fade.ts
              └─▶ formatTelegramReport()
                    └─▶ Telegram Nachtbericht
```

Each step is also deployable as standalone Edge Function for individual testing.

## Voice-to-Brain Pipeline

Binary Brain supports voice ingestion through a Telegram → n8n → Supabase pipeline:

```
🎤 Telegram Voice Memo
  → n8n Workflow (Speech-to-Text + Mistral Categorization)
    → brain_ingest via Supabase PostgreSQL
      → Jina Embedding (256d, on-write)
        → Searchable memory with semantic vector
```

Send a voice memo to your Telegram bot, and it arrives as a fully categorized, embedded memory in your brain — ready for search, compose, and dreaming.

## Architecture

```
~/.brain/
  config.json          ← Your preferences
  brain.db             ← SQLite database (default)

binary-brain-mcp/
  src/
    server.ts          ← 8 MCP Tools
    storage/
      adapter.ts       ← StorageAdapter interface
      sqlite.ts        ← Zero-config default
      postgres.ts      ← pgvector power-user option
    embedding/
      provider.ts      ← EmbeddingProvider interface
      none.ts          ← No embedding (default)
      jina.ts          ← Jina AI (best multilingual)
      openai.ts        ← OpenAI
      ollama.ts        ← Local via Ollama
    emerge/
      emerge.ts        ← Memory discovery algorithm
    search/
      find.ts          ← Hybrid search (fulltext + vector)
    __tests__/
      sqlite.test.ts   ← Storage layer tests
      e2e.test.ts      ← Full lifecycle tests
      emerge.test.ts   ← Pattern discovery tests
      find.test.ts     ← Search tests
  scripts/
    backfill-zettelkasten.mjs  ← Zettelkasten migration tool
```

### Storage Adapters

| Adapter | Setup | Vector Search | Best for |
|---------|-------|--------------|----------|
| **SQLite** (default) | Zero config | In-memory cosine (up to ~5k memories) | Getting started, personal use |
| **PostgreSQL** | Connection string | pgvector IVFFlat | Power users, large brains, production |

### Embedding Providers

| Provider | Setup | Quality | Cost |
|----------|-------|---------|------|
| **None** (default) | Nothing | Keyword search only | Free |
| **Jina AI** | API key | Best multilingual | ~$0.01/1M tokens |
| **OpenAI** | API key | Great English | ~$0.02/1M tokens |
| **Ollama** | Local install | Good | Free (local compute) |

## Search vs. Find

Binary Brain separates two ways of looking for memories:

**`brain_search`** — You know what you want. Open a drawer.
```
brain_search(category: "anchor", tag: "database")
→ All database decisions, sorted by importance
```

**`brain_find`** — You have a question. Explore.
```
brain_find(query: "Why did we change the database?")
→ Fulltext + semantic search, merged and ranked
```

Without an embedding provider, `brain_find` uses fulltext search (FTS5). Add embeddings for semantic "meaning-based" search.

## Emerge: Memory Discovery

`brain_emerge` is not a cleanup tool — it's a discovery tool. Inspired by how the brain surfaces connections during dreams.

**4 Phases:**

| Phase | What happens |
|-------|-------------|
| **Surface** | Find forgotten memories (never accessed, older than 30 days) |
| **Connect** | Discover semantic links between different domains |
| **Crystallize** | Identify similar memories that could be consolidated |
| **Illuminate** | Generate a report — for your review, not automatic action |

**Important:** Stale memories are **presented**, not deleted. There may be gold in what you've forgotten.

With the [Nightly Brain Dreaming](#nightly-brain-dreaming) pipeline, this discovery runs automatically every night — weaving new connections, detecting clusters, and generating pattern summaries via AI.

## Access Tracking

Every operation that reads memory content increments `access_count` and updates `last_accessed_at`:

- `brain_search`, `brain_find` — track all returned memories
- `brain_compose`, `brain_decompose` — track source memories

This powers the discovery engine: `brain_emerge` surfaces forgotten memories (high importance but `access_count = 0`), and the nightly Fade step gradually reduces importance of untouched memories.

## Content vs. Raw Content

Every memory has two content fields:

| Field | Purpose | Searchable | Embedded |
|-------|---------|-----------|----------|
| `content` | Summary / distilled essence | FTS + Vector | Yes |
| `raw_content` | Full original (transcript, voice memo) | FTS only | No |

This means your embedding quality stays high (short, focused text) while the original is never lost.

## Upgrade Path

```
Start here                    Add when needed
    |                              |
    v                              v
SQLite + None          →     SQLite + Jina/OpenAI
(keyword search)             (semantic search)
    |                              |
    v                              v
PostgreSQL + None      →     PostgreSQL + Jina/OpenAI
(structured queries)         (full power, pgvector)
    |
    v
PostgreSQL + Jina + Nightly Dreaming
(autonomous memory management)
```

## Configuration

### Config file (`~/.brain/config.json`)

```json
{
  "storage": "sqlite",
  "embedding": "none",
  "owner": "your-name",
  "dataDir": "~/.brain",
  "sqlite": { "path": "~/.brain/brain.db" }
}
```

### PostgreSQL + Jina (power user)

```json
{
  "storage": "postgres",
  "embedding": "jina",
  "owner": "your-name",
  "dataDir": "~/.brain",
  "postgres": { "connectionString": "postgresql://user:pass@host:5432/brain" },
  "jina": { "apiKey": "jina_xxx", "dimensions": 256 }
}
```

### Zwischenschicht-Tools (PostgreSQL only)

Mit dem Postgres-Backend (binarybrain-core) sind zusätzlich die Entity-Layer-Tools verfügbar:
`entity_find` und **`cross_realm_search`** (Volltext+Entity über brain/futursonanz/library, gruppiert nach Entity).

`cross_realm_search` hat zwei Tiefenstufen über den `depth`-Param:
- **`resonance`** (Default): schnell, nur Brain-Resonanzschicht (`brain_resonances`/`library_resonances` + Brain-Volltext/-Embedding + `entity_mentions`). Offline-fähig, kein Extra-Setup.
- **`deep`**: zusätzlich Live-Suche im vollen Kiosk- und Library-Korpus via Edge Function `cross-realm-search` (binarybrain-core). Benötigt den `crossRealm`-Block:

```json
{
  "crossRealm": {
    "functionUrl": "https://<project-ref>.supabase.co/functions/v1/cross-realm-search",
    "token": "<CROSS_REALM_TOKEN — muss mit dem Vault-Secret der Edge Function übereinstimmen>"
  }
}
```

Ohne `crossRealm`-Block fällt `depth:deep` graceful auf die Resonanzschicht zurück (mit Hinweis im Output).

### Claude Desktop integration

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "binary-brain": {
      "command": "npx",
      "args": ["-y", "binary-brain-mcp"]
    }
  }
}
```

Or run locally:

```json
{
  "mcpServers": {
    "binary-brain": {
      "command": "node",
      "args": ["/path/to/binary-brain-mcp/dist/src/stdio.js"]
    }
  }
}
```

## HTTP Transport

For remote access (server, Docker, VPS):

```bash
PORT=3100 node dist/src/http.js
```

Endpoints:
- `GET /` — Server info
- `GET /healthz` — Health check
- `ALL /mcp` — MCP protocol

## Example Skills

These Claude Code skills show how to build workflows on top of Binary Brain:

### `/reflect` — Session-End Reflection
```
After every work session, reflect:
1. What did I decide? → brain_ingest as "anchor"
2. What did I learn? → brain_ingest as "spark"
3. What pattern emerged? → brain_ingest as "thread"
```

### `/decide` — Document a Decision
```
When making a decision:
1. brain_find related past decisions
2. brain_ingest the new decision as "anchor" with reasoning
3. Update related memories via brain_curate if needed
```

### `/context` — Load Project Context
```
At the start of a session:
1. brain_decompose with the current project topic
2. Use the structured output as context
```

## Scripts & Utilities

### Zettelkasten Migration

Migrate existing Zettelkasten markdown files into Binary Brain:

```bash
node scripts/backfill-zettelkasten.mjs --dry-run    # Preview
node scripts/backfill-zettelkasten.mjs               # Execute
```

Maps Zettelkasten categories to Binary Brain categories (feature → spark, bugfix → signal, etc.), generates Jina embeddings, and detects duplicates by title.

## Testing

Binary Brain has a comprehensive test suite with 79 tests:

```bash
npm test                   # Run all tests
npm run test:coverage      # With coverage report
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| SQLite Storage | CRUD, FTS, vector search, stats | Full adapter interface |
| E2E Lifecycle | Ingest → Search → Curate → Dissolve | Complete tool chain |
| Emerge Discovery | Surface, Connect, Crystallize | Pattern detection |
| Find/Search | Fulltext, semantic, hybrid merge | Search ranking |

A [golden dataset](src/__fixtures__/golden-dataset.ts) with 20 memories across all 10 categories ensures reproducible tests.

## Ecosystem

Binary Brain is part of the Futursonanz knowledge infrastructure:

```
┌──────────────────────────────────────────────────────┐
│                    You (Human)                        │
│  🎤 Voice Memo    💬 Chat    ✍️ Note    📄 Document  │
└──────┬───────────────┬────────────┬──────────────────┘
       │               │            │
       ▼               ▼            ▼
  Telegram Bot    Claude/GPT    Direct API
       │               │            │
       ▼               ▼            ▼
┌──────────────────────────────────────────────────────┐
│              Binary Brain MCP (8 Tools)               │
│  ingest · compose · decompose · search · find         │
│  curate · dissolve · emerge                           │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│            PostgreSQL + pgvector (Supabase)            │
│  memories · memory_links · embeddings (256d Jina)     │
└──────────────────────┬───────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
     Nightly Dreaming      On-Demand
     (04:30 automated)     (via MCP Tools)
     ┌─────────────┐      ┌─────────────┐
     │ 🕸️ Weave     │      │ brain_emerge │
     │ 🔍 Lint      │      │ brain_find   │
     │ 🌱 Emerge    │      │ brain_compose│
     │ 🌘 Fade      │      └─────────────┘
     └──────┬──────┘
            ▼
     📱 Telegram Report
```

## Comparison

| Feature | Binary Brain | Mem0 | Letta/MemGPT | Claude Memory |
|---------|-------------|------|--------------|---------------|
| Zero config | SQLite, one command | Needs vector DB | Complex setup | Built-in |
| Model-agnostic | Any MCP client | Yes | Yes | Claude only |
| MCP-native | Yes | Plugin | No | No |
| Semantic search | Optional (upgrade) | Required | Built-in | Built-in |
| Self-hosted | Yes | Cloud or self | Yes | No |
| Categories | 10 opinionated types | Free-form | Tiered memory | Free-form |
| Memory discovery | brain_emerge + Nightly | No | No | Auto-dream |
| Nightly dreaming | Automated pipeline | No | No | No |
| Voice ingestion | Telegram → Brain | No | No | No |
| Open source | MIT | Apache-2.0 | Apache-2.0 | Proprietary |

## Development

```bash
git clone https://github.com/lukasschreck/binary-brain-mcp.git
cd binary-brain-mcp
npm install
npm run build

# Run tests
npm test

# Test with stdio
npm run dev:stdio

# Test with HTTP
npm run dev:http
```

## License

MIT - Lukas Schreck / [Futursonanz](https://futursonanz.de)

---

*Built by [Futursonanz](https://futursonanz.de) — decoding the zeitgeist through integral monitoring systems. Binary Brain started as our family's personal knowledge OS and is now open for everyone who believes their memories should belong to them, not their AI provider.*
