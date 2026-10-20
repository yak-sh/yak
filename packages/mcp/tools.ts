// The generic tool tier, shaped for one server. The tools themselves are
// @yaks/graph's — `graph apply`, `graph query`, `graph show`, `graph schema`
// and `search` are declared in its vocab.json and implemented in
// `@yaks/graph/tools` — and this file restates their arguments in the form
// this transport accepts, plus everything a declaration cannot know because it
// is written before there is a server: the way back out of a delete this store
// offers, how a read narrows to one part of the graph, the extra arguments an
// endpoint scopes its reads by, and whether the write tool is listed at all.
//
// So the command line and an MCP tool list describe the same tools, and each
// description is written in one place.
//
// A tool's arguments become a Zod shape and JSON Schema here too (`shapeOf`,
// `inputSchemaOf`). Nothing in this file loads the MCP SDK, so a host that
// describes tools to a model and serves none (@yaks/harness) imports
// `@yaks/mcp/tools` and never pays for a server.
//
// Every tool in the tier keeps the JSON Schema its declaration wrote, because
// that is what the runner reads: it validates a call against it and resolves
// every argument marked a reference (`ref`) to the eid it names (@yaks/tools).
// `graph_apply` takes the generic bundle, `{entity: {eid}}` and open
// components, over every vocabulary: the tool list is sent before every
// request, and `graph_schema` reads the vocabulary when an agent needs it.

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Schema, Tool } from '@yaks/graph'
import { toolName } from '@yaks/graph/call'
import type { Guide } from '@yaks/graph'
import { type Search, tier } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { publicToolSchema } from '@yaks/vocab/tools'

export type { Search }

// @yaks/graph leaves a tool's schemas opaque, because the core package depends
// on no validation library. This is where `Schema` gets a concrete meaning:
// the MCP SDK takes Zod, so a schema that is not a Zod schema throws at
// startup rather than producing a tool that lists the wrong arguments.
let zodOf = (
  tool: string,
  where: string,
  s: Schema | undefined,
): z.ZodTypeAny | undefined => {
  if (s == undefined) return undefined
  if (s instanceof z.ZodType) return s
  throw new Error(`${tool}: ${where} must be a Zod schema`)
}

/**
 * A tool's arguments as one Zod shape — its `input` object, with every schema
 * checked to be a Zod schema. This is what the server hands the MCP SDK, and
 * the starting point for anything that has to express a tool's arguments in
 * another format: a model's tool declaration takes JSON Schema, and
 * `z.object(shapeOf(tool))` is what you convert.
 */
export let shapeOf = (tool: Tool): Record<string, z.ZodTypeAny> =>
  Object.fromEntries(
    Object.entries(tool.input ?? {}).map((
      [name, s],
    ) => [name, zodOf(toolName(tool), `argument '${name}'`, s)!]),
  )

type Json = { [key: string]: unknown }
let isObj = (v: unknown): v is Json =>
  !!v && typeof v == 'object' && !Array.isArray(v)
let open = (v: unknown) => v === true || (isObj(v) && !Object.keys(v).length)

// A converted Zod schema, said in fewer words. zod-to-json-schema spells out
// what JSON Schema already assumes (an object open to more properties, an
// object naming none) and writes a nullable object or enum as an `anyOf`
// beside `{type: 'null'}`, which is a type list. Each says the same thing, on
// a listing every client is sent before it asks anything. Its draft-07 dialect
// line goes too: MCP
// reads a tool schema as 2020-12, which means the same for every keyword here.
let terse = (s: unknown): unknown => {
  if (!isObj(s)) return s
  let { anyOf, properties, items, additionalProperties, $schema: _, ...rest } =
    s
  let out: Json = { ...rest }
  if (isObj(properties) && Object.keys(properties).length) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, terse(v)]),
    )
  }
  if (items !== undefined) out.items = terse(items)
  if (additionalProperties !== undefined && !open(additionalProperties)) {
    out.additionalProperties = terse(additionalProperties)
  }
  if (!Array.isArray(anyOf)) return out
  let kept = anyOf.map(terse)
  let one = kept.filter((k) => !(isObj(k) && k.type == 'null'))
  let [only] = one
  if (
    one.length == 1 && kept.length == 2 && isObj(only) &&
    typeof only.type == 'string' && !only.anyOf
  ) {
    return {
      ...only,
      type: [only.type, 'null'],
      ...(Array.isArray(only.enum) ? { enum: [...only.enum, null] } : {}),
      ...out,
    }
  }
  return { ...out, anyOf: kept }
}

