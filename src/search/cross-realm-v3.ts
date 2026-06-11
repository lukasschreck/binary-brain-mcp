/**
 * cross-realm-v3 — Client für die V3 Live-Korpus-Suche (depth='deep').
 *
 * Ruft die Edge Function `cross-realm-search` (binarybrain-core) auf, die mit
 * Vault-Service-Keys live gegen den vollen Kiosk-Signal- und Library-Bücher-Korpus
 * sucht. Die Treffer werden im Adapter als external_hits in dieselbe Dedup+Grouping-
 * Pipeline gefaltet wie die V2-Resonanzschicht.
 *
 * Resilient by design: jeder Fehler (Timeout, HTTP, Netz) → ok:false + leere hits,
 * damit der V2-Pfad trotzdem ein Ergebnis liefert.
 */

import type { RealmHit, Realm } from '../storage/adapter.js';

export interface CrossRealmV3Config {
  functionUrl: string;
  token: string;
}

export interface V3FetchParams {
  query: string;
  realms?: Realm[];
  since_days?: number;
  min_similarity?: number;
  limit_per_realm?: number;
}

export interface V3Result {
  hits: RealmHit[];
  affected_realms: string[];
  ok: boolean;
  error?: string;
}

export async function fetchV3Hits(
  config: CrossRealmV3Config,
  params: V3FetchParams,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20000,
): Promise<V3Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Brain läuft immer lokal — der Edge Function nur futursonanz/library anbieten.
    const realms = params.realms?.filter((r) => r !== 'brain');
    const res = await fetchImpl(config.functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cross-Realm-Token': config.token,
      },
      body: JSON.stringify({
        query: params.query,
        ...(realms && realms.length > 0 ? { realms } : {}),
        ...(params.since_days !== undefined ? { since_days: params.since_days } : {}),
        ...(params.min_similarity !== undefined ? { min_similarity: params.min_similarity } : {}),
        ...(params.limit_per_realm !== undefined ? { limit_per_realm: params.limit_per_realm } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { hits: [], affected_realms: [], ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { hits?: RealmHit[]; affected_realms?: string[] };
    return {
      hits: Array.isArray(data.hits) ? data.hits : [],
      affected_realms: Array.isArray(data.affected_realms) ? data.affected_realms : [],
      ok: true,
    };
  } catch (e) {
    return { hits: [], affected_realms: [], ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
