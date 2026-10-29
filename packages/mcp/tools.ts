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
// Public schema conversion belongs to @yaks/tools/schema and is re-exported
// here for callers of this transport's existing API.
//
// Every tool in the tier keeps the JSON Schema its declaration wrote, because
// that is what the runner reads: it validates a call against it and resolves
// every argument marked a reference (`ref`) to the eid it names (@yaks/tools).
// `graph_apply` takes the generic bundle, `{entity: {eid}}` and open
// components, over every vocabulary: the tool list is sent before every
// request, and `graph_schema` reads the vocabulary when an agent needs it.

import type { Schema, Tool } from '@yaks/graph'
import type { Guide } from '@yaks/graph'
import { type Search, tier } from '@yaks/graph/tools'
import type { Vocab } from '@yaks/vocab'

export type { Search }

export {
  answerSchema,
  answerWith,
  inputSchemaOf,
  shapeOf,
} from '@yaks/tools/schema'

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