/**
 * A tool's arguments as JSON Schema, whichever way it declared them: its own
 * `inputSchema`, or its Zod shape converted. This is exactly what
 * `tools/list` sends, so anything else that needs a tool's argument
 * grammar — a CLI mapping a command onto it, say — reads what an MCP client
 * reads.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { z } from 'zod'
 * import { inputSchemaOf } from '@yaks/mcp/tools'
 *
 * let doc = z.object({ title: z.string().nullable().optional() }).passthrough()
 * let tool = {
 *   name: 'write',
 *   description: 'Write a doc',
 *   input: { doc: doc.nullable() },
 *   run: () => [],
 * }
 * assertEquals(inputSchemaOf(tool).properties, {
 *   doc: {
 *     type: ['object', 'null'],
 *     properties: { title: { type: ['string', 'null'] } },
 *   },
 * })
 * ```
 */
export let inputSchemaOf = (
  tool: Tool,
): { type: 'object'; [key: string]: unknown } =>
  publicToolSchema(
    tool.inputSchema ?? converted(tool),
  ) as { type: 'object'; [key: string]: unknown }

// A Zod `input` map converted once: `core` hands every server over one
// vocabulary the same map, and a server is built per request.
let conversions = new WeakMap<object, Json>()
let converted = (tool: Tool): Json => {
  let held = tool.input && conversions.get(tool.input)
  if (held) return held
  let made = terse(zodToJsonSchema(z.object(shapeOf(tool)), {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  })) as Json
  if (tool.input) conversions.set(tool.input, made)
  return made
}

/** What the generic tier needs in order to describe itself. */
export type CoreOpts = {
  /** the vocabulary the tools read and write, whose query keywords the reads
   * understand */
  vocab: Vocab
  /** where a component is documented at length, when this server has such a
   * page — see {@link Guide} */
  guide?: Guide
  /** the ranked search function; without it there is no `search` tool */
  search?: Search
  /** this server only reads: `graph_apply` is not listed at all. For an
   * endpoint anybody may call — where the write is not a tool that refuses,
   * but a tool that is not there. */
  readOnly?: boolean
  /** how a caller undoes a delete on this server, in its own words, appended
   * to `graph_apply`'s description — "everything this store held can be put
   * back to any moment in the last 30 days with store_restore", say. A server
   * that offers one should describe it there, because that is where an agent
   * reads it at the moment it is deciding whether to risk the write. Left out
   * where there is no way back, since a promise nobody can keep is worse than
   * silence. */
  undo?: string
  /** how a read here is narrowed to one part of this graph, in its own words,
   * appended to `graph_query`'s description — yaks.app reads every app in a
   * person's reach at once, and `.in=<app>` on the query line reads one. A
   * clause a query grammar does not have is said by the server that answers
   * it, where an agent reads it at the moment it writes the query. */
  narrow?: string
  /** extra arguments every read here requires, as the JSON Schema of each,
   * merged into each read tool's input, for a server whose reads are scoped by
   * something of its own — yaks.app's signed-out endpoint names which app to
   * read.
   *
   * The tools ignore them: what they name is the graph the endpoint was built
   * around, and the endpoint read them off the call before this server saw it.
   * They are declared so that a client knows to send them. */
  scope?: Record<string, Schema>
}

