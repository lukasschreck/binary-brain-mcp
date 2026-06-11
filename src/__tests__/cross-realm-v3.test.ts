/**
 * Tests für cross-realm-v3 — V3 Live-Korpus-Client (depth='deep').
 * Mockt fetch; kein Netz. Plan: docs/plans/20260611_cross-realm-search-v2.md (Phase 5)
 */

import { describe, it, expect } from 'vitest';
import { fetchV3Hits, type CrossRealmV3Config } from '../search/cross-realm-v3.js';
import type { RealmHit } from '../storage/adapter.js';

const config: CrossRealmV3Config = { functionUrl: 'https://example.test/fn', token: 's3cr3t' };

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('fetchV3Hits', () => {
  it('mappt hits + affected_realms bei Erfolg', async () => {
    const hits: RealmHit[] = [{ realm: 'futursonanz', realm_id: 's1', title: 'T', preview: 'p', similarity: 0.7, matched_via: 'embedding' }];
    const fake = (async () => okResponse({ hits, affected_realms: ['library'] })) as unknown as typeof fetch;
    const r = await fetchV3Hits(config, { query: 'KI' }, fake);
    expect(r.ok).toBe(true);
    expect(r.hits).toHaveLength(1);
    expect(r.affected_realms).toEqual(['library']);
  });

  it('sendet Token-Header und filtert brain aus den realms', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return okResponse({ hits: [], affected_realms: [] });
    }) as unknown as typeof fetch;

    await fetchV3Hits(config, { query: 'KI', realms: ['brain', 'futursonanz'], since_days: 7, limit_per_realm: 5 }, fake);

    expect(captured!.url).toBe(config.functionUrl);
    expect((captured!.init.headers as Record<string, string>)['X-Cross-Realm-Token']).toBe('s3cr3t');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.realms).toEqual(['futursonanz']); // brain entfernt
    expect(body.since_days).toBe(7);
    expect(body.limit_per_realm).toBe(5);
  });

  it('lässt realms weg, wenn nach brain-Filter nichts übrig bleibt', async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return okResponse({ hits: [], affected_realms: [] });
    }) as unknown as typeof fetch;
    await fetchV3Hits(config, { query: 'KI', realms: ['brain'] }, fake);
    expect('realms' in body).toBe(false);
  });

  it('HTTP-Fehler → ok:false mit Status', async () => {
    const fake = (async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const r = await fetchV3Hits(config, { query: 'KI' }, fake);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('HTTP 401');
    expect(r.hits).toEqual([]);
  });

  it('Netz-/Abort-Fehler → ok:false, leere hits (graceful)', async () => {
    const fake = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await fetchV3Hits(config, { query: 'KI' }, fake);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('network down');
    expect(r.hits).toEqual([]);
  });

  it('defensiv gegen fehlende Felder in der Response', async () => {
    const fake = (async () => okResponse({})) as unknown as typeof fetch;
    const r = await fetchV3Hits(config, { query: 'KI' }, fake);
    expect(r.ok).toBe(true);
    expect(r.hits).toEqual([]);
    expect(r.affected_realms).toEqual([]);
  });
});
