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

type Node = Record<string, unknown>
const isNode = (v: unknown): v is Node =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// The steps of a JSON pointer (`#/bundles/0`), and what it points at.
const steps = (pointer: string): string[] =>
  pointer.replace(/^#\/?/, '').split('/').filter(Boolean).map((s) =>
    decodeURIComponent(s).replaceAll('~1', '/').replaceAll('~0', '~')
  )
const at = (root: unknown, pointer: string): unknown =>
  steps(pointer).reduce<unknown>(
    (v, step) => v && typeof v == 'object' ? Reflect.get(v, step) : undefined,
    root,
  )

// Where in the arguments, the way a caller names it: `bundles.0.entity`.
const pathOf = (pointer: string) => steps(pointer).join('.')

// The JSON types a schema admits: its `type`, each branch of an `anyOf` or
// `oneOf`, or the shape its `properties` or `items` imply. None at all is a
// schema that says nothing, which admits anything.
const admits = (schema: unknown): string[] => {
  if (!isNode(schema)) return []
  let said = [schema.type].flat().filter((t) => typeof t == 'string')
  let branches = [schema.anyOf, schema.oneOf]
    .flatMap((b) => Array.isArray(b) ? b.flatMap(admits) : [])
  if (said.length || branches.length) return [...said, ...branches]
  return [schema.properties && 'object', schema.items && 'array']
    .filter((t): t is string => !!t)
}

const typeOf = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

// A model often sends an argument as a string holding its JSON: `bundles:
// "[{…}]"`, `check: "true"`, `limit: "20"`. Where the schema does not take a
// string, such a string is the value it spells, when the schema admits that
// value; where it takes a string too, only an array is read, since a list sent
// as one string is never one name while JSON text is a fair string. One reading
// at this boundary for every tool, rather than a refusal the caller misreads.
// Read in place, in the copy `validateToolInput` made.
const spelled = (schema: unknown, value: unknown): unknown => {
  if (!isNode(schema)) return value
  if (typeof value == 'string') value = unquoted(admits(schema), value)
  if (Array.isArray(value) && isNode(schema.items)) {
    value.forEach((v, i) => value[i] = spelled(schema.items, v))
  } else if (
    isNode(value) && Object.getPrototypeOf(value) == Object.prototype
  ) {
    let props = isNode(schema.properties) ? schema.properties : {}
    for (let [k, v] of Object.entries(value)) {
      value[k] = spelled(props[k] ?? schema.additionalProperties, v)
    }
  }
  return value
}

