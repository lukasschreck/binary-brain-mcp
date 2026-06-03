// Smoke-Test: validiert generierte Zod-Schemas gegen Spec-Examples.
// Library V3 §4.6: Schema-Compliance ist Pflicht-Test.
// Run: npm test src/generated/__tests__/entity-tools.test.ts

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  entityFindInputSchema,
  entityFindOutputSchema,
  entityLinksInputSchema,
  entityLinksOutputSchema,
  decisionTraceInputSchema,
  decisionTraceOutputSchema,
  crossRealmSearchInputSchema,
  crossRealmSearchOutputSchema,
  entityTools,
} from '../entity-tools.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPECS_DIR = resolve(__dirname, '..', '..', '..', 'specs', 'entity')

interface SpecExample {
  name: string
  input: unknown
  output?: unknown
  error?: unknown
}

interface Spec {
  tool: { name: string }
  examples?: SpecExample[]
}

function loadSpec(filename: string): Spec {
  const raw = readFileSync(join(SPECS_DIR, filename), 'utf8')
  return JSON.parse(raw) as Spec
}

const SCHEMAS: Record<string, { input: typeof entityFindInputSchema; output: typeof entityFindOutputSchema }> = {
  entity_find: { input: entityFindInputSchema, output: entityFindOutputSchema as unknown as typeof entityFindOutputSchema },
  entity_links: { input: entityLinksInputSchema as unknown as typeof entityFindInputSchema, output: entityLinksOutputSchema as unknown as typeof entityFindOutputSchema },
  decision_trace: { input: decisionTraceInputSchema as unknown as typeof entityFindInputSchema, output: decisionTraceOutputSchema as unknown as typeof entityFindOutputSchema },
  cross_realm_search: { input: crossRealmSearchInputSchema as unknown as typeof entityFindInputSchema, output: crossRealmSearchOutputSchema as unknown as typeof entityFindOutputSchema },
}

describe('Generated entity-tools — Spec-Example-Roundtrip', () => {
  const specFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.spec.json')).sort()

  for (const file of specFiles) {
    const spec = loadSpec(file)
    const toolName = spec.tool.name
    const schemas = SCHEMAS[toolName]

    describe(`tool: ${toolName}`, () => {
      it('hat passende Schemas in generated module', () => {
        expect(schemas).toBeDefined()
      })

      for (const ex of spec.examples ?? []) {
        it(`input "${ex.name}" validiert gegen inputSchema`, () => {
          const parsed = schemas.input.safeParse(ex.input)
          if (!parsed.success) {
            // eslint-disable-next-line no-console
            console.error(`Input "${ex.name}" failed validation:`, parsed.error.issues)
          }
          expect(parsed.success).toBe(true)
        })

        if (ex.output !== undefined) {
          it(`output "${ex.name}" validiert gegen outputSchema`, () => {
            const parsed = schemas.output.safeParse(ex.output)
            if (!parsed.success) {
              // eslint-disable-next-line no-console
              console.error(`Output "${ex.name}" failed validation:`, parsed.error.issues)
            }
            expect(parsed.success).toBe(true)
          })
        }
      }
    })
  }
})

describe('Generated entity-tools — Tool-Inventory', () => {
  it('exportiert genau 4 entity-Tools', () => {
    expect(entityTools).toHaveLength(4)
  })

  it('Tool-Namen entsprechen Spec-Namen', () => {
    const names = entityTools.map((t) => t.name).sort()
    expect(names).toEqual(['cross_realm_search', 'decision_trace', 'entity_find', 'entity_links'])
  })

  it('Jedes Tool hat description + inputSchema', () => {
    for (const tool of entityTools) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema).toBeDefined()
      expect((tool.inputSchema as { type?: string }).type).toBe('object')
    }
  })
})
