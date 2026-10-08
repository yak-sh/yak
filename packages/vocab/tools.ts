/** JSON Schema validation for portable tool arguments, and the tool
 * declarations a vocabulary carries. Compiled once per schema. */
import { type OutputUnit, type Schema, Validator } from '@cfworker/json-schema'
import type { PropSchema, VocabDoc } from './types.ts'

// A schema is interpreted, never compiled to code: a Cloudflare Worker refuses
// `new Function`, so a validator that generates code (ajv) refused every
// argument check a Store ran (T-37978). Each schema is read in the dialect it
// declares, since 2020-12 changed tuple and ref semantics; one that declares
// none is read as 2020-12.
const DIALECTS: Record<string, '7' | '2019-09' | '2020-12'> = {
  'https://json-schema.org/draft/2020-12/schema': '2020-12',
  'https://json-schema.org/draft/2020-12/schema#': '2020-12',
  'http://json-schema.org/draft-07/schema#': '7',
  'http://json-schema.org/draft-07/schema': '7',
  'https://json-schema.org/draft/2019-09/schema': '2019-09',
  'https://json-schema.org/draft/2019-09/schema#': '2019-09',
}

const dialectOf = (schema: Record<string, unknown>) => {
  const uri = schema.$schema
  if (uri === undefined) return '2020-12'
  const dialect = DIALECTS[String(uri)]
  if (!dialect) {
    throw new Error('Unsupported tool JSON Schema dialect: ' + String(uri))
  }
  return dialect
}

/** A compiled schema: the errors a value has against it, none when valid. */
export type Check = (value: unknown) => OutputUnit[]

const checks = new WeakMap<object, Check>()

/** The check for a schema, compiled once per schema object. */
export const toolCheck = (schema: Record<string, unknown>): Check => {
  let check = checks.get(schema)
  if (!check) {
    const validator = new Validator(schema as Schema, dialectOf(schema), false)
    // Checked as the JSON it stands for: a property set to `undefined` is one
    // left out, which the validator would otherwise refuse as no JSON type.
    check = (value) => {
      const json = value === undefined
        ? value
        : JSON.parse(JSON.stringify(value))
      const result = validator.validate(json)
      return result.valid ? [] : result.errors
    }
    checks.set(schema, check)
  }
  return check
}

/** Errors as one line: where in the value, and what is wrong there. */
export const errorsText = (errors: OutputUnit[]): string =>
  errors.map((e) => `${e.instanceLocation || '#'} ${e.error}`).join('; ')

// An argument left out takes the `default` its schema declares, the way a
// command line's `--limit` does, down through nested object properties.
const filled = (schema: unknown, value: unknown): void => {
  if (!schema || typeof schema != 'object') return
  if (!value || typeof value != 'object' || Array.isArray(value)) return
  const props = (schema as { properties?: Record<string, unknown> }).properties
  const into = value as Record<string, unknown>
  for (const [key, prop] of Object.entries(props ?? {})) {
    if (!prop || typeof prop != 'object') continue
    if (into[key] === undefined && 'default' in prop) {
      into[key] = structuredClone((prop as { default: unknown }).default)
    }
    filled(prop, into[key])
  }
}

export const validateToolInput = (
  tool: { inputSchema?: Record<string, unknown>; input?: object },
  args: Record<string, unknown>,
): Record<string, unknown> => {
  if (!tool.inputSchema) return args
  if (tool.input) {
    throw new Error('Tool cannot declare both input and inputSchema')
  }
  const check = toolCheck(tool.inputSchema)
  const value = structuredClone(args)
  filled(tool.inputSchema, value)
  const errors = check(value)
  if (errors.length) {
    throw new Error('Invalid tool arguments: ' + errorsText(errors))
  }
  return value
}

/** Validate the emitted object without applying defaults or changing the result. */
export const validateToolOutput = (
  tool: { outputSchema?: Record<string, unknown> },
  value: unknown,
): void => {
  if (!tool.outputSchema) return
  const errors = toolCheck(tool.outputSchema)(value)
  if (errors.length) {
    throw new Error('Invalid tool result: ' + errorsText(errors))
  }
}