const unquoted = (types: string[], text: string): unknown => {
  let named = types.includes('string')
  if (named ? !/^\s*\[/.test(text) : !types.length) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  let type = typeOf(parsed)
  let whole = type == 'number' && Number.isInteger(parsed)
  let fits = types.includes(type) || (whole && types.includes('integer'))
  return fits ? parsed : text
}

const article = (type: string) =>
  /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`
const either = (words: string[]) =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`

// What a place wants, and what it was given instead. A string that looked like
// JSON and did not parse says why and where, with the text around that place,
// and that the value itself is what to send.
const instead = (wants: string[], value: unknown): string => {
  let kinds = [...new Set(wants)]
  let wanted = `wants ${either(kinds.map(article))}`
  if (typeof value != 'string' || !/^\s*[[{]/.test(value)) {
    return `${wanted}, not ${article(typeOf(value))}`
  }
  let broken = unparsed(value)
  if (!broken) return `${wanted}, not a string`
  let whole = kinds.filter((t) => t == 'array' || t == 'object').map(article)
  let send = whole.length
    ? `. Send ${either(whole)} itself, not text that spells one`
    : ''
  return `${wanted}, not a string that is not valid JSON: ${broken}${send}`
}

// Why text is not JSON, and the text around the place it stopped parsing,
// marked `<here>`.
const unparsed = (text: string): string | undefined => {
  try {
    JSON.parse(text)
    return undefined
  } catch (e) {
    let said = (e as Error).message
    let why = said.replace(/ in JSON at position.*$/s, '')
    let at = Number(
      said.match(/at position (\d+)/)?.[1] ??
        (/end of JSON input/.test(said) ? text.length : NaN),
    )
    if (!Number.isInteger(at)) return why
    let from = Math.max(0, at - 40), to = Math.min(text.length, at + 20)
    let near = (from ? '…' : '') + text.slice(from, at) + '<here>' +
      text.slice(at, to) + (to < text.length ? '…' : '')
    return `${why} at character ${at}, here: ${near.replaceAll('\n', '\\n')}`
  }
}

// What one failed unit says is wrong at its place, in words, given the
// schema node the keyword holds and the value there; undefined where the
// validator's own words say it better.
const fault = (keyword: string, node: unknown, v: unknown) => {
  let branches = Array.isArray(node) ? node : []
  let listed = branches.map((b) => JSON.stringify(b)).join(', ')
  let missing = branches.map(String).filter((k) =>
    isNode(v) && v[k] === undefined
  )
  // The branches that only name the arguments to give, as those names.
  let names = branches.map((b) =>
    isNode(b) && Array.isArray(b.required) && !admits(b).length
      ? either(b.required.map(String))
      : ''
  )
  let types = branches.map(admits)
  switch (keyword) {
    case 'type':
      return instead([node].flat().map(String), v)
    case 'enum':
      return `wants one of ${listed}, not ${JSON.stringify(v)}`
    case 'const':
      return `wants ${JSON.stringify(node)}, not ${JSON.stringify(v)}`
    case 'required':
      return missing.length ? `missing ${either(missing)}` : undefined
    case 'false':
      return 'not allowed here'
    case 'anyOf':
    case 'oneOf':
      if (names.every(Boolean)) {
        let some = keyword == 'oneOf' ? 'exactly one' : 'at least one'
        return `wants ${some} of ${either(names)}`
      }
      return types.every((t) => t.length) ? instead(types.flat(), v) : undefined
  }
}

// Validator units that only sum up the units after them.
const SUMS = new Set([
  'properties',
  'items',
  'prefixItems',
  'additionalItems',
  'patternProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'allOf',
  '$ref',
  '$recursiveRef',
  'dependentSchemas',
  'dependencies',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
])

/**
 * Errors as one line, a clause per fault: where in the value, and what is
 * wrong there in plain words, such as `bundles: wants an array, not a string`
 * or `nope: not one of q, bundles, check`. Given the schema and the value
 * that failed, a clause says what the schema wants and what was given;
 * without them, the validator's own words. Units that only sum up the ones
 * after them are left out, and so is the validator's report of a declared
 * property that failed as an undeclared one.
 */
export const errorsText = (
  errors: OutputUnit[],
  schema?: unknown,
  value?: unknown,
): string => {
  let said: string[] = []
  let failed = new Set<string>()
  let skip = (_: OutputUnit) => false
  for (let [i, e] of errors.entries()) {
    if (skip(e)) continue
    skip = () => false
    let next = errors[i + 1]?.instanceLocation ?? ''
    let where = pathOf(e.instanceLocation)
    let to = (words: string) => said.push(where ? `${where}: ${words}` : words)
    if (e.keyword == 'properties') failed.add(next)
    if (SUMS.has(e.keyword)) continue
    if (e.keyword == 'additionalProperties') {
      // The units after it are about the key at fault. The validator reports
      // a declared key that failed its own schema here too; that is said once.
      skip = (u) =>
        u.instanceLocation == next || u.instanceLocation.startsWith(next + '/')
      if (failed.has(next)) continue
      let parent = at(schema, e.keywordLocation.replace(/\/[^/]*$/, ''))
      let props = isNode(parent) && isNode(parent.properties)
        ? Object.keys(parent.properties)
        : []
      let words = props.length
        ? `not one of ${props.join(', ')}`
        : 'not allowed here'
      said.push(`${pathOf(next)}: ${words}`)
      continue
    }
    if (e.keyword == 'anyOf' || e.keyword == 'oneOf') {
      let branch = e.keywordLocation + '/'
      skip = (u) => u.keywordLocation.startsWith(branch)
    }
    let node = at(schema, e.keywordLocation)
    let words = node === undefined && e.keyword != 'false'
      ? undefined
      : fault(e.keyword, node, at(value, e.instanceLocation))
    to(words ?? e.error.replace(/\.$/, ''))
  }
  return [...new Set(said)].join('; ')
}

// What `structuredClone` makes of a value, made here for the plain objects and
// arrays arguments are: the platform's clone costs more than every other step
// of a check together. Anything else is still the platform's to copy, or to
// refuse.
const copied = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(copied)
  if (value === null) return value
  if (!['object', 'function', 'symbol'].includes(typeof value)) return value
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return structuredClone(value)
  }
  return Object.fromEntries(
    Object.entries(value as object).map(([key, v]) => [key, copied(v)]),
  )
}

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
      into[key] = copied((prop as { default: unknown }).default)
    }
    filled(prop, into[key])
  }
}

