/** JSON Schema validation for portable tool arguments, and the tool
 * declarations a vocabulary carries. Compiled once per schema. */
import { Ajv, type ValidateFunction } from 'ajv'
import type { PropSchema, VocabDoc } from './types.ts'
import { Ajv2019 } from 'ajv/dist/2019.js'
import { Ajv2020 } from 'ajv/dist/2020.js'

// Keep dialects in separate instances: 2020-12 changed tuple and ref semantics.
// Schemas without a declaration retain this package's 2020-12 default.
const dialects = (useDefaults: boolean) => {
  const options = {
    strict: false,
    allErrors: true,
    useDefaults,
    addUsedSchema: false,
  }
  const current = new Ajv2020(options)
  const draft7 = new Ajv(options)
  const draft2019 = new Ajv2019(options)
  return (schema: Record<string, unknown>) => {
    const uri = schema.$schema
    if (
      uri === undefined ||
      uri === 'https://json-schema.org/draft/2020-12/schema' ||
      uri === 'https://json-schema.org/draft/2020-12/schema#'
    ) return current
    if (
      uri === 'http://json-schema.org/draft-07/schema#' ||
      uri === 'http://json-schema.org/draft-07/schema'
    ) return draft7
    if (
      uri === 'https://json-schema.org/draft/2019-09/schema' ||
      uri === 'https://json-schema.org/draft/2019-09/schema#'
    ) return draft2019
    throw new Error('Unsupported tool JSON Schema dialect: ' + String(uri))
  }
}
const inputDialect = dialects(true)
const ajv = inputDialect({})
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>()

export const validateToolInput = (
  tool: { inputSchema?: Record<string, unknown>; input?: object },
  args: Record<string, unknown>,
): Record<string, unknown> => {
  if (!tool.inputSchema) return args
  if (tool.input) {
    throw new Error('Tool cannot declare both input and inputSchema')
  }
  let validate = validators.get(tool.inputSchema)
  if (!validate) {
    validate = inputDialect(tool.inputSchema).compile(tool.inputSchema)
    validators.set(tool.inputSchema, validate)
  }
  const value = structuredClone(args)
  if (!validate(value)) {
    throw new Error(
      'Invalid tool arguments: ' + ajv.errorsText(validate.errors),
    )
  }
  return value
}

/** Validate the emitted object without applying defaults or changing the result. */
const outputDialect = dialects(false)
const outputAjv = outputDialect({})
const outputValidators = new WeakMap<
  object,
  ReturnType<typeof outputAjv.compile>
>()

/** Compile a non-mutating validator using the schema's declared dialect. */
export const toolOutputValidator = (
  schema: Record<string, unknown>,
): ValidateFunction => {
  let validate = outputValidators.get(schema)
  if (!validate) {
    validate = outputDialect(schema).compile(schema)
    outputValidators.set(schema, validate)
  }
  return validate
}

export const validateToolOutput = (
  tool: { outputSchema?: Record<string, unknown> },
  value: unknown,
): void => {
  if (!tool.outputSchema) return
  const validate = toolOutputValidator(tool.outputSchema)
  if (!validate(value)) {
    throw new Error(
      'Invalid tool result: ' + outputAjv.errorsText(validate.errors),
    )
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
  options?: {
    positional?: readonly string[]
    short?: Readonly<Record<string, string>>
  }
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
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
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        positional: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string' },
        },
        short: {
          type: 'object',
          propertyNames: { pattern: '^[a-zA-Z]$' },
          additionalProperties: { type: 'string' },
        },
        rest: { type: 'string' },
      },
    },
    readOnly: { type: 'boolean' },
    destructive: { type: 'boolean' },
    idempotent: { type: 'boolean' },
    openWorld: { type: 'boolean' },
  },
}

export const toolDefinition = (value: unknown): ToolDefinition => {
  const candidate = validateToolInput(
    { inputSchema: toolDefinitionSchema },
    value as Record<string, unknown>,
  ) as unknown as ToolDefinition
  if (candidate.inputSchema) {
    inputDialect(candidate.inputSchema).compile(candidate.inputSchema)
  }
  if (candidate.outputSchema) {
    outputDialect(candidate.outputSchema).compile(candidate.outputSchema)
  }
  const props = candidate.inputSchema?.properties as
    | Record<string, unknown>
    | undefined
  for (
    const field of [
      ...candidate.options?.positional ?? [],
      ...Object.values(candidate.options?.short ?? {}),
    ]
  ) {
    if (!props || !Object.hasOwn(props, field)) {
      throw new Error(`Option references unknown property: ${field}`)
    }
  }
  return candidate
}

// A tool's arguments as one object schema. A declaration writes them the way a
// component declares columns — one schema per named argument — and everything
// downstream (the CLI's argument parser, an MCP `tools/list`, a shell
// completion) reads the object schema, so the conversion happens once, here.
let inputOf = (entry: PropSchema): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: entry.input ?? {},
  ...entry.required?.length ? { required: entry.required } : {},
})

// The keywords in a declaration that belong to the TOOL, not to the schema.
let HINTS = [
  'title',
  'options',
  'readOnly',
  'destructive',
  'idempotent',
  'openWorld',
  'outputSchema',
] as const

/**
 * The tool declarations one or more vocabulary documents carry, read without
 * validating them: every `$defs` entry marked `tool: true`, with its `input`
 * map converted to the one object schema everything downstream reads. The
 * entry's NAME is the tool's name, so an implementation is looked up by the
 * name the vocabulary used.
 *
 * Nothing is validated here. {@link toolsIn} is the same read with validation,
 * and it is what a program loading somebody else's plugin wants; this one is
 * for a document whose declarations are validated where they are AUTHORED (a
 * package's own vocab.json, against the meta-schema, in its tests). It is also
 * the only read that works where generating code from strings is forbidden,
 * such as in a Cloudflare Worker, since ajv validates a schema by compiling it
 * into a function.
 *
 * `loadVocab` skips tool entries; this skips everything else. A document is
 * read once for its components and once for its tools, and neither reading has
 * to know about the other.
 */
export let toolsSaid = (input: VocabDoc | VocabDoc[]): ToolDefinition[] => {
  let docs = Array.isArray(input) ? input : [input]
  let out: ToolDefinition[] = []
  let seen = new Set<string>()
  for (let doc of docs) {
    for (let [name, entry] of Object.entries(doc.$defs ?? {})) {
      if (entry?.tool !== true) continue
      if (seen.has(name)) throw new Error(`tool '${name}' is declared twice`)
      seen.add(name)
      let said: Record<string, unknown> = {
        name,
        noun: entry.noun,
        verb: entry.verb,
        description: entry.description,
        inputSchema: inputOf(entry),
      }
      for (let k of HINTS) if (entry[k] !== undefined) said[k] = entry[k]
      out.push(said as unknown as ToolDefinition)
    }
  }
  return out
}

/** The tool declarations one or more vocab documents carry, CHECKED: every
 * entry {@link toolsSaid} read, put through {@link toolDefinition} — the
 * meta-schema, the dialect of each argument schema, and the options naming
 * properties that exist. */
export let toolsIn = (input: VocabDoc | VocabDoc[]): ToolDefinition[] =>
  toolsSaid(input).map((said) => toolDefinition(said))
