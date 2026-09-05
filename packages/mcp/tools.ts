// The generic graph tier: five tools, and every one of them speaks bundles.
//
// There is no sugar here for any particular domain — no `book_shelve`, no
// `task_done`. A bundle already says everything such a tool would say, and an
// agent that knows the bundle wire can write anything the vocabulary declares
// without a tool per component. Sugar belongs in a plugin, which contributes
// its tools the same way it contributes components (@yaks/graph's `Tool`).
//
// The one concession to typing by hand is the query line: `.status=shelved` is
// the grammar @yaks/query owns, so `graph_query` takes it as a string and the
// optional `filters` list is joined onto it with `&`.

import { z } from 'zod'
import {
  type Bundle,
  detached,
  Refused,
  type Tool,
  type ToolCtx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { edges } from './edges.ts'
import {
  type BundleOpts,
  bundleSchema,
  type Depth,
  outputSchema,
  showSchema,
} from './schema.ts'
import { detail, type Guide, index, ofKind, schemaSchema } from './words.ts'

/**
 * Ranked full-text search, when the host has it. Compose
 * {@link https://jsr.io/@yaks/fts | @yaks/fts} into your storage and a bare
 * word already filters inside `graph_query`; pass this and the ranked door gets
 * a tool of its own.
 */
export type Search = (
  words: string,
  opts?: { limit?: number },
) => Bundle[] | Promise<Bundle[]>

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
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined
let strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x == 'string') : []

// A batch, checked at the door. The input SCHEMA is the vocabulary itself
// (schema.ts `bundleSchema` at `write`), so a client knows every component,
// every writable column and every type before it writes one — this is the
// check the schema cannot make, the identity every bundle must carry.
let batch = (v: unknown): Bundle[] => {
  if (!Array.isArray(v)) throw new Refused('change must be an array of bundles')
  return v.map((b, i) => {
    let eid = b && typeof b == 'object' ? b.entity?.eid : undefined
    if (typeof eid != 'string' || !eid) {
      throw new Refused(
        `bundle ${i} needs an entity: {entity: {eid}} — an eid you mint, or ` +
          `'$name' to have the graph mint one`,
      )
    }
    return b
  })
}

// A write refused for a word this graph does not know, pointed at the door
// that has the words. The input schema is OPEN (schema.ts) precisely so a
// client's cached copy cannot refuse a column that now exists — which leaves
// the server the only authority on what a component takes, and this the only
// place a caller learns its picture was stale.
// The refusal is matched by its WORDS rather than its class: a graph may be a
// composition over stores of its own, where admission ran on the far side of a
// hop and what arrives here is the sentence it wrote, not the error it threw.
let pointed = (err: unknown): never => {
  let said = err instanceof Error ? err.message : ''
  if (!said.includes('unknown column')) throw err
  throw new Refused(
    `${said}. Your tool list may be from before this word moved — ` +
      'graph_schema says what this graph knows right now.',
  )
}

// The entities, then everything pointing at them, each one whole and each one
// once. `.refs=<id>` is the query grammar's backlink union, so the incoming
// half of an entity's edges costs one query, not one per reference column.
let gather = async (
  ctx: ToolCtx,
  ids: string[],
  backrefs: boolean,
): Promise<Bundle[]> => {
  let found = await detached(ctx.graph.storage).get(ids)
  let seen = new Map<string, Bundle>()
  for (let b of found) seen.set(b.entity.eid, b)
  if (backrefs) {
    for (let id of ids) {
      for (let b of await ctx.read(`.refs=${id}`)) {
        if (!seen.has(b.entity.eid)) seen.set(b.entity.eid, b)
      }
    }
  }
  return [...seen.values()]
}

/**
 * The generic graph tier, as tools: `graph_apply`, `graph_query`, `graph_show`,
 * `graph_schema`, and `search` when a {@link Search} was passed.
 *
 * ```ts
 * let tools = core({ vocab: shop, depth: 'full' })
 * ```
 */
