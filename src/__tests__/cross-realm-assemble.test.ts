/**
 * Tests für cross-realm-assemble — DB-freie Merge/Dedup/Grouping-Logik.
 * Plan: docs/plans/20260611_cross-realm-search-v2.md (Phase 5)
 */

import { describe, it, expect } from 'vitest';
import {
  clamp01,
  foldExternalHits,
  assembleResult,
  buildSummary,
  mostCommon,
  type EntityRef,
} from '../search/cross-realm-assemble.js';
import type { Realm, RealmHit } from '../storage/adapter.js';

function hit(realm: Realm, id: string, sim: number, via: RealmHit['matched_via'] = 'embedding'): RealmHit {
  return { realm, realm_id: id, title: `${realm}-${id}`, preview: `preview-${id}`, similarity: sim, matched_via: via };
}

function emptyMaps(): Record<Realm, Map<string, RealmHit>> {
  return { brain: new Map(), futursonanz: new Map(), library: new Map() };
}

describe('clamp01', () => {
  it('klemmt auf [0,1] und fängt NaN', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
  });
});

describe('foldExternalHits', () => {
  it('fügt neue realm_ids hinzu', () => {
    const maps = emptyMaps();
    foldExternalHits(maps, [hit('futursonanz', 's1', 0.8)], ['brain', 'futursonanz', 'library']);
    expect(maps.futursonanz.get('s1')?.similarity).toBe(0.8);
  });

  it('dedupliziert: höhere similarity gewinnt, Pfad-Overlap → both', () => {
    const maps = emptyMaps();
    maps.futursonanz.set('s1', hit('futursonanz', 's1', 0.5, 'fulltext'));
    foldExternalHits(maps, [hit('futursonanz', 's1', 0.9, 'embedding')], ['futursonanz']);
    const merged = maps.futursonanz.get('s1')!;
    expect(merged.similarity).toBe(0.9);
    expect(merged.matched_via).toBe('both');
  });

  it('behält höhere Bestands-similarity, markiert trotzdem both', () => {
    const maps = emptyMaps();
    maps.futursonanz.set('s1', hit('futursonanz', 's1', 0.95, 'fulltext'));
    foldExternalHits(maps, [hit('futursonanz', 's1', 0.4, 'embedding')], ['futursonanz']);
    const merged = maps.futursonanz.get('s1')!;
    expect(merged.similarity).toBe(0.95);
    expect(merged.matched_via).toBe('both');
  });

  it('ignoriert Hits aus nicht-angefragten Realms', () => {
    const maps = emptyMaps();
    foldExternalHits(maps, [hit('library', 'b1', 0.7)], ['brain', 'futursonanz']);
    expect(maps.library.size).toBe(0);
  });

  it('klemmt external similarity', () => {
    const maps = emptyMaps();
    foldExternalHits(maps, [hit('library', 'b1', 1.5)], ['library']);
    expect(maps.library.get('b1')?.similarity).toBe(1);
  });
});

describe('assembleResult — entity_grouping=false', () => {
  it('liefert flache, similarity-sortierte results, keine groups', () => {
    const maps = emptyMaps();
    maps.brain.set('m1', hit('brain', 'm1', 0.4));
    maps.futursonanz.set('s1', hit('futursonanz', 's1', 0.9));
    const r = assembleResult('q', maps, { entity_grouping: false, limit_per_realm: 10 }, new Map());
    expect(r.groups).toEqual([]);
    expect(r.results.map((h) => h.realm_id)).toEqual(['s1', 'm1']);
    expect(r.total_hits).toBe(2);
    expect(r.world_model_version).toBe('unversioned');
  });
});

describe('assembleResult — Per-Realm-Cap', () => {
  it('kappt jede Realm-Map auf limit_per_realm (Top nach similarity)', () => {
    const maps = emptyMaps();
    maps.brain.set('m1', hit('brain', 'm1', 0.3));
    maps.brain.set('m2', hit('brain', 'm2', 0.9));
    maps.brain.set('m3', hit('brain', 'm3', 0.6));
    const r = assembleResult('q', maps, { entity_grouping: false, limit_per_realm: 2 }, new Map());
    expect(r.total_hits).toBe(2);
    expect(r.results.map((h) => h.realm_id)).toEqual(['m2', 'm3']);
  });
});

describe('assembleResult — Entity-Grouping', () => {
  it('gruppiert nach Entity über Realms hinweg, Rest in results', () => {
    const maps = emptyMaps();
    maps.brain.set('m1', hit('brain', 'm1', 0.7));
    maps.futursonanz.set('s1', hit('futursonanz', 's1', 0.8));
    maps.library.set('b1', hit('library', 'b1', 0.6)); // ungrouped

    const ent: EntityRef = { id: 'e-weber', canonical_name: 'Andreas Weber', entity_type: 'person', world_model_version: '2026.05-v1' };
    const entityByKey = new Map<string, EntityRef>([
      ['brain::m1', ent],
      ['futursonanz::s1', ent],
    ]);

    const r = assembleResult('q', maps, { entity_grouping: true, limit_per_realm: 10 }, entityByKey);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].entity.canonical_name).toBe('Andreas Weber');
    expect(r.groups[0].hits.map((h) => h.realm_id).sort()).toEqual(['m1', 's1']);
    expect(r.groups[0].summary).toContain('2 Treffer');
    expect(r.results.map((h) => h.realm_id)).toEqual(['b1']);
    expect(r.total_hits).toBe(3);
    expect(r.world_model_version).toBe('2026.05-v1');
  });

  it('sortiert Gruppen nach Trefferzahl absteigend', () => {
    const maps = emptyMaps();
    maps.brain.set('m1', hit('brain', 'm1', 0.7));
    maps.brain.set('m2', hit('brain', 'm2', 0.7));
    maps.futursonanz.set('s1', hit('futursonanz', 's1', 0.7));
    const big: EntityRef = { id: 'big', canonical_name: 'Big', entity_type: 'concept', world_model_version: null };
    const small: EntityRef = { id: 'small', canonical_name: 'Small', entity_type: 'concept', world_model_version: null };
    const entityByKey = new Map<string, EntityRef>([
      ['brain::m1', big], ['brain::m2', big], ['futursonanz::s1', small],
    ]);
    const r = assembleResult('q', maps, { entity_grouping: true, limit_per_realm: 10 }, entityByKey);
    expect(r.groups.map((g) => g.entity.id)).toEqual(['big', 'small']);
  });
});

describe('buildSummary / mostCommon', () => {
  it('buildSummary zählt Realms und zitiert Top-Titel', () => {
    const g = { entity: { id: 'x', canonical_name: 'X', entity_type: 'concept' as const }, hits: [hit('brain', 'm1', 0.9)], summary: '' };
    const s = buildSummary(g);
    expect(s).toContain('1 Treffer');
    expect(s).toContain('1 brain');
    expect(s).toContain('brain-m1');
  });

  it('mostCommon liefert häufigsten Wert, null bei leer', () => {
    expect(mostCommon(['a', 'b', 'a'])).toBe('a');
    expect(mostCommon([])).toBeNull();
  });
});
