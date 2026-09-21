// What a tool a SERVER lists is to this client: the two fields `tools/list`
// always carries, the input schema it publishes, and nothing about what it
// does. A `Listed` is not yet something to run — platform.ts is what turns one
// into a @yaks/graph `Tool` whose `run` makes the call — but the mapper
// (args.ts), the help (show.ts) and the cache (store.ts) read both shapes
// through the types here, so a field the server adds costs nothing to carry
// and a field it drops is a type error in one place.

/** One property of an input schema, as far as this client reads it: enough to
 * decide how the word on the command line becomes a value. */
export type Prop = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: Prop
  default?: unknown
  /** native JSON Schema, and what a completion offers when nothing else
   * narrows the word (@yaks/vocab: a text column's examples union its own live
   * values) */
  examples?: unknown[]
  /** the component this argument names an entity of — what a completion reads
   * ids out of */
  ref?: string
  /** true = this text is matched by words, so a completion asks the index */
  search?: boolean
}

/** A tool's input schema — an object schema, or nothing when it takes none. */
export type Schema = {
  type?: string
  properties?: Record<string, Prop>
  required?: string[]
}

/** How a command line spells a tool's arguments: which bare words fill which
 * properties, and the single letters it answers to. */
export type Spelling = {
  positional?: readonly string[]
  short?: Readonly<Record<string, string>>
  rest?: string
}

/** A tool as the server lists it. */
export type Listed = {
  name: string
  title?: string
  description?: string
  inputSchema?: Schema
  annotations?: { title?: string }
  /** what the transport says beside the schemas — where the two words and the
   * spelling ride (see {@link spelling}) */
  _meta?: Record<string, unknown>
}

/** The `_meta` key the command-line grammar rides under (@yaks/mcp `COMMAND`).
 * Spelled here rather than imported: a client that reads a listing should not
 * have to depend on the server that wrote it. */
export let COMMAND = 'yaks.sh/command'

/**
 * The two words a tool is typed as, and how it spells its arguments — what the
 * DECLARATION said, carried through `tools/list` as `_meta`. A listing without
 * it is a tool with one flat name, which is what every other MCP server sends.
 */
export let spelling = (
  t: Listed,
): { noun?: string; verb?: string; options?: Spelling } => {
  let said = t._meta?.[COMMAND]
  return said && typeof said == 'object'
    ? said as { noun?: string; verb?: string; options?: Spelling }
    : {}
}

/** The one word a listing shows beside a name: its title, or the first
 * sentence of its description. */
export let titleOf = (
  t: { title?: string; description?: string; annotations?: { title?: string } },
): string => {
  let said = t.title ?? t.annotations?.title
  if (said) return said
  let first = (t.description ?? '').split(/(?<=\.)\s/)[0]
  return first.trim()
}

/** The type a value should be given, as one word. A schema that names several
 * (`['string', 'null']`) is read by the first that is not `null`. */
export let typeOf = (p: Prop | undefined): string => {
  let said = p?.type
  if (Array.isArray(said)) return said.find((t) => t != 'null') ?? 'string'
  return said ?? 'string'
}

/** The words a person types for a tool: its two where it has them, the one
 * word where it declared a noun or a verb alone, its name otherwise.
 * `toolName` (@yaks/graph) answers the same question for a transport, which
 * spells a pair `noun_verb`; a command line has a space to spare, and a single
 * word is the same word in both places. */
export let commandOf = (
  t: { name?: string; noun?: string; verb?: string },
): string =>
  t.noun && t.verb ? `${t.noun} ${t.verb}` : t.noun ?? t.verb ?? t.name ?? ''
