# MCP-Tool-Specs — Zwischenschicht

**Stand:** 2026-05-23
**Status:** Phase-0-Specs für die Zwischenschicht (Plan: `docs/plans/20260518_zwischenschicht-knowledge-layer.md`)

---

## Library V3 Spec-First Disziplin

Diese Specs werden **vor** den Edge-Functions geschrieben (Library V3 §4.2, im Zwischenschicht-Plan §11.3b verankert):

> Spec ist Single Source of Truth, alles andere wird daraus generiert oder geprüft.

Aus jeder Spec entstehen:
1. **MCP-Tool-Definition** in `src/tools/entity/*.ts`
2. **Test-Fixtures** in `__fixtures__/entity/`
3. **Zod-Schema** (TypeScript-Codegen-Output)
4. **Edge-Function-Input/Output-Contract** (Supabase-Side)

## Die vier Tools (V1)

| # | Tool | Funktion | Hoch-Impact? |
|---|---|---|---|
| 1 | [`entity_find`](entity/entity_find.spec.json) | Telefonbuch-Lookup: wer ist wer, cross-realm | nein |
| 2 | [`entity_links`](entity/entity_links.spec.json) | Karte: welche Edges hängen an dieser Entity | nein |
| 3 | [`decision_trace`](entity/decision_trace.spec.json) | Quellen-Chain für einen Anchor | nein |
| 4 | [`cross_realm_search`](entity/cross_realm_search.spec.json) | Volltext+Entity-Search über alle drei Räume | nein |

Alle vier Tools sind **read-only** — keine Schreibaktionen, kein Judge-Wrapper nötig (E16 betrifft nur Schreib-Pfad).

## Disziplin pro Spec

Jede Spec-Datei enthält:
- `$schema`: JSON Schema 2020-12
- `$id`: kanonische URL (für späteres Public-Hosting)
- `title`, `description`: Mensch-lesbar
- `inputSchema`: was der LLM-Caller liefert
- `outputSchema`: was das Tool zurückgibt
- `examples`: mindestens 1 Happy-Path + 1 Edge-Case
- `errorSchema`: erlaubte Fehler-Codes

## JSON-Schema-Disziplin

- Strict-Mode: `additionalProperties: false` überall
- `required[]` immer explizit
- Optionale Felder via `not required`, NICHT via `oneOf null`
- IDs als `format: uuid` typisiert
- Enums mit `enum: [...]` statt Freitext (für Predicates, realms, entity_types)

## Versionierung

Schema-Version im Frontmatter jedes Files. Aktuelle Version: `0.1.0` (Initial-Draft).
Bei Breaking-Change: Bump auf `0.2.0`, alter Output bleibt via `outputSchemaVersion`-Field lesbar.

## Welt-Modell-Bezug

Specs referenzieren das Welt-Modell unter `docs/world-model/`:
- Entity-Types kommen aus `entity-types.md`
- Predicates kommen aus `predicate-vocabulary.md`
- `realm` aus den drei Räumen: `brain`, `futursonanz`, `library`

Bei Welt-Modell-Update muss Spec-Konsistenz geprüft werden (z.B. neue Predicates in Edge-Tool-Schema reflektieren).
