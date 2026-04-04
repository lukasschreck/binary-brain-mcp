/**
 * Golden Dataset — Reproducible test data for binary-brain-mcp.
 *
 * 20 Memories across all 10 categories with deterministic fake embeddings.
 * Themes: AI strategy, personal growth, project management, futurism.
 */

import type { Category } from '../types.js';
import type { MemoryInsert } from '../storage/adapter.js';

/**
 * Generate a deterministic fake embedding vector.
 * Same seed always produces same vector — reproducible tests.
 */
export function fakeEmbedding(seed: number, dimensions: number = 8): number[] {
  const vec: number[] = [];
  let x = seed;
  for (let i = 0; i < dimensions; i++) {
    x = ((x * 1103515245 + 12345) & 0x7fffffff);
    vec.push((x / 0x7fffffff) * 2 - 1);
  }
  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map(v => v / norm) : vec;
}

/**
 * Two similar embeddings (cosine > 0.9) for crystal/duplicate detection tests.
 */
export function similarEmbeddings(seed: number, dimensions: number = 8): [number[], number[]] {
  const base = fakeEmbedding(seed, dimensions);
  const nudged = base.map((v, i) => v + (i % 2 === 0 ? 0.05 : -0.05));
  const norm = Math.sqrt(nudged.reduce((s, v) => s + v * v, 0));
  return [base, nudged.map(v => v / norm)];
}

export const GOLDEN_OWNER = 'test-user';

