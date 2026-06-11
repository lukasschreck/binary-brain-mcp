/**
 * cross-realm-assemble — DB-freie Merge/Dedup/Grouping-Logik für cross_realm_search.
 *
 * Der PostgresAdapter holt die Treffer aus brain/futursonanz/library (SQL) und reicht sie
 * als Realm-Maps hier rein. Diese Logik ist bewusst ohne Pool/Netz, damit sie isoliert
 * getestet werden kann (Dedup von V3-external_hits, Per-Realm-Cap, Entity-Grouping, Summary).
 */

import type {
  Realm,
  RealmHit,
  CrossRealmGroup,
  CrossRealmSearchResult,
  EntityRecord,
} from '../storage/adapter.js';

const REALM_ORDER: Realm[] = ['brain', 'futursonanz', 'library'];

export interface EntityRef {
  id: string;
  canonical_name: string;
  entity_type: EntityRecord['entity_type'];
  world_model_version: string | null;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Faltet V3-external_hits in die per-Realm Hit-Maps:
 * Dedup auf realm_id, höhere similarity gewinnt, abweichender Pfad → matched_via='both'.
 */
export function foldExternalHits(
  maps: Record<Realm, Map<string, RealmHit>>,
  externalHits: RealmHit[] | undefined,
  realms: Realm[],
): void {
  for (const h of externalHits ?? []) {
    if (!realms.includes(h.realm)) continue;
    const m = maps[h.realm];
    const existing = m.get(h.realm_id);
    if (existing) {
      if (h.similarity > existing.similarity) existing.similarity = clamp01(h.similarity);
      if (existing.matched_via !== h.matched_via) existing.matched_via = 'both';
      if (!existing.created_at && h.created_at) existing.created_at = h.created_at;
    } else {
      m.set(h.realm_id, { ...h, similarity: clamp01(h.similarity) });
    }
  }
}

export function buildSummary(g: CrossRealmGroup): string {
  const counts: Partial<Record<Realm, number>> = {};
  for (const h of g.hits) counts[h.realm] = (counts[h.realm] ?? 0) + 1;
  const realmStr = (Object.entries(counts) as Array<[Realm, number]>)
    .map(([r, c]) => `${c} ${r}`).join(', ');
  const top = g.hits[0]?.title ?? '';
  return `${g.hits.length} Treffer (${realmStr})${top ? ` — u.a. „${top.slice(0, 60)}"` : ''}`;
}

export function mostCommon(arr: string[]): string | null {
  if (arr.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/**
 * Kappt jede Realm-Map auf limit (nach similarity), gruppiert nach Entity (sofern grouping),
 * baut das Spec-konforme Result. entityByKey: `${realm}::${realm_id}` → EntityRef.
 */
export function assembleResult(
  query: string,
  maps: Record<Realm, Map<string, RealmHit>>,
  opts: { entity_grouping: boolean; limit_per_realm: number },
  entityByKey: Map<string, EntityRef>,
): CrossRealmSearchResult {
  const limit = opts.limit_per_realm;
  const allHits: RealmHit[] = [];
  for (const realm of REALM_ORDER) {
    const hits = [...maps[realm].values()]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    allHits.push(...hits);
  }

  if (!opts.entity_grouping) {
    const results = [...allHits].sort((a, b) => b.similarity - a.similarity);
    return { query, groups: [], results, total_hits: allHits.length, world_model_version: 'unversioned' };
  }

  const groupsMap = new Map<string, CrossRealmGroup>();
  const ungrouped: RealmHit[] = [];
  const versions: string[] = [];

  for (const h of allHits) {
    const ent = entityByKey.get(`${h.realm}::${h.realm_id}`);
    if (!ent) { ungrouped.push(h); continue; }
    if (ent.world_model_version) versions.push(ent.world_model_version);
    let g = groupsMap.get(ent.id);
    if (!g) {
      g = {
        entity: { id: ent.id, canonical_name: ent.canonical_name, entity_type: ent.entity_type },
        hits: [],
        summary: '',
      };
      groupsMap.set(ent.id, g);
    }
    g.hits.push(h);
  }

  const groups = [...groupsMap.values()];
  for (const g of groups) {
    g.hits.sort((a, b) => b.similarity - a.similarity);
    g.summary = buildSummary(g);
  }
  groups.sort((a, b) => b.hits.length - a.hits.length);
  ungrouped.sort((a, b) => b.similarity - a.similarity);

  return {
    query,
    groups,
    results: ungrouped,
    total_hits: allHits.length,
    world_model_version: mostCommon(versions) ?? 'unversioned',
  };
}
