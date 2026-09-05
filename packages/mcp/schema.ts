// What a tool promises about its answer. A tool that replies in JSON declares
// an `outputSchema` and returns `structuredContent` (MCP 2025-06-18), so a
// caller parses a described value instead of guessing at a text blob.
//
// The bundle schema is not hand-written: it IS the vocabulary. `bundleSchema()`
// reads a loaded @yaks/vocab and emits the entity spine plus one object per
// declared component, each carrying its readable columns. Add a component to
// the vocabulary and it appears here with nobody editing this file.
//
// The depth is a choice with a price. A tool list is sent to the agent BEFORE
// it asks anything, so every byte of schema is context spent up front: over a
// ninety-component vocabulary the fully typed bundle is ~30 KB per tool and the
// names-only one ~11 KB. `names` is the default for that reason — it still
// tells an agent every component and every column, just not each column's type.

import { z } from 'zod'
import type { Column, Vocab } from '@yaks/vocab'

/**
 * How much of the vocabulary a bundle schema spells out.
 *
 * - `names` — every component and every column name, values left open. The
 *   default: it is roughly a third the size, and a tool list is context the
 *   agent pays for before it has asked anything.
 * - `full` — each column at its declared type, with an enum's members listed.
 */
export type Depth = 'names' | 'full'

/** How a bundle schema is derived: how deep, whether a component may be null,
 * and any column you spell yourself. */
export type BundleOpts = {
  /** how much of each column to describe (default: `names`) */
  depth?: Depth
  /** admit a null component — the shape of an APPLIED batch, which echoes
   * `comp: null` for a component the batch dropped. A read never answers one,
   * so a read door leaves this off (default: `false`) */
  nulls?: boolean
  /** a column your own reader answers differently — return `undefined` to
   * take the vocabulary's own reading */
  column?: (col: Column) => z.ZodTypeAny | undefined
}

// A column's value as it reads back. Every column is nullable (a cleared column
// reads null) and optional (a patch touches what it names), and an enum reads
// as its members. `.catch` is deliberately absent: this schema DESCRIBES the
// reply, and a reply that doesn't match is a bug to see, not to coerce.
let typed = (col: Column): z.ZodTypeAny =>
  col.category == 'enum' && col.values?.length
    ? z.enum(col.values as [string, ...string[]])
    : col.scalar == 'bool'
    ? z.boolean()
    : col.scalar == 'number' || col.scalar == 'priority'
    ? z.number()
    : z.string()

// One component as it appears in a bundle: a flat bag of its readable columns.
// Passthrough, never strict — a reader must not break on a column the server
// learned to send after this client was written. The component itself is
// optional, since a bundle carries only what its entity wears; `nulls` adds the
// other reading, for the door that echoes a batch back.
let compSchema = (vocab: Vocab, name: string, o: BundleOpts) =>
  z.object(
    Object.fromEntries(
      vocab.columns(name).map((prop) => {
        let col = vocab.column(name, prop)!
        let said = o.column?.(col) ?? (o.depth == 'full' ? typed(col) : null)
        // A named column is `unknown`, which already admits the null a cleared
        // one reads as — saying so twice doubles what the schema costs in the
        // agent's context for nothing.
        return [prop, said ? said.nullable().optional() : z.unknown()]
      }),
    ),
  ).passthrough()

/**
 * THE bundle, derived whole from a vocabulary: `{entity: {eid, num}, <comp>:
 * {<columns>}}` — the shape every read door in this family answers in.
 *
 * ```ts
 * let bundle = bundleSchema(shop) // names only, the cheap default
 * let typed = bundleSchema(shop, { depth: 'full' }) // every column's type
 * ```
 */
export let bundleSchema = (
  vocab: Vocab,
  opts: BundleOpts = {},
): z.ZodTypeAny =>
  z.object({
    ...Object.fromEntries(
      vocab.all.map((name) => {
        let comp = compSchema(vocab, name, opts)
        return [name, opts.nulls ? comp.nullable().optional() : comp.optional()]
      }),
    ),
    // `entity` and `kind` are stated AFTER the vocabulary and win over it: the
    // spine is a declared component too, but its `eid` is the row key rather
    // than a column, and a read speaks the derived display kind beside it.
    kind: z.string().optional().describe(
      'the derived display kind — what the components make this entity',
    ),
    entity: z.object({
      eid: z.string(),
      num: z.number().nullable().optional(),
    }).passthrough(),
  }).passthrough()

/**
 * One reference, as `graph_show` reports it: a column on one entity holding
 * another entity's id. Both directions of an entity's edges are this shape.
 */
export let edgeSchema: z.ZodTypeAny = z.object({
  from: z.string(),
  to: z.string(),
  comp: z.string(),
  prop: z.string(),
})

/** `graph_show`'s answer: the entities themselves, and every reference between
 * them. */
export let showSchema = (bundle: z.ZodTypeAny): z.ZodTypeAny =>
  z.object({
    bundles: z.array(bundle),
    edges: z.array(edgeSchema),
  })

/** `vocab`'s answer: the loaded vocabulary as the JSON Schema documents it was
 * loaded from, plus the two lists an agent reads first. */
export let vocabSchema: z.ZodTypeAny = z.object({
  comps: z.array(z.string()),
  kinds: z.array(z.string()),
  docs: z.array(z.record(z.unknown())),
})

/**
 * A tool's declared output: its structured result under `result`. MCP's
 * `structuredContent` must be an object, so an answer that is a list rides
 * under a key rather than being one.
 */
export let outputSchema = (result: z.ZodTypeAny): z.ZodTypeAny =>
  z.object({ result })
