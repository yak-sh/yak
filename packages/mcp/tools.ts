// The generic tool tier, shaped for one server. The TOOLS themselves are
// @yaks/graph's — `graph apply`, `graph query`, `graph show`, `graph schema`
// and `search` are declared in its vocab.json and implemented in
// `@yaks/graph/tools` — and this file restates their arguments in the form
// this transport accepts, plus everything a declaration cannot know because it
// is written before there is a server: the bundles THIS vocabulary accepts,
// the way back out of a delete this store offers, the extra arguments an
// endpoint scopes its reads by, and whether the write tool is listed at all.
//
// So the command line and an MCP tool list describe the same tools, and each
// description is written in one place.
//
// The arguments are carried as ZOD rather than as the JSON Schema the
// declaration wrote, because Zod is the one form every server here can
// validate: the MCP SDK takes Zod, `inputSchemaOf` converts it back to JSON
// Schema for a `tools/list` reply, and nothing has to compile a schema at call
// time — which a Cloudflare Worker cannot do at all (it forbids building a
// function from a string, which is how ajv validates).

import { z } from 'zod'
import { type Schema, type Tool } from '@yaks/graph'
import type { Guide } from '@yaks/graph'
import { type Search, tier } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { type BundleOpts, bundleSchema, type Depth } from './schema.ts'

export type { Search }

/** What the generic tier needs in order to describe itself. */
export type CoreOpts = {
  /** the vocabulary the tools describe their results with */
  vocab: Vocab
  /** how much of each column a bundle schema spells out. `graph_apply`'s
   * input schema is always `full` and no tool here declares an output schema,
   * so this is carried for callers that pass one and changes nothing yet. */
  depth?: Depth
  /** a column this server returns or accepts differently than the vocabulary
   * declares — see {@link BundleOpts} */
  column?: BundleOpts['column']
  /** where a component is documented at length, when this server has such a
   * page — see {@link Guide} */
  guide?: Guide
  /** the ranked search function; without it there is no `search` tool */
  search?: Search
  /** this server only READS: `graph_apply` is not listed at all. For an
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
  /** extra arguments every READ here accepts, merged into each read tool's
   * input, for a server whose reads are scoped by something of its own —
   * yaks.app's signed-out endpoint names which app to read.
   *
   * The tools ignore them: what they name is the graph the endpoint was built
   * around, and the endpoint read them off the call before this server saw it.
   * They are declared so that a client knows to send them. */
  scope?: Record<string, Schema>
}

/**
 * A refusal naming a column this graph does not declare, with a pointer to
 * `graph_schema` appended — the tool that reports what this graph declares
 * right now. The write tool's input schema is OPEN (schema.ts) precisely so
 * that a client's cached copy cannot refuse a column declared since it
 * connected, which leaves the server the only authority on what a component
 * accepts and makes this the only place a caller learns its copy is out of
 * date.
 *
 * It matches on the refusal's TEXT rather than on an error class: the runner
 * stores a refusal as an entity's text long before any transport renders it,
 * and a graph may be composed over stores of its own, where admission ran on
 * the far side of a network hop and only its message comes back.
 */
export let pointing = (said: string): string =>
  said.includes('unknown column')
    ? `${said}. Your tool list may predate a change to this vocabulary — ` +
      'graph_schema reports what this graph declares right now.'
    : said

// One declared argument, in Zod. Not a general JSON Schema reader: the only
// declarations it ever sees are the tier's own, so it handles the shapes that
// one file uses rather than pretending to cover all of JSON Schema.
type Arg = {
  type?: string
  items?: Arg
  anyOf?: Arg[]
  enum?: readonly string[]
  description?: string
}

let zodArg = (arg: Arg): z.ZodTypeAny => {
  if (arg.anyOf?.length) {
    let [one, two, ...rest] = arg.anyOf.map(zodArg)
    return two ? z.union([one, two, ...rest]) : one
  }
  if (arg.enum?.length) {
    return z.enum([...arg.enum] as [string, ...string[]])
  }
  return arg.type == 'number' || arg.type == 'integer'
    ? z.number()
    : arg.type == 'boolean'
    ? z.boolean()
    : arg.type == 'array'
    ? z.array(arg.items ? zodArg(arg.items) : z.unknown())
    : arg.type == 'object'
    ? z.record(z.unknown())
    : z.string()
}

// A declaration's whole `input` map, in Zod: every argument optional unless
// the declaration marked it required, with each argument's description carried
// through — that description is what an agent reads before it calls the tool.
let zodInput = (
  schema: { properties?: Record<string, Arg>; required?: string[] } = {},
): Record<string, z.ZodTypeAny> => {
  let need = new Set(schema.required ?? [])
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, arg]) => {
      let said: z.ZodTypeAny = zodArg(arg)
      if (!need.has(name)) said = said.optional()
      return [name, arg.description ? said.describe(arg.description) : said]
    }),
  )
}

/**
 * The generic tier, as tools: `graph_apply`, `graph_query`, `graph_show`,
 * `graph_schema`, and `search` when a {@link Search} was passed —
 * @yaks/graph's own declarations joined to its implementations, with their
 * arguments expressed in Zod and shaped for this server.
 *
 * ```ts
 * let tools = core({ vocab: shop, depth: 'full' })
 * ```
 */
export let core = (opts: CoreOpts): Tool[] => {
  let { vocab, column } = opts
  // What a write ACCEPTS: the same bundle, narrowed to what a client may
  // write. Always `full` — a write tool that leaves a column's type to the
  // reader is a tool an agent guesses at (T-34153).
  let writes = z.array(
    bundleSchema(vocab, { depth: 'full', nulls: true, write: true, column }),
  )
  return tier({ search: opts.search, guide: opts.guide })
    // What this server is, decided once for the whole tier: a server that only
    // reads does not list the write at all — the write is not a tool that
    // refuses, it is a tool that is not there.
    .filter((t) => t.readOnly || !opts.readOnly)
    .map((t) => {
      let said = (t.inputSchema ?? {}) as {
        properties?: Record<string, Arg>
        required?: string[]
      }
      let input = zodInput(said)
      if (t.name == 'graph_apply') {
        // The bundles a write accepts are THIS graph's, so the declaration
        // names only "an array of bundles" and the vocabulary fills in what
        // one IS — every component, every writable column and every type
        // (T-34153). No fixed schema could state it: the shape comes from one
        // graph's vocabulary, and a declaration is written before there is a
        // graph.
        let about = said.properties?.change?.description
        input.change = about ? writes.describe(about) : writes
      }
      return {
        ...t,
        // The declaration's JSON Schema is dropped: a tool declares its
        // arguments ONCE, and here that is the Zod above. Declaring both is
        // refused outright (@yaks/vocab `validateToolInput`), and rightly.
        inputSchema: undefined,
        // A server whose reads are scoped by something of its own declares
        // that on every read — yaks.app's signed-out endpoint names which app
        // to read — and those arguments come first, where a caller reads them.
        input: t.readOnly && opts.scope ? { ...opts.scope, ...input } : input,
        // How a caller undoes a delete on this server, in its own words,
        // appended to the write's description — because that is where an agent
        // reads it at the moment it is deciding whether to risk the write.
        ...(opts.undo && t.name == 'graph_apply'
          ? { description: `${t.description} ${opts.undo}` }
          : {}),
      }
    })
}
