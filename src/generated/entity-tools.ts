// AUTO-GENERATED from specs/entity/*.spec.json — DO NOT EDIT
// Codegen: scripts/codegen-entity-specs.ts
// Run: npm run codegen:entity-specs
// Generated at: 2026-06-11T09:35:16.610Z
//
// Library V3 §4.2: Spec ist Single Source of Truth.
// Wenn dieses File abweicht von den Specs: Codegen neu laufen lassen, NICHT manuell editieren.

import { z } from 'zod'

// ============================================================================
// cross_realm_search — Volltext+Entity-Suche über alle drei Räume (brain, futursonanz, library). Gruppiert Treffer nach Ent
// Spec: specs/entity/cross_realm_search.spec.json (v0.2.0)
// ============================================================================

// $defs (vorab definiert für $ref)
const realmHitSchema = z.object({
  "realm": z.enum(["brain", "futursonanz", "library"] as const),
  "realm_id": z.string(),
  "title": z.string(),
  "preview": z.string().max(300),
  "created_at": z.string().datetime({ offset: true }).optional(),
  "similarity": z.number().min(0).max(1),
  "matched_via": z.enum(["fulltext", "embedding", "entity_mention", "both"] as const)
}).strict()
export const crossRealmSearchInputSchema = z.object({
  "query": z.string().min(2).max(500),
  "realms": z.array(z.enum(["brain", "futursonanz", "library"] as const)).optional(),
  "depth": z.enum(["resonance", "deep"] as const).default("resonance").optional(),
  "entity_grouping": z.boolean().default(true).optional(),
  "since_days": z.number().int().min(1).max(365).optional(),
  "min_similarity": z.number().min(0).max(1).default(0.3).optional(),
  "limit_per_realm": z.number().int().min(1).max(50).default(10).optional()
}).strict()

export type CrossRealmSearchInput = z.infer<typeof crossRealmSearchInputSchema>

export const crossRealmSearchOutputSchema = z.object({
  "query": z.string(),
  "groups": z.array(z.object({
  "entity": z.object({
  "id": z.string().uuid(),
  "canonical_name": z.string(),
  "entity_type": z.enum(["person", "organization", "concept", "book", "work", "place"] as const)
}).strict(),
  "hits": z.array(realmHitSchema),
  "summary": z.string()
}).strict()),
  "results": z.array(realmHitSchema),
  "total_hits": z.number().int().min(0),
  "world_model_version": z.string()
}).strict()

export type CrossRealmSearchOutput = z.infer<typeof crossRealmSearchOutputSchema>

export const crossRealmSearchTool = {
  name: "cross_realm_search",
  description: "Volltext+Entity-Suche über alle drei Räume (brain, futursonanz, library). Gruppiert Treffer nach Entity, damit nicht 47 isolierte Hits sondern 8 thematische Cluster zurückkommen. depth=resonance (Default) sucht schnell in der Brain-Resonanzschicht; depth=deep zieht zusätzlich live aus dem vollen Kiosk- und Library-Korpus.",
  inputSchema:
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": {
        "type": "string",
        "minLength": 2,
        "maxLength": 500,
        "description": "Suchanfrage. Wird über Volltext + Embedding-Cosine ausgeführt."
      },
      "realms": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "brain",
            "futursonanz",
            "library"
          ]
        },
        "uniqueItems": true,
        "description": "Optional: Suche nur in diesen Räumen. Default: alle drei."
      },
      "depth": {
        "type": "string",
        "enum": [
          "resonance",
          "deep"
        ],
        "default": "resonance",
        "description": "resonance (Default): schnell, nur Brain-Resonanzschicht (brain_resonances/library_resonances + Brain-Volltext/-Embedding + entity_mentions), offline-fähig. deep: zusätzlich Live-Suche im vollen Kiosk-Signal- und Library-Bücher-Korpus via Edge Function (langsamer, exhaustiver)."
      },
      "entity_grouping": {
        "type": "boolean",
        "default": true,
        "description": "true: Ergebnisse nach Entity gruppieren (empfohlen). false: flache Liste."
      },
      "since_days": {
        "type": "integer",
        "minimum": 1,
        "maximum": 365,
        "description": "Optional: nur Items neuer als N Tage."
      },
      "min_similarity": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 0.3,
        "description": "Cosine-Schwelle für Embedding-Match. Niedrig = mehr Treffer."
      },
      "limit_per_realm": {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 10,
        "description": "Max Treffer pro Realm."
      }
    },
    "required": [
      "query"
    ]
  },
} as const

// ============================================================================
// decision_trace — Quellen-Chain für einen Anchor. Liefere die Memories/Signals/Bücher die wahrscheinlich zur Entscheid
// Spec: specs/entity/decision_trace.spec.json (v0.1.0)
// ============================================================================