/**
 * A refusal naming a property this graph does not declare, with a pointer to
 * `graph_schema` appended — the tool that reports what this graph declares.
 * The write tool's input schema is the generic bundle, so the server is the
 * only authority on what a component accepts, and this refusal is where a
 * caller that guessed learns where to read it.
 *
 * It matches on the refusal's text rather than on an error class: the runner
 * stores a refusal as an entity's text long before any transport renders it,
 * and a graph may be composed over stores of its own, where admission ran on
 * the far side of a network hop and only its message comes back.
 */
export let pointing = (said: string): string =>
  /unknown propert(y|ies)\b/.test(said)
    ? `${said}. graph_schema reports what this graph declares.`
    : said

// The generic tier's former argument names, each onto the one that takes it
// now. A client lists the tools once, when it connects, and sends what that
// list named for as long as it stays connected, and a directory serves the
// list it snapshotted until a new one is released, so a renamed argument keeps
// answering under its old name (M-37853). An entry goes once nothing still
// sends it.
let FORMER: Record<string, Record<string, string>> = {
  graph_apply: { change: 'bundles', entities: 'bundles' },
  graph_query: { filter: 'q', query: 'q' },
  search: { text: 'words' },
}

// A key of a table, never one it inherits (`constructor`, `toString`).
let own = (table: Record<string, string>, k: string) =>
  Object.hasOwn(table, k) ? table[k] : undefined

/**
 * A call's arguments with each former name of a generic tool's argument
 * translated onto the current one, which every door does before the call is
 * recorded or checked, so the tool sees one shape. Where the caller sent both,
 * the current name wins.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { translated } from '@yaks/mcp/tools'
 *
 * assertEquals(translated('graph_apply', { change: [], check: true }), {
 *   bundles: [],
 *   check: true,
 * })
 * assertEquals(translated('graph_query', { q: '.task', query: '.doc' }), {
 *   q: '.task',
 * })
 * ```
 */
export let translated = (
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> => {
  if (!Object.hasOwn(FORMER, tool)) return args
  let now = (k: string) => own(FORMER[tool], k) ?? k
  return Object.fromEntries(
    Object.entries(args)
      .filter(([k]) => now(k) == k || !Object.hasOwn(args, now(k)))
      .map(([k, v]) => [now(k), v]),
  )
}

/**
 * The generic tier, as tools: `graph_apply`, `graph_query`, `graph_show`,
 * `graph_schema`, and `search` when a {@link Search} was passed —
 * @yaks/graph's own declarations joined to its implementations, with their
 * arguments shaped for this server.
 *
 * ```ts ignore
 * let tools = core({ vocab: shop })
 * ```
 */
export let core = (opts: CoreOpts): Tool[] =>
  tier({
    search: opts.search,
    guide: opts.guide,
    keywords: opts.vocab.keywords,
  })
    // What this server is, decided once for the whole tier: a server that only
    // reads does not list the write at all — the write is not a tool that
    // refuses, it is a tool that is not there.
    .filter((t) => t.readOnly || !opts.readOnly)
    .map((t) => {
      let said = (t.inputSchema ?? {}) as {
        properties?: Record<string, unknown>
        required?: string[]
      }
      // A server whose reads are scoped by something of its own declares that
      // on every read — yaks.app's signed-out endpoint names which app to read
      // — and those arguments come first, where a caller reads them.
      let scope = t.readOnly && opts.scope ? opts.scope : {}
      let required = [...Object.keys(scope), ...(said.required ?? [])]
      // What this server adds to a tool's description in its own words: how a
      // read narrows, and how a delete is undone, each where an agent reads it
      // at the moment it writes the query or decides to risk the write.
      let added = t.name == 'graph_query'
        ? opts.narrow
        : t.name == 'graph_apply'
        ? opts.undo
        : undefined
      return {
        ...t,
        ...(added ? { description: `${t.description} ${added}` } : {}),
        inputSchema: {
          ...said,
          properties: { ...scope, ...said.properties },
          ...(required.length ? { required } : {}),
        },
      }
    })