/** Serializable tool metadata; independent of component declarations. */
export type ToolDefinition = {
  /** the words a command line accepts for it: both, in either order
   * (`session list`, `list session`); or one alone, which is then the whole
   * command and the whole transport name (`history`). A tool that already has
   * a name of its own (`land`) declares neither (@yaks/graph `toolName`). */
  noun?: string
  verb?: string
  description: string
  name?: string
  title?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  /** Input names in order; a final name ending in ... receives the rest. */
  positional?: readonly string[]
  /** Unmatched words preserved for another schema to parse. */
  forward?: string
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
  /** where it is offered — `cli`, `mcp`; every surface when absent */
  surfaces?: ('cli' | 'mcp')[]
  /** the roles the process running it serves (@yaks/cli `ROLES`), where it
   * needs more than the graph every tool runs over — `serve`, which answers
   * HTTP, serves `web` */
  roles?: Role[]
}

/** A role a process serves over a graph (@yaks/cli `ROLES`). */
export type Role = 'graph' | 'web' | 'effects'

// Where a tool is offered; the same list the meta-schema allows. An empty
// list is a tool no door offers, which only code calls.
let SURFACES = {
  type: 'array',
  uniqueItems: true,
  items: { enum: ['cli', 'mcp'] },
}

// The roles a tool's process serves; the same list the meta-schema allows.
let ROLES = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { enum: ['graph', 'web', 'effects'] },
}

/** JSON Schema for tool declarations. Their location within vocab.json is not fixed. */
export const toolDefinitionSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['description'],
  // A noun, a verb, both, or neither: two words are a command line accepted in
  // either order, and one word is a one-word command. The entry's own key is
  // the tool's name either way.
  additionalProperties: false,
  properties: {
    noun: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    verb: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    name: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    description: { type: 'string' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    positional: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.\\.\\.)?$' },
    },
    forward: { type: 'string' },
    readOnly: { type: 'boolean' },
    destructive: { type: 'boolean' },
    idempotent: { type: 'boolean' },
    openWorld: { type: 'boolean' },
    surfaces: SURFACES,
    roles: ROLES,
  },
}

export const toolDefinition = (value: unknown): ToolDefinition => {
  const candidate = validateToolInput(
    { inputSchema: toolDefinitionSchema },
    value as Record<string, unknown>,
  ) as unknown as ToolDefinition
  if (candidate.inputSchema) toolCheck(candidate.inputSchema)
  if (candidate.outputSchema) toolCheck(candidate.outputSchema)
  const props = candidate.inputSchema?.properties as
    | Record<string, unknown>
    | undefined
  const positional = candidate.positional ?? []
  let named = new Set<string>()
  for (let [i, value] of positional.entries()) {
    let rest = value.endsWith('...')
    let field = rest ? value.slice(0, -3) : value
    if (rest && i != positional.length - 1) {
      throw new Error('Only the final positional input may receive the rest')
    }
    if (named.has(field)) {
      throw new Error(`Duplicate positional input: ${field}`)
    }
    named.add(field)
    if (!props || !Object.hasOwn(props, field)) {
      throw new Error(`Positional references unknown property: ${field}`)
    }
    let prop = props[field] as { type?: string; items?: { type?: string } }
    if (rest && prop.type != 'string' && prop.type != 'array') {
      throw new Error(`Rest positional wants a string or array: ${field}`)
    }
  }
  let shorts = new Set<string>()
  for (let [field, schema] of Object.entries(props ?? {})) {
    let short = schema && typeof schema == 'object'
      ? (schema as { short?: unknown }).short
      : undefined
    if (short === undefined) continue
    if (typeof short != 'string' || !/^[a-zA-Z]$/.test(short)) {
      throw new Error(`Short flag wants one letter: ${field}`)
    }
    if (shorts.has(short)) throw new Error(`Duplicate short flag: ${short}`)
    shorts.add(short)
  }
  let forward = candidate.forward
  if (forward) {
    if (!props || !Object.hasOwn(props, forward)) {
      throw new Error(`Forward references unknown property: ${forward}`)
    }
    let prop = props[forward] as { type?: string; items?: { type?: string } }
    if (prop.type != 'array' || prop.items?.type != 'string') {
      throw new Error(`Forward option wants an array of strings: ${forward}`)
    }
  }
  return candidate
}

// A tool's arguments as one object schema. A declaration writes them the way a
// component declares properties — one schema per named argument — and
// everything downstream (the CLI's argument parser, an MCP `tools/list`, a
// shell completion) reads the object schema, so the conversion happens once,
// here.
let inputOf = (entry: PropSchema): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: entry.input ?? {},
  ...entry.required?.length ? { required: entry.required } : {},
})

// The keywords in a declaration that belong to the tool, not to the schema.
let HINTS = [
  'title',
  'positional',
  'forward',
  'readOnly',
  'destructive',
  'idempotent',
  'openWorld',
  'outputSchema',
  'surfaces',
  'roles',
] as const

