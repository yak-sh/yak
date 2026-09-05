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
  bundleSchema,
  type Depth,
  outputSchema,
  showSchema,
  vocabSchema,
} from './schema.ts'

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
  /** how deeply the bundle schema spells out each column (default: `names`) */
  depth?: Depth
  /** the ranked search seam; without it there is no `search` tool */
  search?: Search
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let num = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined
let strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x == 'string') : []

// A batch, checked at the door. The input schema says "an array of objects"
// and no more — a bundle's keys ARE the vocabulary, and spelling all of them
// again as an input schema would double what the tool list costs — so the one
// thing worth insisting on is the identity every bundle must carry.
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
 * `vocab`, and `search` when a {@link Search} was passed.
 *
 * ```ts
 * let tools = core({ vocab: shop, depth: 'full' })
 * ```
 */
export let core = (opts: CoreOpts): Tool[] => {
  let { vocab } = opts
  let depth = opts.depth ?? 'names'
  let bundle = bundleSchema(vocab, { depth })
  let bundles = outputSchema(z.array(bundle))
  // What `apply()` answers is the batch AS APPLIED, and a batch may say
  // `comp: null` — drop this component — which no read ever answers.
  let applied = outputSchema(
    z.array(bundleSchema(vocab, { depth, nulls: true })),
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
        `stamps, minted numbers, and a tombstone per casualty. Call vocab to ` +
        `see which components and columns exist.`,
      input: {
        change: z.array(z.record(z.unknown())).describe(
          'the bundles to apply, atomically',
        ),
      },
      output: applied,
      run: (args, ctx) => ctx.apply(batch(args.change)),
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
      name: 'vocab',
      readOnly: true,
      title: 'The vocabulary',
      description:
        `What this graph knows: every component and what columns it has, as ` +
        `the JSON Schema documents the vocabulary was loaded from. Read it ` +
        `before writing a component you have not written before.`,
      output: outputSchema(vocabSchema),
      run: (_args, ctx) => ({
        comps: ctx.graph.vocab.comps,
        kinds: ctx.graph.vocab.kinds,
        docs: ctx.graph.vocab.docs,
      }),
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
