// What a tool promises about its answer — and, at the write door, about what
// it takes. A tool that replies in JSON declares an `outputSchema` and returns
// `structuredContent` (MCP 2025-06-18), so a caller parses a described value
// instead of guessing at a text blob.
//
// The bundle schema is not hand-written: it IS the vocabulary. `bundleSchema()`
// reads a loaded @yaks/vocab and emits the entity spine plus one object per
// declared component, each carrying its readable columns. Add a component to
// the vocabulary and it appears here with nobody editing this file.
//
// The depth is a choice with a price. A tool list is sent to the agent BEFORE
// it asks anything, so every byte of schema is context spent up front: over a
// ninety-component vocabulary the fully typed bundle is ~30 KB per tool and the
// names-only one ~11 KB. `full` is what the WRITE door takes, always, because
// the alternative is an agent guessing at a column's type (T-34153) — and a
// guess costs a refused batch, a re-read, and a second attempt, which is more
// context than the schema ever was.

import { z } from 'zod'
import type { Column, Vocab } from '@yaks/vocab'

/**
 * How much of the vocabulary a bundle schema spells out.
 *
 * - `names` — every component and every column name, values left open. Roughly
 *   a third the size, for a host that would rather spend the context
 *   elsewhere.
 * - `full` — each column at its declared type, with an enum's members listed
 *   and whatever the vocabulary SAYS about it. The default.
 */
export type Depth = 'names' | 'full'

/** How a bundle schema is derived: how deep, whether a component may be null,
 * whether it is the write door's reading, and any column you spell yourself. */
export type BundleOpts = {
  /** how much of each column to describe (default: `names`) */
  depth?: Depth
  /** admit a null component — the shape of an APPLIED batch, which echoes
   * `comp: null` for a component the batch dropped. A read never answers one,
   * so a read door leaves this off (default: `false`) */
  nulls?: boolean
  /** the WRITE door's reading: the wire-writable components and their
   * writable columns, each component CLOSED — a column the vocabulary does
   * not declare is refused by the schema, which is what `apply()` does with
   * it anyway. A read is the other way around: it stays open, because a
   * reader must not break on a column the server learned after it was
   * written (default: `false`) */
  write?: boolean
  /** a column your own door answers (or takes) differently than the
   * vocabulary declares — a reference that reads back as a named object, a
   * column two of your stores spell differently. It is handed the options it
   * is deriving under, so a host can say one thing for a read and another for
   * a write; return `undefined` to take the vocabulary's own reading */
  column?: (col: Column, opts: BundleOpts) => z.ZodTypeAny | undefined
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

// What a schema says a component or column MEANS, where the vocabulary says
// it. Only at `full`: a description is the other half of a type, and `names` is
// the depth that spends nothing on either. It is said on the OUTERMOST wrapper
// a value has, because a description inside a nullable is emitted at both
// levels — the same sentence, twice, over every component there is.
let saying = <T extends z.ZodTypeAny>(
  s: T,
  said: string | undefined,
  o: BundleOpts,
): T => said && o.depth == 'full' ? s.describe(said) : s

// One component as it appears in a bundle: a flat bag of its columns, each
// carrying what the vocabulary says about it. A READ is passthrough, never
// strict — a reader must not break on a column the server learned to send
// after this client was written — while a WRITE is CLOSED, so a guessed column
// is refused where it was typed rather than at the far end of the wire. The
// component itself is optional, since a bundle carries only what its entity
// wears; `nulls` adds the other reading, for the door that echoes a batch back
// and the write that drops a component.
let compSchema = (
  vocab: Vocab,
  name: string,
  o: BundleOpts,
): z.ZodTypeAny => {
  let info = vocab.comp(name)
  let shape = Object.fromEntries(
    vocab.columns(name).map((prop) => {
      let col = vocab.column(name, prop)!
      // A server-owned column is spelled on a WRITE but never typed: a caller
      // who reads a bundle and sends it back says one, and admission drops it
      // rather than punishing it (@yaks/graph `admit`). The host's own reading
      // is consulted only where a type is being said at all: `names` costs a
      // third of `full` by leaving every value open, and a host reading in the
      // middle of that would be neither.
      let owned = o.write && !info?.writable.includes(prop)
      let said = owned || o.depth != 'full'
        ? null
        : o.column?.(col, o) ?? typed(col)
      // A named column is `unknown`, which already admits the null a cleared
      // one reads as — saying so twice doubles what the schema costs in the
      // agent's context for nothing.
      return [
        prop,
        said
          ? saying(said.nullable().optional(), col.description, o)
          : z.unknown(),
      ]
    }),
  )
  return o.write ? z.object(shape).strict() : z.object(shape).passthrough()
}

// The keys a WRITE says that no vocabulary declares: the two sugars `apply()`
// reads off a bundle rather than storing. `$actor` is deliberately absent — a
// door signs the batch with the identity it authenticated (server.ts), so a
// client saying it would be saying nothing.
let sugar = {
  $delete: z.boolean().optional().describe(
    'delete the whole entity — it is tombstoned, and nothing can resurrect ' +
      'the eid',
  ),
  $was: z.record(z.record(z.string().nullable())).optional().describe(
    'a precondition, by component then column: the SHA-256 of the value you ' +
      'read (or null for "I read none"). The batch is refused if it moved.',
  ),
}

/**
 * THE bundle, derived whole from a vocabulary: `{entity: {eid, num}, <comp>:
 * {<columns>}}` — the shape every door in this family speaks, read or write.
 *
 * ```ts
 * let bundle = bundleSchema(shop) // names only, the cheap default
 * let typed = bundleSchema(shop, { depth: 'full' }) // every column's type
 * let write = bundleSchema(shop, { depth: 'full', nulls: true, write: true })
 * ```
 */
export let bundleSchema = (
  vocab: Vocab,
  opts: BundleOpts = {},
): z.ZodTypeAny =>
  z.object({
    ...Object.fromEntries(
      (opts.write ? vocab.comps : vocab.all).map((name) => {
        let comp = compSchema(vocab, name, opts)
        let one = opts.nulls ? comp.nullable().optional() : comp.optional()
        return [name, saying(one, vocab.comp(name)?.description, opts)]
      }),
    ),
    // `entity` and `kind` are stated AFTER the vocabulary and win over it: the
    // spine is a declared component too, but its `eid` is the row key rather
    // than a column, and a read speaks the derived display kind beside it.
    ...(opts.write ? sugar : {
      kind: z.string().optional().describe(
        'the derived display kind — what the components make this entity',
      ),
    }),
    entity: z.object({
      eid: opts.write
        ? z.string().describe(
          "the entity's id: one you mint (a uuid), or '$name' to have the " +
            'graph mint one and answer which id it picked',
        )
        : z.string(),
      num: z.number().nullable().optional(),
    }).passthrough(),
    // Open at the top even where a write is closed per component: the `$`
    // words are the HOST's to add — yaks.app says `$app` on a bundle — and a
    // vocabulary GROWS mid-connection, so a component this schema was derived
    // before still reaches the graph that has since learned it. That is the
    // whole free-form escape a write needs; the door announces the growth with
    // `tools/list_changed` and a client re-reads.
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

/**
 * A tool's declared output: its structured result under `result`. MCP's
 * `structuredContent` must be an object, so an answer that is a list rides
 * under a key rather than being one.
 */
export let outputSchema = (result: z.ZodTypeAny): z.ZodTypeAny =>
  z.object({ result })
