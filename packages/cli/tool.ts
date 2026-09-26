// What a tool an MCP server lists looks like to this client: the two fields
// `tools/list` always carries, the input schema it publishes, and nothing
// about what the tool does. A `Listed` is not yet something to run —
// platform.ts is what turns one into a @yaks/graph `Tool` whose `run` makes
// the call — but the argument parser (args.ts), the help pages (show.ts) and
// the cache (store.ts) read both shapes through the types here, so a field the
// server adds costs nothing to carry and a field it drops is a type error in
// one place.

/** One property of an input schema, as much of it as this client reads:
 * enough to decide how the argument on the command line becomes a value. */
export type Prop = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: Prop
  default?: unknown
  /** standard JSON Schema, and what tab completion offers when nothing else
   * narrows the argument (@yaks/vocab: a text property's examples are unioned
   * with its own stored values) */
  examples?: unknown[]
  /** the component whose entities this argument names — where tab completion
   * reads ids from */
  ref?: string
  /** true = this text is full-text indexed, so tab completion asks the
   * index */
  search?: boolean
}

/** A tool's input schema — an object schema, or nothing when it takes no
 * arguments. */
export type Schema = {
  type?: string
  properties?: Record<string, Prop>
  required?: string[]
}

/** How a tool's arguments are written on a command line: which bare words
 * fill which properties, and which single letters it accepts. */
export type Spelling = {
  positional?: readonly string[]
  short?: Readonly<Record<string, string>>
  rest?: string
}

/** A tool as an MCP server lists it. */
export type Listed = {
  name: string
  title?: string
  description?: string
  inputSchema?: Schema
  annotations?: { title?: string; readOnlyHint?: boolean }
  /** what MCP carries beside the schemas — where a tool's two words and its
   * command-line argument layout are sent (see {@link spelling}) */
  _meta?: Record<string, unknown>
}

/** The `_meta` key the command-line grammar is sent under (@yaks/mcp
 * `COMMAND`). Written out here rather than imported: a client reading a
 * listing should not have to depend on the server that wrote it. */
export let COMMAND = 'yak.sh/command'

/**
 * The two words a tool is typed as, and how its arguments are written — what
 * the tool declared, carried through `tools/list` in `_meta`. A listing
 * without it is a tool with one flat name, which is what every other MCP
 * server sends.
 */
export let spelling = (
  t: Listed,
): { noun?: string; verb?: string; options?: Spelling } => {
  let said = t._meta?.[COMMAND]
  return said && typeof said == 'object'
    ? said as { noun?: string; verb?: string; options?: Spelling }
    : {}
}

/** The short label a listing shows beside a tool's name: its title, or the
 * first sentence of its description. */
export let titleOf = (
  t: { title?: string; description?: string; annotations?: { title?: string } },
): string => {
  let said = t.title ?? t.annotations?.title
  if (said) return said
  let first = (t.description ?? '').split(/(?<=\.)\s/)[0]
  return first.trim()
}

/** The type a value should be converted to, as one word. A schema naming
 * several (`['string', 'null']`) is read as the first that is not `null`. */
export let typeOf = (p: Prop | undefined): string => {
  let said = p?.type
  if (Array.isArray(said)) return said.find((t) => t != 'null') ?? 'string'
  return said ?? 'string'
}

/** What a person types to name a tool: its two words where it has them, the
 * one word where it declared a noun or a verb alone, its name otherwise.
 * `toolName` (@yaks/graph) answers the same question for MCP, which writes a
 * pair as `noun_verb`; a command line can afford a space, and a single word is
 * the same word in both places. */
export let commandOf = (
  t: { name?: string; noun?: string; verb?: string },
): string =>
  t.noun && t.verb ? `${t.noun} ${t.verb}` : t.noun ?? t.verb ?? t.name ?? ''
