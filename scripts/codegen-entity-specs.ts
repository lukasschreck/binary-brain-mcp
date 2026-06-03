// Codegen — JSON-Schema-Specs → Zod + TypeScript Tool-Definitionen
// Plan: docs/plans/20260518_zwischenschicht-knowledge-layer.md §11.3b (MCP-First Disziplin)
// Library V3 §4.2: Spec ist Single Source of Truth.
//
// Liest:   binary-brain-mcp/specs/entity/*.spec.json (vier Tool-Specs)
// Schreibt: binary-brain-mcp/src/generated/entity-tools.ts (Zod + Types + Tool-Defs)
//
// Run: npm run codegen:entity-specs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SPECS_DIR = join(ROOT, 'specs', 'entity')
const OUT_FILE = join(ROOT, 'src', 'generated', 'entity-tools.ts')

interface JsonSchema {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: (string | number | boolean)[]
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  uniqueItems?: boolean
  additionalProperties?: boolean | JsonSchema
  default?: unknown
  $ref?: string
  $defs?: Record<string, JsonSchema>
}

interface ToolSpec {
  $schema: string
  $id: string
  specVersion: string
  tool: {
    name: string
    description: string
    purpose?: string
    readOnly?: boolean
    impact?: string
    worldModelDependency?: string
  }
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  $defs?: Record<string, JsonSchema>
  errorSchema?: JsonSchema
  examples?: unknown[]
}

// ---------------------------------------------------------------------------
// JSON Schema → Zod string converter
// ---------------------------------------------------------------------------

class ZodConverter {
  constructor(private defs: Record<string, JsonSchema> = {}) {}

  convert(schema: JsonSchema, isRequired = true): string {
    if (schema.$ref) {
      const refName = schema.$ref.replace('#/$defs/', '')
      return this.applyModifiers(`${refName}Schema`, isRequired, schema)
    }

    const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : [])
    const nullable = types.includes('null')
    const nonNullTypes = types.filter((t) => t !== 'null')
    const primaryType = nonNullTypes[0]

    let zod: string

    if (schema.enum) {
      const values = schema.enum.map((v) => JSON.stringify(v)).join(', ')
      zod = `z.enum([${values}] as const)`
    } else if (primaryType === 'object') {
      zod = this.objectToZod(schema)
    } else if (primaryType === 'array') {
      const itemSchema = schema.items ? this.convert(schema.items, true) : 'z.unknown()'
      zod = `z.array(${itemSchema})`
      if (schema.uniqueItems) zod = `${zod}` // Note: Zod hat kein uniqueItems, Validation extern
    } else if (primaryType === 'string') {
      zod = 'z.string()'
      if (schema.minLength !== undefined) zod += `.min(${schema.minLength})`
      if (schema.maxLength !== undefined) zod += `.max(${schema.maxLength})`
      if (schema.format === 'uuid') zod += '.uuid()'
      if (schema.format === 'date-time') zod += '.datetime({ offset: true })'
    } else if (primaryType === 'integer') {
      zod = 'z.number().int()'
      if (schema.minimum !== undefined) zod += `.min(${schema.minimum})`
      if (schema.maximum !== undefined) zod += `.max(${schema.maximum})`
    } else if (primaryType === 'number') {
      zod = 'z.number()'
      if (schema.minimum !== undefined) zod += `.min(${schema.minimum})`
      if (schema.maximum !== undefined) zod += `.max(${schema.maximum})`
    } else if (primaryType === 'boolean') {
      zod = 'z.boolean()'
    } else {
      zod = 'z.unknown()'
    }

    return this.applyModifiers(zod, isRequired, schema, nullable)
  }

  private applyModifiers(zod: string, isRequired: boolean, schema: JsonSchema, nullable = false): string {
    let result = zod
    if (nullable) result = `${result}.nullable()`
    if (schema.default !== undefined) {
      result = `${result}.default(${JSON.stringify(schema.default)})`
    }
    if (!isRequired) result = `${result}.optional()`
    return result
  }

  private objectToZod(schema: JsonSchema): string {
    const props = schema.properties ?? {}
    const required = new Set(schema.required ?? [])
    const lines: string[] = []
    for (const [key, propSchema] of Object.entries(props)) {
      const isRequired = required.has(key)
      const zodValue = this.convert(propSchema, isRequired)
      lines.push(`  ${JSON.stringify(key)}: ${zodValue}`)
    }
    const body = lines.join(',\n')
    const strict = schema.additionalProperties === false ? '.strict()' : ''
    return `z.object({\n${body}\n})${strict}`
  }

  generateDefs(): string {
    if (Object.keys(this.defs).length === 0) return ''
    const lines: string[] = ['// $defs (vorab definiert für $ref)']
    for (const [name, def] of Object.entries(this.defs)) {
      const zod = this.convert(def, true)
      lines.push(`const ${name}Schema = ${zod}`)
    }
    return lines.join('\n') + '\n'
  }
}