export const GOLDEN_MEMORIES: MemoryInsert[] = [
  // --- signal (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'signal' as Category,
    title: 'Claude 4 Release Announcement',
    content: 'Anthropic released Claude 4 with improved reasoning and 200k context window.',
    raw_content: 'Full press release: Anthropic today announced Claude 4, the latest generation of their AI assistant. Key improvements include enhanced reasoning capabilities, a 200,000 token context window, and native tool use support.',
    domain: 'ai',
    tags: ['anthropic', 'claude', 'release'],
    importance: 8,
    embedding: fakeEmbedding(1),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'signal' as Category,
    title: 'EU AI Act Enforcement Date',
    content: 'EU AI Act becomes enforceable August 2026, affecting all AI deployments in Europe.',
    domain: 'regulation',
    tags: ['eu', 'regulation', 'compliance'],
    importance: 7,
    embedding: fakeEmbedding(2),
  },

  // --- anchor (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'anchor' as Category,
    title: 'Tech Stack Decision: Supabase + Edge Functions',
    content: 'Decided to use Supabase as primary backend with Edge Functions for serverless compute. Reasoning: managed Postgres, built-in auth, vector support via pgvector.',
    domain: 'architecture',
    tags: ['supabase', 'architecture', 'decision'],
    importance: 9,
    embedding: fakeEmbedding(3),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'anchor' as Category,
    title: 'Open Source Strategy: Reference Implementation',
    content: 'Binary Brain MCP will be open source as reference implementation, not a Mem0 competitor. Focus on zero-config + MCP-native.',
    domain: 'strategy',
    tags: ['opensource', 'strategy', 'branding'],
    importance: 8,
    embedding: fakeEmbedding(4),
  },

  // --- spark (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'spark' as Category,
    title: 'Observation: Agentic Workflows Replace Dashboards',
    content: 'In every company I consult, dashboards are dying. AI agents that proactively surface insights are replacing passive monitoring.',
    domain: 'consulting',
    tags: ['agents', 'dashboards', 'trend'],
    importance: 6,
    embedding: fakeEmbedding(5),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'spark' as Category,
    title: 'Pattern: Junior Devs Outperform with AI Pair Programming',
    content: 'Junior developers using Claude Code consistently ship features faster than senior devs without AI assistance.',
    domain: 'ai',
    tags: ['productivity', 'coding', 'observation'],
    importance: 7,
    embedding: fakeEmbedding(6),
  },

  // --- thread (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'thread' as Category,
    title: 'Recurring: Context Window as Bottleneck',
    content: 'Every 3 months, context window limits force architectural redesign. Pattern: build for current limits, plan migration path for 2x.',
    domain: 'architecture',
    tags: ['context-window', 'pattern', 'architecture'],
    importance: 8,
    embedding: fakeEmbedding(7),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'thread' as Category,
    title: 'Recurring: Credential Rotation After Exposure',
    content: 'Third time credentials leaked via git commit. Always: rotate within 1 hour, verify old key returns 401, update .env.example.',
    domain: 'security',
    tags: ['security', 'credentials', 'incident'],
    importance: 9,
    embedding: fakeEmbedding(8),
  },

  // --- mirror (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'mirror' as Category,
    title: 'Feedback: Stop Over-Engineering MVP',
    content: 'Client feedback: "You spent 3 weeks building abstractions for a feature that needed 2 days of simple code." Ship simple, refactor later.',
    domain: 'consulting',
    tags: ['feedback', 'mvp', 'simplicity'],
    importance: 8,
    embedding: fakeEmbedding(9),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'mirror' as Category,
    title: 'Self-Correction: Batch API Cost Assumption',
    content: 'Assumed Anthropic Batch API was always 50% cheaper. Reality: depends on queue time and model. Mistral can be cheaper for triage.',
    domain: 'ai',
    tags: ['costs', 'batch-api', 'correction'],
    importance: 6,
    embedding: fakeEmbedding(10),
  },

  // --- terrain (2) ---
  {
    owner: GOLDEN_OWNER,
    category: 'terrain' as Category,
    title: 'Current Context: Q2 2026 Sprint',
    content: 'Focus: open source binary-brain-mcp, Constellation refresh optimization, Mollie payment integration.',
    domain: 'project',
    tags: ['q2-2026', 'sprint', 'focus'],
    importance: 5,
    embedding: fakeEmbedding(11),
    valid_until: new Date('2026-06-30'),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'terrain' as Category,
    title: 'Team Situation: Solo Founder + AI Fleet',
    content: 'Operating as solo founder with Claude Code, n8n automation, and Hetzner nachtschicht agents. No human employees yet.',
    domain: 'personal',
    tags: ['team', 'solo', 'ai-fleet'],
    importance: 6,
    embedding: fakeEmbedding(12),
  },

  // --- node (1) ---
  {
    owner: GOLDEN_OWNER,
    category: 'node' as Category,
    title: 'Pavel Luksha — EDG Creator',
    content: 'Creator of Emerging Development Goals framework. Based in Moscow/Lisbon. Contact lost March 2026, email sent.',
    domain: 'network',
    tags: ['contact', 'edg', 'academic'],
    importance: 7,
    embedding: fakeEmbedding(13),
  },

  // --- artifact (3) ---
  {
    owner: GOLDEN_OWNER,
    category: 'artifact' as Category,
    title: 'Whitepaper: Mensch-Agent-Organisation',
    content: 'Collaborative whitepaper on human-agent organizational design. Co-authored with Schwedes. Covers governance, trust boundaries, escalation patterns.',
    domain: 'research',
    tags: ['whitepaper', 'organization', 'agents'],
    importance: 8,
    embedding: fakeEmbedding(14),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'artifact' as Category,
    title: 'Tool: Jina AI Embeddings v3',
    content: 'Jina embeddings v3 with 256d for efficiency, 1024d for precision. text-matching task type for semantic search. Secret: JINA_VECTOR_EMBEDDING in vault.',
    domain: 'ai',
    tags: ['jina', 'embeddings', 'tool'],
    importance: 7,
    embedding: fakeEmbedding(15),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'artifact' as Category,
    title: 'Book: Spiral Dynamics — Beck & Cowan',
    content: 'Foundational framework for value systems evolution. vMemes from Beige to Turquoise. Used in EDG analysis and integral radar.',
    domain: 'research',
    tags: ['book', 'spiral-dynamics', 'integral'],
    importance: 9,
    embedding: fakeEmbedding(16),
  },

  // --- north (1) ---
  {
    owner: GOLDEN_OWNER,
    category: 'north' as Category,
    title: 'Vision: Futursonanz als Zukunfts-Boutique',
    content: 'Build Futursonanz as a one-person future-sensing boutique. Revenue from consulting, content, and SaaS tools. Brand = signal intelligence + integral thinking.',
    domain: 'strategy',
    tags: ['vision', 'futursonanz', 'goal'],
    importance: 10,
    embedding: fakeEmbedding(17),
  },

  // --- echo (1) ---
  {
    owner: GOLDEN_OWNER,
    category: 'echo' as Category,
    title: 'Reflexion: Execution Speed vs. Strategic Depth',
    content: 'Tendency to ship fast but skip deep strategic thinking. Need weekly "slow thinking" sessions. AI handles execution, human handles direction.',
    domain: 'personal',
    tags: ['reflection', 'speed', 'strategy'],
    importance: 7,
    embedding: fakeEmbedding(18),
  },
];

