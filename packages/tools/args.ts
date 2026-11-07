// A call's arguments, from what was stored to what the tool is handed: an
// object, checked against the tool's schema, and every argument the schema
// declares a reference (`ref`) resolved to the eid it names. The last step is
// here, once, rather than in each tool: an argument is what a person types (a
// name, `T-7`, a transcript's own id), and a tool that writes must never be
// handed one that names nothing, or it mints an entity under it.

import type { Graph, NamedTool } from '@yaks/graph'
import { referenced, takes } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { TOMBSTONE } from '@yaks/graph/bundle'
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

/** A tool's arguments, validated against the JSON Schema on its declaration;
 * a tool that declares none takes them as they came. */
export let validated = (tool: NamedTool, args: Args): Args =>
  tool.inputSchema
    ? validateToolInput(
      tool,
      args,
      (message) => new CallError('arguments', message),
    )
    : { ...args }

type Prop = { ref?: unknown; items?: Prop; properties?: Record<string, Prop> }

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

// A reference that names nothing, refused naming the argument that held it.
let missing = (key: string, kind: string, refusal: string): CallError =>
  new CallError('arguments', takes(key, kind, refusal))

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
  if (tool.scope?.some((key) => args[key] != null && args[key] !== '')) {
    return args
  }
  let resolve = async (
    schema: Prop | undefined,
    value: unknown,
    key = '',
  ): Promise<unknown> => {
    let kind = schema?.ref ?? schema?.items?.ref
    if (typeof kind != 'string') {
      if (Array.isArray(value) && schema?.items) {
        return await Promise.all(
          value.map((item) => resolve(schema.items, item, key)),
        )
      }
      if (
        value && typeof value == 'object' && !Array.isArray(value) &&
        schema?.properties
      ) {
        let out = { ...value }
        for (let [name, child] of Object.entries(schema.properties)) {
          if (Object.hasOwn(value, name)) {
            let at = key ? `${key}.${name}` : name
            Reflect.set(
              out,
              name,
              await resolve(child, Reflect.get(value, name), at),
            )
          }
        }
        return out
      }
      return value
    }
    let said = ids(value)
    if (!said.length) return value
    let eids: string[]
    try {
      eids = await referenced(graph, said, kind)
    } catch (error) {
      if (error instanceof Refused) throw missing(key, kind, error.message)
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
        throw missing(
          key,
          kind,
          `${said[i]} names ${kind == 'entity' ? 'nothing' : `no ${kind}`}`,
        )
      }
    }
    let index = 0
    return Array.isArray(value)
      ? value.map((item) =>
        typeof item == 'string' && item != '' ? eids[index++] : item
      )
      : eids[0]
  }
  return await resolve(tool.inputSchema, args) as Args
}
