// The generic graph tier, shaped for one host. The WORDS are @yaks/graph's —
// `graph apply`, `graph query`, `graph show`, `graph schema` and `search` are
// declared in its vocab.json and run from `@yaks/graph/tools` — and this file
// says them in the dialect this transport speaks, plus everything a
// declaration cannot know because it is written before there is a host: the
// bundles THIS vocabulary takes, the way back out of a delete this store
// offers, the arguments a door scopes its reads by, and whether the write is
// listed at all.
//
// So a line and a tool list say the same sentence, and a description is
// written in one place.
//
// The arguments are carried as ZOD rather than as the JSON Schema the
// declaration wrote, because that is the one dialect every host here can
// check: the MCP SDK takes Zod, `inputSchemaOf` says the same thing back as
// JSON Schema for a listing, and nothing has to compile a schema at call time
// — which a Cloudflare Worker cannot do at all (no building a function from a
// string, which is how ajv validates).

import { z } from 'zod'
import { type Schema, type Tool } from '@yaks/graph'
import type { Guide } from '@yaks/graph'
import { type Search, tier } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'
import { type BundleOpts, bundleSchema, type Depth } from './schema.ts'

export type { Search }

/** What the generic tier needs to know to describe itself. */
export type CoreOpts = {
  /** the vocabulary the tools describe their answers with */
  vocab: Vocab
  /** how deeply the bundle schema spells out each column (default: `full`) */
  depth?: Depth
  /** a column this host answers or takes differently than the vocabulary
   * declares — see {@link BundleOpts} */
  column?: BundleOpts['column']
  /** where a component is documented at length, when this host has such a
   * page — see {@link Guide} */
  guide?: Guide
  /** the ranked search seam; without it there is no `search` tool */
  search?: Search
  /** this door only READS: `graph_apply` is not listed at all. For a door
   * anybody may call — where the write is not a tool that refuses but a tool
   * that is not there. */
  readOnly?: boolean
  /** this host's way back out of a delete, in its own words, ending
   * `graph_apply`'s description — "everything this store held can be put back
   * to any moment in the last 30 days with store_restore", say. A host that
   * has one should say it there, because that is where an agent reads it at
   * the moment it is deciding whether to dare. Absent where the host has no
   * way back, since a promise nobody can keep is worse than silence. */
  undo?: string
  /** extra arguments every READ here takes, merged into each read tool's
   * input, for a host whose reads are scoped by something of its own —
   * yaks.app's signed-out door names which app to read.
   *
   * The tools ignore them: what they name is the graph the door was built
   * around, and the door read them off the call before this server saw it.
   * They are declared so a client knows to say them. */
  scope?: Record<string, Schema>
}

/**
 * A refusal for a word this graph does not know, pointed at the door that has
 * the words. The input schema is OPEN (schema.ts) precisely so a client's
 * cached copy cannot refuse a column that now exists — which leaves the server
 * the only authority on what a component takes, and this the only place a
 * caller learns its picture was stale.
 *
 * It reads the refusal's WORDS rather than its class: the refusal is landed by
 * the runner as an entity's prose long before a door renders it, and a graph
 * may be a composition over stores of its own, where admission ran on the far
 * side of a hop and what arrives is the sentence it wrote.
 */
export let pointing = (said: string): string =>
  said.includes('unknown column')
    ? `${said}. Your tool list may be from before this word moved — ` +
      'graph_schema says what this graph knows right now.'
    : said

// One declared argument, in Zod. Not a general JSON Schema reader: what it
// ever sees is the tier's own declaration, so it knows the shapes that file
// uses and says so plainly rather than pretending to cover the dialect.
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

// A declaration's whole `input` map, in Zod: optional unless the declaration
// said it was required, and whatever it says each argument MEANS carried
// through — a description is the sentence an agent reads before it types.
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
 * The generic graph tier, as tools: `graph_apply`, `graph_query`, `graph_show`,
 * `graph_schema`, and `search` when a {@link Search} was passed — @yaks/graph's
 * own declarations wearing its runs, said in Zod and shaped for this host.
 *
 * ```ts
 * let tools = core({ vocab: shop, depth: 'full' })
 * ```
 */
export let core = (opts: CoreOpts): Tool[] => {
  let { vocab, column } = opts
  // What a write TAKES: the same bundle, closed over what a client may write.
  // Always `full` — a write door that leaves a column's type to the reader is
  // the door an agent guesses at (T-34153).
  let writes = z.array(
    bundleSchema(vocab, { depth: 'full', nulls: true, write: true, column }),
  )
  return tier({ search: opts.search, guide: opts.guide })
    // What this door is, said once over the whole tier: a door that only reads
    // does not list the write at all — where the write is not a tool that
    // refuses but a tool that is not there.
    .filter((t) => t.readOnly || !opts.readOnly)
    .map((t) => {
      let said = (t.inputSchema ?? {}) as {
        properties?: Record<string, Arg>
        required?: string[]
      }
      let input = zodInput(said)
      if (t.name == 'graph_apply') {
        // The bundles a write takes are THIS graph's, so the declaration says
        // an array of bundles and the vocabulary fills in what one IS — every
        // component, every writable column and every type (T-34153). No static
        // schema could say it: the shape is a host's own words, and a
        // declaration is written before there is a host.
        let about = said.properties?.change?.description
        input.change = about ? writes.describe(about) : writes
      }
      return {
        ...t,
        // The declaration's JSON Schema goes: a tool says its arguments ONCE,
        // and here that is the Zod above. Saying both is refused outright
        // (@yaks/vocab `validateToolInput`), and rightly.
        inputSchema: undefined,
        // A host whose reads are scoped by something of its own says so on
        // every one of them — yaks.app's signed-out door names which app to
        // read, and those arguments come first, where a caller reads them.
        input: t.readOnly && opts.scope ? { ...opts.scope, ...input } : input,
        // This host's way back out of a delete, in its own words, ending the
        // write's description — because that is where an agent reads it at the
        // moment it is deciding whether to dare.
        ...(opts.undo && t.name == 'graph_apply'
          ? { description: `${t.description} ${opts.undo}` }
          : {}),
      }
    })
}
