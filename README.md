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

## The 8 Tools

| Tool | What it does | Metaphor |
|------|-------------|----------|
| `brain_ingest` | Store new knowledge | **Aufnehmen** — raw knowledge enters the brain |
| `brain_compose` | Synthesize N memories into something new | **Komponieren** — create a new symphony from existing parts |
| `brain_decompose` | Deep-dive into a topic across all memories | **Kompostieren** — break down into rich, fertile context |
| `brain_search` | Filter by category, tags, domain, owner | **Suchen** — open the right drawer, find exactly what you need |
| `brain_find` | Intelligent search (fulltext + vector) | **Finden** — explore openly, discover what's relevant |
| `brain_curate` | Update metadata (tags, importance, domain) | **Kuratieren** — label, classify, maintain your collection |
| `brain_dissolve` | Remove a memory | **Auflosen** — a memory dissolves |
| `brain_emerge` | Discover patterns, surface forgotten knowledge | **Auftauchen** — hidden connections rise to the surface |

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

## Comparison

| Feature | Binary Brain | Mem0 | Letta/MemGPT | Claude Memory |
|---------|-------------|------|--------------|---------------|
| Zero config | SQLite, one command | Needs vector DB | Complex setup | Built-in |
| Model-agnostic | Any MCP client | Yes | Yes | Claude only |
| MCP-native | Yes | Plugin | No | No |
| Semantic search | Optional (upgrade) | Required | Built-in | Built-in |
| Self-hosted | Yes | Cloud or self | Yes | No |
| Categories | 10 opinionated types | Free-form | Tiered memory | Free-form |
| Memory discovery | brain_emerge | No | No | Auto-dream |
| Open source | MIT | Apache-2.0 | Apache-2.0 | Proprietary |

## Development

```bash
git clone https://github.com/lukasschreck/binary-brain-mcp.git
cd binary-brain-mcp
npm install
npm run build

# Test with stdio
npm run dev:stdio

# Test with HTTP
npm run dev:http
```

## License

MIT - Lukas Schreck / [Futursonanz](https://futursonanz.de)

---

*Built by [Futursonanz](https://futursonanz.de) — decoding the zeitgeist through integral monitoring systems. Binary Brain started as our family's personal knowledge OS and is now open for everyone who believes their memories should belong to them, not their AI provider.*
