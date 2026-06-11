/**
 * Binary Brain MCP — Core Types
 *
 * Organische Metaphern statt technischer Labels.
 * Jede Category hat eine Bedeutung, nicht nur einen Namen.
 */

// --- Categories ---

export const CATEGORIES = [
  'signal',   // Diskrete Information, Faktum
  'anchor',   // Entscheidung + Begründung
  'spark',    // Beobachtung, Insight
  'thread',   // Wiederkehrendes Muster
  'mirror',   // Feedback, Korrektur
  'terrain',  // Aktueller Kontext, Projekt-Lage
  'node',     // Person, Kontakt, Beziehung
  'artifact', // Buch, Tool, Artikel, Ressource
  'north',    // Ziel, Intention, Richtung
  'echo',     // Meta-Reflexion, Selbstbeobachtung
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  signal:   'Signale',
  anchor:   'Anker',
  spark:    'Funken',
  thread:   'Fäden',
  mirror:   'Spiegel',
  terrain:  'Gelände',
  node:     'Knoten',
  artifact: 'Artefakte',
  north:    'Nordsterne',
  echo:     'Echos',
};

// --- Memory ---

export interface Memory {
  id: string;
  owner: string;
  category: Category;
  title: string;
  content: string;         // Summary / destillierter Inhalt (für Anzeige + Embedding)
  raw_content?: string;    // Vollständiges Original (Transkript, ungekürzt)
  domain?: string;
  tags: string[];
  importance: number;      // 1-10, default 5
  embedding?: number[];    // optional, provider-dependent dimensions
  access_count: number;
  last_accessed_at?: Date;
  valid_until?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MemoryWithSimilarity extends Memory {
  similarity: number;
}

// --- Filters ---

export interface ScanFilter {
  owner?: string;
  category?: Category;
  domain?: string;
  tag?: string;
  limit?: number;
  sort_by?: 'importance' | 'created_at' | 'updated_at' | 'access_count';
  include_expired?: boolean;
  /** Lower bound (inclusive) — matches against created_at by default, updated_at if date_field='updated_at'. */
  since?: Date;
  /** Upper bound (inclusive). */
  until?: Date;
  /** Which timestamp column the since/until bounds apply to. Default: 'created_at'. */
  date_field?: 'created_at' | 'updated_at';
}

// --- Stats ---

export interface CategoryStats {
  category: Category;
  count: number;
  avg_importance: number;
  latest: Date;
}

// --- Config ---

export interface BrainConfig {
  storage: 'sqlite' | 'postgres';
  embedding: 'none' | 'local' | 'jina' | 'openai' | 'ollama';
  owner: string;
  dataDir: string;

  sqlite?: {
    path: string;
  };
  postgres?: {
    connectionString: string;
  };

  jina?: {
    apiKey: string;
    dimensions?: number;  // default: 256
  };
  openai?: {
    apiKey: string;
    dimensions?: number;  // default: 256
  };
  ollama?: {
    baseUrl: string;
    model?: string;       // default: nomic-embed-text
  };

  /** V3 cross_realm_search deep-Suche: Edge Function `cross-realm-search` in binarybrain-core. */
  crossRealm?: {
    functionUrl: string;
    token: string;
  };
}
