// A call's arguments, from what was stored to what the tool is handed: an
// object, checked against the tool's schema, and every argument the schema
// declares a reference (`ref`) resolved to the eid it names. The last step is
// here, once, rather than in each tool: an argument is what a person types (a
// name, `T-7`, a transcript's own id), and a tool that writes must never be
// handed one that names nothing, or it mints an entity under it.

import {
  addressed,
  detached,
  type Eid,
  type Graph,
  type NamedTool,
  TOMBSTONE,
} from '@yaks/graph'
import { validateToolInput } from '@yaks/vocab/tools'

/** Expected invocation failures, not programming defects. */
export class CallError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'CallError'
  }
}

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

// The ids that name nothing a tool may write about: no entity, a deleted one,
// or one that is not the kind the argument declares (`entity` is any kind).
let absent = async (
  graph: Graph,
  kind: string,
  said: string[],
  eids: Eid[],
): Promise<string[]> => {
  let found = new Map(
    (await detached(graph.storage).get(eids)).map((b) => [b.entity.eid, b]),
  )
  return said.filter((_, i) => {
    let b = found.get(eids[i])
    return !b || b[TOMBSTONE] != null || b[kind] == null
  })
}

/**
 * The arguments with every declared reference resolved to the eid it names,
 * through the graph's `address` asked with the kind the argument names. A
 * tool that writes is refused an argument naming nothing of that kind; a read
 * is answered about whatever it names, a deleted entity's history included.
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
    let eids = await addressed(graph, said, kind)
    if (!tool.readOnly) {
      let none = await absent(graph, kind, said, eids)
      if (none.length) {
        throw new CallError(
          'arguments',
          `${key}: ${none.join(', ')} ${none.length == 1 ? 'names' : 'name'} ` +
            (kind == 'entity' ? 'nothing' : `no ${kind}`),
        )
      }
    }
    out[key] = Array.isArray(args[key]) ? eids : eids[0]
  }
  return out
}