/**
 * The tool declarations one or more vocabulary documents carry, read without
 * validating them: every `$defs` entry marked `tool: true`, with its `input`
 * map converted to the one object schema everything downstream reads. The
 * entry's name is the tool's name, so an implementation is looked up by the
 * name the vocabulary used.
 *
 * Nothing is validated here. {@link toolsIn} is the same read with validation,
 * and it is what a program loading somebody else's plugin wants; this one is
 * for a document whose declarations are validated where they are authored (a
 * package's own vocab.json, against the meta-schema, in its tests).
 *
 * `loadVocab` skips tool entries; this skips everything else. A document is
 * read once for its components and once for its tools, and neither reading has
 * to know about the other.
 */
export let toolsSaid = (input: VocabDoc | VocabDoc[]): ToolDefinition[] =>
  entries(input).map(([name, entry]) => said(name, entry))

// Every `$defs` entry marked `tool: true`, by name; a name declared twice is
// refused.
let entries = (input: VocabDoc | VocabDoc[]): [string, Entry][] => {
  let docs = Array.isArray(input) ? input : [input]
  let out: [string, Entry][] = []
  let seen = new Set<string>()
  for (let doc of docs) {
    for (let [name, entry] of Object.entries(doc.$defs ?? {})) {
      if (entry?.tool !== true) continue
      if (seen.has(name)) throw new Error(`tool '${name}' is declared twice`)
      seen.add(name)
      out.push([name, entry])
    }
  }
  return out
}

type Entry = NonNullable<VocabDoc['$defs']>[string]

let said = (name: string, entry: Entry): ToolDefinition => {
  let said: Record<string, unknown> = {
    name,
    noun: entry.noun,
    verb: entry.verb,
    description: entry.description,
    inputSchema: inputOf(entry),
  }
  for (let k of HINTS) if (entry[k] !== undefined) said[k] = entry[k]
  return said as unknown as ToolDefinition
}

// A declaration is checked once however many documents and graphs carry it:
// a host stamps each plugin's documents with the package that brought them, a
// copy sharing the original's `$defs`, so the copy's tools are the original's.
// Its argument schemas stay the same objects, so each one's check compiles
// once.
let checked = new WeakMap<Entry, { name: string; definition: ToolDefinition }>()

/** The tool declarations one or more vocab documents carry, checked: every
 * entry {@link toolsSaid} read, put through {@link toolDefinition} — the
 * meta-schema, the dialect of each argument schema, and the positional inputs naming
 * properties that exist. The same input answers the same definitions. */
export let toolsIn = (input: VocabDoc | VocabDoc[]): ToolDefinition[] =>
  entries(input).map(([name, entry]) => {
    let kept = checked.get(entry)
    if (kept?.name == name) return kept.definition
    let definition = toolDefinition(said(name, entry))
    checked.set(entry, { name, definition })
    return definition
  })

/** The schema a transport publishes, with command-line hints removed. */
export let publicToolSchema = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  let props = schema.properties as Record<string, unknown> | undefined
  if (!props) return schema
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(props).map(([name, prop]) => {
        if (!prop || typeof prop != 'object' || Array.isArray(prop)) {
          return [name, prop]
        }
        let { short: _short, ...published } = prop as Record<string, unknown>
        return [name, published]
      }),
    ),
  }
}

/** Grammar for published readers that still use the former options shape. */
export let legacyOptions = (
  tool: Pick<ToolDefinition, 'positional' | 'forward' | 'inputSchema'>,
): {
  positional?: readonly string[]
  rest?: string
  short?: Record<string, string>
  forward?: string
} => {
  let positional = tool.positional ?? []
  let last = positional.at(-1)
  let rest = last?.endsWith('...') ? last.slice(0, -3) : undefined
  let props = tool.inputSchema?.properties as
    | Record<string, unknown>
    | undefined
  let short = Object.fromEntries(
    Object.entries(props ?? {}).flatMap(([name, prop]) => {
      let alias = prop && typeof prop == 'object'
        ? (prop as { short?: string }).short
        : undefined
      return alias ? [[alias, name]] : []
    }),
  )
  return {
    ...(positional.length
      ? { positional: positional.filter((p) => !p.endsWith('...')) }
      : {}),
    ...(rest ? { rest } : {}),
    ...(Object.keys(short).length ? { short } : {}),
    ...(tool.forward ? { forward: tool.forward } : {}),
  }
}