export const decisionTraceInputSchema = z.object({
  "anchor_realm_id": z.string(),
  "anchor_realm": z.enum(["brain", "futursonanz", "library"] as const).default("brain").optional(),
  "include_unmatched_note": z.boolean().default(true).optional(),
  "roles_filter": z.array(z.enum(["evidence", "trigger", "counter"] as const)).optional(),
  "min_score": z.number().min(0).max(1).default(0.5).optional()
}).strict()

export type DecisionTraceInput = z.infer<typeof decisionTraceInputSchema>

export const decisionTraceOutputSchema = z.object({
  "trace_id": z.string().uuid(),
  "anchor": z.object({
  "realm": z.enum(["brain", "futursonanz", "library"] as const),
  "realm_id": z.string(),
  "created_at": z.string().datetime({ offset: true })
}).strict(),
  "traces": z.array(z.object({
  "source_realm": z.enum(["brain", "futursonanz", "library"] as const),
  "source_realm_id": z.string(),
  "source_title_preview": z.string().optional(),
  "role": z.enum(["evidence", "trigger", "counter"] as const),
  "score": z.number().min(0).max(1),
  "reason": z.string().max(200),
  "confirmed_by_lukas": z.boolean()
}).strict()),
  "unmatched_note": z.string().nullable().optional(),
  "lookback_days_used": z.number().int().min(1),
  "llm_decision_id": z.string().uuid().nullable().optional(),
  "world_model_version": z.string()
}).strict()

export type DecisionTraceOutput = z.infer<typeof decisionTraceOutputSchema>

export const decisionTraceTool = {
  name: "decision_trace",
  description: "Quellen-Chain für einen Anchor. Liefere die Memories/Signals/Bücher die wahrscheinlich zur Entscheidung beigetragen haben — mit Rolle (evidence/trigger/counter), Score und optional Confirmation-Status.",
  inputSchema:
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "anchor_realm_id": {
        "type": "string",
        "description": "Die Anchor-Memory-ID im Brain (oder Library/Futursonanz, falls Anchor cross-realm). Typischerweise eine Brain-Memory-UUID."
      },
      "anchor_realm": {
        "type": "string",
        "enum": [
          "brain",
          "futursonanz",
          "library"
        ],
        "default": "brain",
        "description": "Welcher Raum hostet den Anchor."
      },
      "include_unmatched_note": {
        "type": "boolean",
        "default": true,
        "description": "true: falls keine starken Quellen identifiziert, gib eine Erklärung mit."
      },
      "roles_filter": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "evidence",
            "trigger",
            "counter"
          ]
        },
        "uniqueItems": true,
        "description": "Optional: nur Traces dieser Rollen liefern."
      },
      "min_score": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 0.5
      }
    },
    "required": [
      "anchor_realm_id"
    ]
  },
} as const

// ============================================================================
// entity_find — Telefonbuch-Lookup. Finde eine Entity (Person/Organisation/Konzept/Buch/Werk/Ort) per Name oder Alia
// Spec: specs/entity/entity_find.spec.json (v0.1.0)
// ============================================================================

export const entityFindInputSchema = z.object({
  "query": z.string().min(1).max(200),
  "entity_type": z.enum(["person", "organization", "concept", "book", "work", "place"] as const).optional(),
  "realm_filter": z.array(z.enum(["brain", "futursonanz", "library"] as const)).optional(),
  "limit": z.number().int().min(1).max(20).default(5).optional()
}).strict()

export type EntityFindInput = z.infer<typeof entityFindInputSchema>

export const entityFindOutputSchema = z.object({
  "entities": z.array(z.object({
  "id": z.string().uuid(),
  "canonical_name": z.string(),
  "entity_type": z.enum(["person", "organization", "concept", "book", "work", "place"] as const),
  "aliases": z.array(z.string()),
  "notes": z.string().nullable().optional(),
  "mentions": z.array(z.object({
  "realm": z.enum(["brain", "futursonanz", "library"] as const),
  "realm_table": z.string(),
  "realm_id": z.string(),
  "realm_field": z.string().nullable().optional(),
  "confidence": z.number().min(0).max(1)
}).strict()),
  "world_model_version": z.string().optional()
}).strict()),
  "match_count": z.number().int().min(0),
  "ambiguous": z.boolean()
}).strict()

export type EntityFindOutput = z.infer<typeof entityFindOutputSchema>

export const entityFindTool = {
  name: "entity_find",
  description: "Telefonbuch-Lookup. Finde eine Entity (Person/Organisation/Konzept/Buch/Werk/Ort) per Name oder Alias und liefere alle Mentions cross-realm (brain, futursonanz, library).",
  inputSchema:
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200,
        "description": "Name oder Alias der gesuchten Entity. Beispiele: 'Becci', 'Andreas Weber', 'Energiewende'."
      },
      "entity_type": {
        "type": "string",
        "enum": [
          "person",
          "organization",
          "concept",
          "book",
          "work",
          "place"
        ],
        "description": "Optional: Type-Filter aus Welt-Modell entity-types.md."
      },
      "realm_filter": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "brain",
            "futursonanz",
            "library"
          ]
        },
        "uniqueItems": true,
        "description": "Optional: Nur Mentions aus diesen Räumen zurückgeben."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20,
        "default": 5,
        "description": "Max Anzahl Entities (bei Ambiguität mehrere Kandidaten)."
      }
    },
    "required": [
      "query"
    ]
  },
} as const

