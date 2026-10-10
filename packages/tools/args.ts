// A call's arguments, from what was stored to what the tool is handed: an
// object, checked against the tool's schema, and every argument the schema
// declares a reference (`ref`) resolved to the eid it names. The last step is
// here, once, rather than in each tool: an argument is what a person types (a
// name, `T-7`, a transcript's own id), and a tool that writes must never be
// handed one that names nothing, or it mints an entity under it.

import {
  type Graph,
  type NamedTool,
  referenced,
  Refused,
  TOMBSTONE,
} from '@yaks/graph'
import { validateToolInput } from '@yaks/vocab/tools'
import { CallError } from './errors.ts'
export { CallError } from './errors.ts'

type Args = Record<string, unknown>

/** A call's arguments as stored: an object, or none at all, which asks with
 * none. */
export let parsed = (args: unknown): Args => {
  if (args == null) return {}
  if (typeof args != 'object' || Array.isArray(args)) {
    throw new CallError('arguments', 'Tool arguments must be an object')
  }
  return args as Args
}

/** A tool's arguments, validated against the JSON Schema on its declaration,
 * or against the legacy per-property schemas that parse themselves. */
export let validated = (tool: NamedTool, args: Args): Args => {
  try {
    if (tool.inputSchema && tool.input) {
      throw new Error('Tool cannot declare both input and inputSchema')
    }
    if (tool.inputSchema) return validateToolInput(tool, args)
    let out = { ...args }
    for (let [key, schema] of Object.entries(tool.input ?? {})) {
      let parser = schema as { parse?: (value: unknown) => unknown }
      if (!parser?.parse) {
        throw new Error('Legacy schema requires a parse adapter: ' + key)
      }
      out[key] = parser.parse(out[key])
    }
    return out
  } catch (error) {
    if (error instanceof CallError) throw error
    throw new CallError('arguments', String(error))
  }
}

type Prop = { ref?: unknown; items?: { ref?: unknown } }

/**
 * The arguments a schema declares references, each with the kind it names:
 * `ref` on the property, or on an array's items.
 *
 * ```ts
 * import { refs } from './args.ts'
 *
 * refs({ properties: { task: { type: 'string', ref: 'task' } } })
 * // [['task', 'task']]
 * ```
 */
export let refs = (schema?: Record<string, unknown>): [string, string][] =>
  Object.entries((schema?.properties ?? {}) as Record<string, Prop>)
    .flatMap(([key, p]) => {
      let ref = p?.ref ?? p?.items?.ref
      return typeof ref == 'string' ? [[key, ref] as [string, string]] : []
    })

// What an argument said, as the ids in it.
let ids = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is string =>
    typeof x == 'string' && x != ''
  )

let missing = (kind: string, said: string): CallError =>
  new CallError(
    'arguments',
    `${said} names ${kind == 'entity' ? 'nothing' : `no ${kind}`}`,
  )

/**
 * Tool references are resolved here once: ids and registered aliases first,
 * then an exact document title of the declared kind. A name must identify one
 * entity; a read may still ask about a missing or deleted durable eid.
 */
export let resolved = async (
  tool: NamedTool,
  args: Args,
  graph: Graph,
): Promise<Args> => {
  let out = { ...args }
  for (let [key, kind] of refs(tool.inputSchema)) {
    let said = ids(args[key])
    if (!said.length) continue
    let eids: string[]
    try {
      eids = await referenced(graph, said, kind)
    } catch (error) {
      if (error instanceof Refused) {
        throw new CallError('arguments', error.message)
      }
      throw error
    }
    let held = new Map(
      (await graph.get(eids, [kind])).map((b) => [b.entity.eid, b]),
    )
    for (let i = 0; i < said.length; i++) {
      let row = held.get(eids[i])
      if (
        !tool.readOnly && (!row || row[TOMBSTONE] != null || row[kind] == null)
      ) {
        throw missing(kind, said[i])
      }
    }
    out[key] = Array.isArray(args[key]) ? eids : eids[0]
  }
  return out
}