export const validateToolInput = (
  tool: { inputSchema?: Record<string, unknown>; input?: object },
  args: Record<string, unknown>,
  refuse: (message: string) => Error = (message) => new Error(message),
): Record<string, unknown> => {
  if (!tool.inputSchema) return args
  if (tool.input) {
    throw new Error('Tool cannot declare both input and inputSchema')
  }
  const check = toolCheck(tool.inputSchema)
  const value = spelled(tool.inputSchema, copied(args)) as Record<
    string,
    unknown
  >
  filled(tool.inputSchema, value)
  const errors = check(value)
  if (errors.length) {
    throw refuse(
      'Invalid tool arguments: ' +
        errorsText(errors, tool.inputSchema, value),
    )
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
  /** Implementation revision included in a builder definition fingerprint. */
  revision?: string
  name?: string
  title?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  /** Input names in order; a final name ending in ... receives the rest. */
  positional?: readonly string[]
  /** Unmatched words preserved for another schema to parse. */
  forward?: string
  readOnly?: boolean
  /** the tool wrote its own changes and answers rows the graph already holds,
   * so the runner records the call and does not write the answer */
  applied?: boolean
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

let GRAMMAR = {
  type: 'object',
  properties: {
    positional: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.\\.\\.)?$' },
    },
    forward: { type: 'string' },
  },
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
    revision: { type: 'string' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    ...GRAMMAR.properties,
    readOnly: { type: 'boolean' },
    applied: { type: 'boolean' },
    destructive: { type: 'boolean' },
    idempotent: { type: 'boolean' },
    openWorld: { type: 'boolean' },
    surfaces: SURFACES,
    roles: ROLES,
  },
}

// Authors can edit a declaration between reads. Only equivalent copies reuse
// a validator; a changed source schema receives a new one.
const copies = new WeakMap<object, { shape: string; check: Check }>()
const copiedCheck = (
  source: Record<string, unknown>,
  copy: Record<string, unknown>,
): void => {
  const shape = JSON.stringify(copy)
  let kept = copies.get(source)
  if (!kept || kept.shape !== shape) {
    kept = { shape, check: toolCheck(copy) }
    copies.set(source, kept)
  }
  checks.set(copy, kept.check)
}

export const toolDefinition = (value: unknown): ToolDefinition => {
  const candidate = validateToolInput(
    { inputSchema: toolDefinitionSchema },
    value as Record<string, unknown>,
  ) as unknown as ToolDefinition
  // Metadata is returned detached, but copying a schema must not compile its
  // validator again. The source and its unchanged copy share the same check.
  const source = value as ToolDefinition
  for (const field of ['inputSchema', 'outputSchema'] as const) {
    if (candidate[field]) {
      copiedCheck(source[field]!, candidate[field])
    }
  }
  grammar(
    candidate.inputSchema?.properties as Record<string, unknown> ?? {},
    candidate.positional,
    candidate.forward,
  )
  return candidate
}

/** Positional inputs and flags checked against the argument properties. */
export let toolGrammar = (
  props: Record<string, unknown>,
  positional?: unknown,
  forward?: unknown,
): ToolDefinition['positional'] => {
  if (positional !== undefined || forward !== undefined) {
    let errors = toolCheck(GRAMMAR)({ positional, forward })
    if (errors.length) {
      throw new Error('Invalid tool arguments: ' + errorsText(errors))
    }
  }
  grammar(
    props,
    positional as ToolDefinition['positional'],
    forward as string | undefined,
  )
  return positional as ToolDefinition['positional']
}

let grammar = (
  props: Record<string, unknown>,
  positional?: ToolDefinition['positional'],
  forward?: string,
): void => {
  let inputs = positional ?? []
  let named = new Set<string>()
  for (let [i, value] of inputs.entries()) {
    let rest = value.endsWith('...')
    let field = rest ? value.slice(0, -3) : value
    if (rest && i != inputs.length - 1) {
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
  if (forward) {
    if (!props || !Object.hasOwn(props, forward)) {
      throw new Error(`Forward references unknown property: ${forward}`)
    }
    let prop = props[forward] as { type?: string; items?: { type?: string } }
    if (prop.type != 'array' || prop.items?.type != 'string') {
      throw new Error(`Forward option wants an array of strings: ${forward}`)
    }
  }
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
  'revision',
  'title',
  'positional',
  'forward',
  'readOnly',
  'applied',
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
