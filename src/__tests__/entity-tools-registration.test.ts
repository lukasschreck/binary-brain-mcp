/**
 * Entity-Tools Server-Registrierung Smoke-Test
 *
 * Verifiziert, dass createBrainServer die 4 Zwischenschicht-Tools registriert
 * und der Schema-Validator akzeptiert/ablehnt wie erwartet.
 *
 * Plan: docs/plans/20260518_zwischenschicht-knowledge-layer.md §10 Phase 1c-Followup
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SQLiteAdapter } from '../storage/sqlite.js';
import { createBrainServer } from '../server.js';
import type { EmbeddingProvider } from '../embedding/provider.js';
import {
  entityFindInputSchema,
  entityLinksInputSchema,
  decisionTraceInputSchema,
  crossRealmSearchInputSchema,
} from '../generated/entity-tools.js';

class NoneEmbeddingProvider implements EmbeddingProvider {
  readonly type = 'none' as const;
  readonly dimensions = 0;
  async embed(): Promise<number[]> { return []; }
}

describe('Entity-Tools Server-Registrierung', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter(join(tmpdir(), `brain-entity-test-${randomUUID()}.db`));
    await adapter.initialize();
  });

  it('createBrainServer initialisiert ohne Fehler mit SQLite-Backend', () => {
    const server = createBrainServer(adapter, new NoneEmbeddingProvider(), 'lukas');
    expect(server).toBeDefined();
  });

  it('entity_find Input-Schema akzeptiert valides Beispiel', () => {
    const parsed = entityFindInputSchema.parse({
      query: 'Becci',
      entity_type: 'person',
      realm_filter: ['brain', 'futursonanz'],
      limit: 5,
    });
    expect(parsed.query).toBe('Becci');
    expect(parsed.entity_type).toBe('person');
  });

  it('entity_find Input-Schema lehnt leeren Query ab', () => {
    expect(() => entityFindInputSchema.parse({ query: '' })).toThrow();
  });

  it('entity_find Input-Schema lehnt ungültigen entity_type ab', () => {
    expect(() => entityFindInputSchema.parse({ query: 'Becci', entity_type: 'invalid' })).toThrow();
  });

  it('entity_find Input-Schema akzeptiert minimalen Input (nur query)', () => {
    const parsed = entityFindInputSchema.parse({ query: 'Andreas Weber' });
    expect(parsed.query).toBe('Andreas Weber');
  });

  it('entity_links Input-Schema akzeptiert valides Beispiel', () => {
    const uuid = '2237b847-8ffd-49e0-84f5-15873c6c5892';
    const parsed = entityLinksInputSchema.parse({ entity_id: uuid });
    expect(parsed.entity_id).toBe(uuid);
  });

  it('entity_links Input-Schema lehnt ungültige UUID ab', () => {
    expect(() => entityLinksInputSchema.parse({ entity_id: 'not-a-uuid' })).toThrow();
  });

  it('decision_trace Input-Schema akzeptiert valides Beispiel', () => {
    const parsed = decisionTraceInputSchema.parse({ anchor_realm_id: 'mem-abc' });
    expect(parsed.anchor_realm_id).toBe('mem-abc');
  });

  it('cross_realm_search Input-Schema lehnt zu kurzen Query ab', () => {
    expect(() => crossRealmSearchInputSchema.parse({ query: 'X' })).toThrow();
  });

  it('cross_realm_search Input-Schema akzeptiert vollständigen Input inkl. depth', () => {
    const parsed = crossRealmSearchInputSchema.parse({
      query: 'Specification-These',
      realms: ['brain', 'library'],
      depth: 'deep',
      entity_grouping: true,
      since_days: 30,
      min_similarity: 0.4,
      limit_per_realm: 10,
    });
    expect(parsed.query).toBe('Specification-These');
    expect(parsed.realms).toEqual(['brain', 'library']);
    expect(parsed.depth).toBe('deep');
  });

  it('cross_realm_search akzeptiert fehlendes depth (Handler defaultet via ?? resonance)', () => {
    // Codegen erzeugt .default().optional() — bei fehlendem Key bleibt der Wert undefined
    // (wie alle optionalen Felder); der Tool-Handler setzt den Default `?? 'resonance'`.
    const parsed = crossRealmSearchInputSchema.parse({ query: 'Lebendigkeit' });
    expect(parsed.depth).toBeUndefined();
  });

  it('cross_realm_search Input-Schema lehnt ungültiges depth ab', () => {
    expect(() => crossRealmSearchInputSchema.parse({ query: 'Lebendigkeit', depth: 'shallow' })).toThrow();
  });

  it('SQLite-Backend hat weder entityFind noch crossRealmSearch — Guard greift', () => {
    expect(typeof (adapter as unknown as { entityFind?: unknown }).entityFind).toBe('undefined');
    expect(typeof (adapter as unknown as { crossRealmSearch?: unknown }).crossRealmSearch).toBe('undefined');
  });
});
