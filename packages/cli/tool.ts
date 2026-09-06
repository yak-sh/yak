// What a tool IS to this client: the two fields `tools/list` always carries,
// the input schema it publishes, and nothing about what it does. Every other
// module here reads a tool through these types — the mapper (args.ts), the
// help (show.ts) and the cache (store.ts) — so a field the server adds costs
// nothing to carry and a field it drops is a type error in one place.

/** One property of an input schema, as far as this client reads it: enough to
 * decide how the word on the command line becomes a value. */
export type Prop = {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: Prop
  default?: unknown
}

/** A tool's input schema — an object schema, or nothing when it takes none. */
export type Schema = {
  type?: string
  properties?: Record<string, Prop>
  required?: string[]
}

/** A tool as the server lists it. */
export type Tool = {
  name: string
  title?: string
  description?: string
  inputSchema?: Schema
  annotations?: { title?: string }
}

/** The one word a listing shows beside a name: its title, or the first
 * sentence of its description. */
export let titleOf = (t: Tool): string => {
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