export let core = (opts: CoreOpts): Tool[] => {
  let { vocab, column } = opts
  let depth = opts.depth ?? 'full'
  let bundle = bundleSchema(vocab, { depth, column })
  let bundles = outputSchema(z.array(bundle))
  // What `apply()` answers is the batch AS APPLIED, and a batch may say
  // `comp: null` — drop this component — which no read ever answers.
  let applied = outputSchema(
    z.array(bundleSchema(vocab, { depth, nulls: true, column })),
  )
  // And what it TAKES: the same bundle, closed over what a client may write.
  // Always `full` — a write door that leaves a column's type to the reader is
  // the door an agent guesses at (T-34153).
  let writes = z.array(
    bundleSchema(vocab, { depth: 'full', nulls: true, write: true, column }),
  )

  let tools: Tool[] = [
    {
      name: 'graph_apply',
      title: 'Apply a batch',
      description:
        `Write. A batch is an array of BUNDLES — {entity: {eid}, <component>: ` +
        `{<columns>}} — applied atomically: an omitted column is untouched, a ` +
        `null column is cleared, a null component is dropped, and ` +
        `$delete: true kills the entity. Mint an id yourself, or write ` +
        `'$name' as the eid and read back what the graph named it. The answer ` +
        `is the batch AS APPLIED, including everything the graph synthesized: ` +
        `stamps, minted numbers, and a tombstone per casualty. This tool's ` +
        `own input schema is the vocabulary — every component, every column ` +
        `and every type — and graph_schema says the same thing at length. ` +
        `The schema describes and the server decides: it is open, so a word ` +
        `learned since you connected still reaches the graph, and a column ` +
        `nobody declared is refused here with the ones that are.`,
      input: {
        change: writes.describe('the bundles to apply, atomically'),
      },
      output: applied,
      run: async (args, ctx) => {
        try {
          return await ctx.apply(batch(args.change))
        } catch (err) {
          return pointed(err)
        }
      },
    },
    {
      name: 'graph_query',
      readOnly: true,
      title: 'Read a query',
      description:
        `Read. A query LINE selects entities and answers them as whole ` +
        `bundles: '.status=shelved&.price<20' — dot-params joined with &, ` +
        `with lists (a,b), ranges (1..9), !=, ~=, comparisons, '.prop!' for ` +
        `present and '.prop=' for absent. Directives ride the same line: ` +
        `.order=, .limit=, .refs=<id> for everything pointing at an entity. ` +
        `filters, if you pass any, are joined onto q with &.`,
      input: {
        q: z.string().describe('the query line'),
        filters: z.array(z.string()).optional().describe(
          'extra dot-params, joined onto q with &',
        ),
        limit: z.number().optional().describe('at most this many entities'),
      },
      output: bundles,
      run: (args, ctx) => {
        let line = [str(args.q), ...strings(args.filters)]
          .map((s) => s.trim()).filter(Boolean)
        let n = num(args.limit)
        if (n) line.push(`.limit=${n}`)
        if (!line.length) throw new Refused('graph_query needs a query line')
        return ctx.read(line.join('&'))
      },
    },
    {
      name: 'graph_show',
      readOnly: true,
      title: 'Show entities whole',
      description:
        `One entity (or several), whole: every component it carries, plus ` +
        `everything that points AT it, each as its own bundle, and the ` +
        `references between them as edges. This is identity, not search — ` +
        `pass eids. Set backrefs false when you only want the entities ` +
        `themselves.`,
      input: {
        ids: z.array(z.string()).describe('the eids to show'),
        backrefs: z.boolean().optional().describe(
          'also gather what points at them (default: true)',
        ),
      },
      output: outputSchema(showSchema(bundle)),
      run: async (args, ctx) => {
        let ids = strings(args.ids)
        if (!ids.length) throw new Refused('graph_show needs at least one id')
        let found = await gather(ctx, ids, args.backrefs !== false)
        return { bundles: found, edges: edges(vocab, found) }
      },
    },
    {
      name: 'graph_schema',
      readOnly: true,
      title: 'The schema',
      description:
        `The schema of this graph, in three sizes. Bare: the INDEX — every ` +
        `component, what it means in a line, and its column names. With ` +
        `component (one name or several): that component in full — each ` +
        `column's type and meaning, what is server-owned or unique, what ` +
        `points at it and what it points at, and a bundle that writes it. ` +
        `With kind: what an entity of that kind is made of. Read the index ` +
        `first and ask for the word you are about to write.`,
      input: {
        component: z.union([z.string(), z.array(z.string())]).optional()
          .describe('a component to read in full, or several'),
        kind: z.string().optional().describe(
          'a display kind, answered as the words an entity of it wears',
        ),
      },
      output: outputSchema(schemaSchema),
      run: (args, ctx) => {
        let v = ctx.graph.vocab
        let named = [
          ...(typeof args.component == 'string' ? [args.component] : []),
          ...strings(args.component),
        ]
        let kind = str(args.kind)
        for (let name of [...named, ...(kind ? [kind] : [])]) {
          if (v.comp(name)) continue
          throw new Refused(
            `no component '${name}' — call graph_schema with no arguments ` +
              `for the index of every word this graph knows`,
          )
        }
        if (kind && !v.comp(kind)!.kind) {
          throw new Refused(
            `'${kind}' is a component, not a kind — the kinds are ` +
              `${v.kinds.join(', ')}; ask for it as component instead`,
          )
        }
        return kind
          ? ofKind(v, kind, opts.guide)
          : named.length
          ? { comps: named.map((name) => detail(v, name, opts.guide)) }
          : index(v)
      },
    },
  ]

  if (opts.search) {
    let find = opts.search
    tools.push({
      name: 'search',
      readOnly: true,
      title: 'Search the text',
      description:
        `Words, ranked: the entities whose text matches, best first, as whole ` +
        `bundles. Use graph_query when you know what you are filtering on and ` +
        `this when you only know what it says.`,
      input: {
        words: z.string().describe('what to search for'),
        limit: z.number().optional().describe('at most this many entities'),
      },
      output: bundles,
      run: (args) => {
        let words = str(args.words).trim()
        if (!words) throw new Refused('search needs words')
        return find(words, { limit: num(args.limit) })
      },
    })
  }
  return tools
}