// ---------------------------------------------------------------------------
// Spec → TS code blocks
// ---------------------------------------------------------------------------

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function pascalCase(s: string): string {
  const camel = snakeToCamel(s)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function specToBlock(spec: ToolSpec): string {
  const toolName = spec.tool.name
  const camel = snakeToCamel(toolName)
  const pascal = pascalCase(toolName)

  // $defs leben in JSON-Schema 2020-12 typischerweise auf top-level der Spec.
  // Fallback: auch in inputSchema/outputSchema suchen (für ältere Specs).
  const allDefs: Record<string, JsonSchema> = {
    ...(spec.$defs ?? {}),
    ...((spec.inputSchema as JsonSchema & { $defs?: Record<string, JsonSchema> }).$defs ?? {}),
    ...((spec.outputSchema as JsonSchema & { $defs?: Record<string, JsonSchema> }).$defs ?? {}),
  }
  const converter = new ZodConverter(allDefs)

  const defsCode = converter.generateDefs()
  const inputZod = converter.convert(spec.inputSchema, true)
  const outputZod = converter.convert(spec.outputSchema, true)

  const inputSchemaJson = JSON.stringify(spec.inputSchema, null, 2)
    .split('\n').map((l) => '  ' + l).join('\n')

  return `// ============================================================================
// ${toolName} — ${spec.tool.description.replace(/\n/g, ' ').slice(0, 100)}
// Spec: specs/entity/${toolName}.spec.json (v${spec.specVersion})
// ============================================================================

${defsCode}export const ${camel}InputSchema = ${inputZod}

export type ${pascal}Input = z.infer<typeof ${camel}InputSchema>

export const ${camel}OutputSchema = ${outputZod}

export type ${pascal}Output = z.infer<typeof ${camel}OutputSchema>

export const ${camel}Tool = {
  name: ${JSON.stringify(toolName)},
  description: ${JSON.stringify(spec.tool.description)},
  inputSchema:
${inputSchemaJson},
} as const
`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const files = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith('.spec.json'))
    .sort()

  if (files.length === 0) {
    throw new Error(`No spec files found in ${SPECS_DIR}`)
  }

  const blocks: string[] = []
  const exportedTools: string[] = []

  for (const file of files) {
    const path = join(SPECS_DIR, file)
    const raw = readFileSync(path, 'utf8')
    const spec = JSON.parse(raw) as ToolSpec
    if (!spec.tool?.name) {
      throw new Error(`Spec ${file} missing tool.name`)
    }
    blocks.push(specToBlock(spec))
    exportedTools.push(`${snakeToCamel(spec.tool.name)}Tool`)
  }

  const header = `// AUTO-GENERATED from specs/entity/*.spec.json — DO NOT EDIT
// Codegen: scripts/codegen-entity-specs.ts
// Run: npm run codegen:entity-specs
// Generated at: ${new Date().toISOString()}
//
// Library V3 §4.2: Spec ist Single Source of Truth.
// Wenn dieses File abweicht von den Specs: Codegen neu laufen lassen, NICHT manuell editieren.

import { z } from 'zod'
`

  const footer = `// ============================================================================
// Sammlung aller Tools — convenience für MCP-Server-Registrierung
// ============================================================================

export const entityTools = [
  ${exportedTools.join(',\n  ')},
] as const

export type EntityToolName = (typeof entityTools)[number]['name']
`

  const output = [header, ...blocks, footer].join('\n')

  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, output, 'utf8')

  // eslint-disable-next-line no-console
  console.log(`Codegen OK: ${files.length} specs → ${OUT_FILE.replace(ROOT + '/', '')}`)
  console.log(`Exported tools: ${exportedTools.join(', ')}`)
}

main()