/**
 * Memories designed to be "forgotten" (access_count=0, created >30 days ago).
 * Used for emerge/surface phase testing.
 */
export const FORGOTTEN_MEMORIES: MemoryInsert[] = [
  {
    owner: GOLDEN_OWNER,
    category: 'spark' as Category,
    title: 'Old Insight: Blockchain for Supply Chain',
    content: 'Enterprise blockchain adoption for supply chain tracking. Seemed promising in 2024, largely abandoned by 2026.',
    domain: 'consulting',
    tags: ['blockchain', 'supply-chain', 'outdated'],
    importance: 4,
    embedding: fakeEmbedding(101),
  },
  {
    owner: GOLDEN_OWNER,
    category: 'terrain' as Category,
    title: 'Context: January 2026 Planning',
    content: 'Q1 focus was on pipeline stabilization and Anthropic batch API integration. Completed.',
    domain: 'project',
    tags: ['q1-2026', 'planning', 'completed'],
    importance: 3,
    embedding: fakeEmbedding(102),
  },
];

/**
 * Memories with expired valid_until for emerge/illuminate phase testing.
 */
export const EXPIRED_MEMORIES: MemoryInsert[] = [
  {
    owner: GOLDEN_OWNER,
    category: 'terrain' as Category,
    title: 'Expired: Conference Deadline CES 2026',
    content: 'CES 2026 submission deadline was January 15.',
    domain: 'events',
    tags: ['conference', 'deadline', 'expired'],
    importance: 3,
    embedding: fakeEmbedding(201),
    valid_until: new Date('2026-01-15'),
  },
];

/**
 * Pair of near-duplicate memories for crystallize phase testing.
 */
const [simEmb1, simEmb2] = similarEmbeddings(300);
export const DUPLICATE_MEMORIES: MemoryInsert[] = [
  {
    owner: GOLDEN_OWNER,
    category: 'signal' as Category,
    title: 'Claude Code Release Features',
    content: 'Claude Code ships with MCP support, tool use, and persistent memory via filesystem.',
    domain: 'ai',
    tags: ['claude', 'mcp', 'tools'],
    importance: 7,
    embedding: simEmb1,
  },
  {
    owner: GOLDEN_OWNER,
    category: 'signal' as Category,
    title: 'Claude Code MCP and Tool Support',
    content: 'Claude Code includes native MCP integration, tool calling, and file-based memory persistence.',
    domain: 'ai',
    tags: ['claude', 'mcp', 'features'],
    importance: 6,
    embedding: simEmb2,
  },
];

/**
 * Memory from a different owner for multi-tenant isolation tests.
 */
export const OTHER_OWNER_MEMORY: MemoryInsert = {
  owner: 'other-user',
  category: 'signal' as Category,
  title: 'Other User Signal',
  content: 'This memory belongs to a different user and should not appear in test-user queries.',
  domain: 'private',
  tags: ['isolation'],
  importance: 5,
  embedding: fakeEmbedding(999),
};