// ============================================================================
// entity_links — Karte. Liefere alle Edges (Beziehungen), die an einer Entity hängen — eingehend, ausgehend oder beid
// Spec: specs/entity/entity_links.spec.json (v0.1.0)
// ============================================================================

export const entityLinksInputSchema = z.object({
  "entity_id": z.string().uuid(),
  "predicates": z.array(z.enum(["schrieb", "gab_heraus", "uebersetzte", "zitierte", "nannte", "traf", "war_bei", "oeffnete_fuer", "praegte", "spiegelte", "widerspricht", "stuetzt", "entschied_fuer", "entschied_gegen", "arbeitet_bei", "gehoert_zu"] as const)).optional(),
  "direction": z.enum(["outgoing", "incoming", "both"] as const).default("both").optional(),
  "min_confidence": z.number().min(0).max(1).default(0.5).optional(),
  "include_proposed": z.boolean().default(false).optional(),
  "limit": z.number().int().min(1).max(100).default(30).optional()
}).strict()

export type EntityLinksInput = z.infer<typeof entityLinksInputSchema>

export const entityLinksOutputSchema = z.object({
  "edges": z.array(z.object({
  "id": z.string().uuid(),
  "subject_id": z.string().uuid(),
  "predicate": z.string(),
  "object_id": z.string().uuid(),
  "object_qualifier": z.string().nullable().optional(),
  "confidence": z.number().min(0).max(1),
  "origin": z.enum(["manual", "llm", "realm_field"] as const),
  "review_status": z.enum(["auto", "proposed", "confirmed", "rejected"] as const),
  "valid_from": z.string().datetime({ offset: true }).nullable().optional(),
  "valid_until": z.string().datetime({ offset: true }).nullable().optional(),
  "quote": z.string().nullable().optional(),
  "world_model_version": z.string(),
  "llm_decision_id": z.string().uuid().nullable().optional()
}).strict()),
  "related_entities": z.array(z.object({
  "id": z.string().uuid(),
  "canonical_name": z.string(),
  "entity_type": z.enum(["person", "organization", "concept", "book", "work", "place"] as const)
}).strict()),
  "total_edges": z.number().int().min(0),
  "filtered_out_low_confidence": z.number().int().min(0)
}).strict()

export type EntityLinksOutput = z.infer<typeof entityLinksOutputSchema>

export const entityLinksTool = {
  name: "entity_links",
  description: "Karte. Liefere alle Edges (Beziehungen), die an einer Entity hängen — eingehend, ausgehend oder beides — plus die jeweils verbundenen Entities.",
  inputSchema:
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "entity_id": {
        "type": "string",
        "format": "uuid",
        "description": "Kanonische Entity-ID aus entity_find."
      },
      "predicates": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "schrieb",
            "gab_heraus",
            "uebersetzte",
            "zitierte",
            "nannte",
            "traf",
            "war_bei",
            "oeffnete_fuer",
            "praegte",
            "spiegelte",
            "widerspricht",
            "stuetzt",
            "entschied_fuer",
            "entschied_gegen",
            "arbeitet_bei",
            "gehoert_zu"
          ]
        },
        "uniqueItems": true,
        "description": "Optional: Filter auf bestimmte Predicates. ENUM-Form ASCII (Code-Identifier-Regel aus conventions.md). Display-Form mit Umlauten via Frontend-Mapping. Bei null/leer alle."
      },
      "direction": {
        "type": "string",
        "enum": [
          "outgoing",
          "incoming",
          "both"
        ],
        "default": "both",
        "description": "outgoing: entity_id ist Subject. incoming: entity_id ist Object. both: beide."
      },
      "min_confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 0.5,
        "description": "Edges unter dieser Confidence werden ausgeblendet."
      },
      "include_proposed": {
        "type": "boolean",
        "default": false,
        "description": "true: auch unbestätigte LLM-Vorschläge (review_status='proposed'). false: nur confirmed+auto."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 30
      }
    },
    "required": [
      "entity_id"
    ]
  },
} as const

// ============================================================================
// Sammlung aller Tools — convenience für MCP-Server-Registrierung
// ============================================================================

export const entityTools = [
  crossRealmSearchTool,
  decisionTraceTool,
  entityFindTool,
  entityLinksTool,
] as const

export type EntityToolName = (typeof entityTools)[number]['name']
