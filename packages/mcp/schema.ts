// What a tool promises about its result — and, for `graph_apply`, about what
// it accepts. A tool that replies in JSON declares an `outputSchema` and
// returns `structuredContent` (MCP 2025-06-18), so a caller parses a typed
// value instead of guessing at a blob of text.
//
// The bundle schema is not hand-written: it is derived from the vocabulary.
// `bundleSchema()` reads a loaded @yaks/vocab and emits the `entity` component
// plus one object per declared component, each carrying its readable columns.
// Add a component to the vocabulary and it appears here with nobody editing
// this file.
//
// The depth is a choice with a price. The tool list is sent to the agent
// before it asks anything, so every byte of schema is context spent up front:
// over a ninety-component vocabulary the fully typed bundle is ~30 KB per tool
// and the names-only one ~11 KB. `graph_apply` always uses `full`, because the
// alternative is an agent guessing at a column's type (T-34153) — and a guess
// costs a refused transaction, a re-read and a second attempt, which is more
// context than the schema ever was.

import { z } from 'zod'
import type { Prop, Vocab } from '@yaks/vocab'

/**
 * How much of the vocabulary a bundle schema spells out.
 *
 * - `names` — every component and every column name, with values left
 *   untyped. Roughly a third the size, for a deployment that would rather
 *   spend the agent's context elsewhere.
 * - `full` — each column at its declared type, with an enum's members listed
 *   and the description the vocabulary gives it. The default.
 */
export type Depth = 'names' | 'full'

/** How a bundle schema is derived: how much detail, whether a component may be
 * null, whether it is `graph_apply`'s input schema, and any column you type
 * yourself. */
export type BundleOpts = {
  /** how much of each column to describe (default: `names`) */
  depth?: Depth
  /** allow a null component — the shape of an applied transaction, which
   * echoes a component the transaction removed as `null`. A read never
   * returns one, so a read tool leaves this off (default: `false`) */
  nulls?: boolean
  /** `graph_apply`'s input schema: the writable components and their writable
   * columns, each typed and described. It is open, like a read schema: a
   * client caches this schema when it connects and the vocabulary grows
   * afterwards, so a schema that refused an undeclared column would refuse a
   * column that now exists. The schema describes; the server decides (default:
   * `false`) */
  write?: boolean
  /** a column your deployment returns (or accepts) differently than the
   * vocabulary declares — a reference that reads back as a named object, or a
   * column two of your stores name differently. It is handed the options the
   * schema is being derived under, so you can type a column one way for a read
   * and another for a write; return `undefined` to use the vocabulary's own
   * type */
  column?: (col: Prop, opts: BundleOpts) => z.ZodTypeAny | undefined
}

// A JSON value of the types a column declares. What an object or array holds
// is not described yet: the vocabulary does not validate it either.
let JSON_TYPES: Record<string, z.ZodTypeAny> = {
  object: z.record(z.unknown()),
  array: z.array(z.unknown()),
  string: z.string(),
  number: z.number(),
  integer: z.number().int(),
  boolean: z.boolean(),
  null: z.null(),
}
let json = (types: string[]): z.ZodTypeAny => {
  let [one, two, ...rest] = types.map((t) => JSON_TYPES[t] ?? z.unknown())
  return two ? z.union([one, two, ...rest]) : one
}

// A column's value as it reads back. Every column is nullable (a cleared
// column reads back null) and optional (a patch only touches the columns it
// names), and an enum reads back as one of its members. `.catch` is
// deliberately absent: this schema describes the reply, and a reply that does
// not match is a bug to see, not to coerce.
let typed = (col: Prop): z.ZodTypeAny =>
  col.category == 'enum' && col.values?.length
    ? z.enum(col.values as [string, ...string[]])
    : col.scalar == 'jsonb'
    ? json(col.types!)
    : col.scalar == 'bool'
    ? z.boolean()
    : col.scalar == 'number' || col.scalar == 'priority'
    ? z.number()
    : z.string()

// Attach the vocabulary's description of a component or column, when it has
// one. Only at `full`: a description is the other half of a type, and `names`
// is the depth that spends context on neither. It is attached to the outermost
// wrapper a value has, because a description set inside a nullable is emitted
// at both levels — the same sentence, twice, for every component there is.
let saying = <T extends z.ZodTypeAny>(
  s: T,
  said: string | undefined,
  o: BundleOpts,
): T => said && o.depth == 'full' ? s.describe(said) : s

// One component as it appears in a bundle: a flat object of its columns, each
// carrying the vocabulary's type and description for it. Both the read and the
// write schema are passthrough, never strict. A reader must not break on a
// column the server started sending after this client was written — and a
// writer keeps this schema for the whole conversation, cached along with the
// tool list it arrived in, while the vocabulary grows (roster.ts). A closed
// write schema would make that stale copy refuse a column that exists, inside
// the client, where no server can explain it. So the schema describes — every
// declared column typed, named and described — and the server decides:
// @yaks/graph's `admit` refuses a column nobody declared and lists the ones
// that are declared.
//
// The component itself is optional, since a bundle carries only the components
// its entity has; `nulls` allows the null form as well, for `graph_apply`
// echoing back a transaction that removed a component.
let compSchema = (
  vocab: Vocab,
  name: string,
  o: BundleOpts,
): z.ZodTypeAny => {
  let info = vocab.comp(name)
  let shape = Object.fromEntries(
    vocab.props(name).map((prop) => {
      let col = vocab.prop(name, prop)!
      // A server-owned column is named in the write schema but left untyped: a
      // caller that reads a bundle and sends it back will include one, and
      // @yaks/graph's `admit` drops it rather than refusing the transaction.
      // The caller's own `column` function is consulted only where a type is
      // being emitted at all: `names` costs a third of `full` by leaving every
      // value untyped, and typing some columns in the middle of that would be
      // neither.
      let owned = o.write && !info?.writable.includes(prop)
      let said = owned || o.depth != 'full'
        ? null
        : o.column?.(col, o) ?? typed(col)
      // An untyped column is `unknown`, which already allows the null a
      // cleared column reads back as — declaring that separately would double
      // what the schema costs in the agent's context for nothing.
      return [
        prop,
        said
          ? saying(said.nullable().optional(), col.description, o)
          : z.unknown(),
      ]
    }),
  )
  return z.object(shape).passthrough()
}

// The two write-only keys that no vocabulary declares: `apply()` reads them
// off a bundle and acts on them rather than storing them. `$actor` is
// deliberately absent — the server signs the transaction with the identity it
// authenticated (server.ts), so a client setting it would have no effect.
let sugar = {
  $delete: z.boolean().optional().describe(
    'delete the whole entity — it is tombstoned, and nothing can resurrect ' +
      'the eid',
  ),
  $was: z.record(z.record(z.string().nullable())).optional().describe(
    'a precondition, by component then column: the SHA-256 of the value you ' +
      'read (or null for "I read none"). The transaction is refused if the ' +
      'value changed.',
  ),
}

/**
 * The bundle, derived whole from a vocabulary: `{entity: {eid, num}, <comp>:
 * {<columns>}}` — the shape every interface in this family speaks, for reads
 * and for writes.
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
    // `entity` and `kind` are declared after the vocabulary and override it:
    // `entity` is a declared component too, but its `eid` is the row key
    // rather than a column, and a read returns the derived display kind beside
    // it.
    ...(opts.write ? sugar : {
      kind: z.string().optional().describe(
        'the derived display kind — what the components make this entity',
      ),
      // The one `$` key `apply()` returns (@yaks/graph `composed`), and only
      // on the transaction it echoes back: the caller's own placeholder for an
      // entity whose id it could not know. `nulls` marks that case — a read
      // returns neither a null component nor an alias.
      ...(opts.nulls
        ? {
          $alias: z.string().optional().describe(
            "the '$name' this transaction referred to the entity by, when it " +
              'used one',
          ),
        }
        : {}),
    }),
    entity: z.object({
      eid: opts.write
        ? z.string().describe(
          "the entity's id: one you generate (a uuid), or '$name' to have " +
            'the graph generate one and report which id it picked',
        )
        : z.string(),
      num: z.number().nullable().optional(),
    }).passthrough(),
    // Open at the top level as well as per component: the `$` keys are the
    // calling program's to add — yaks.app puts `$app` on a bundle — and a
    // vocabulary grows mid-connection, so a component declared after this
    // schema was derived still reaches the graph. The server announces the
    // growth with `tools/list_changed` and the roster sentence (roster.ts),
    // and the client re-reads the tool list.
  }).passthrough()
/**
 * What `graph_schema` promises: components — a line each in the index, all of
 * it when one was asked for — plus the kind list, or the kind asked about.
 */
export let schemaSchema: z.ZodTypeAny = z.object({
  comps: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      kind: z.boolean().describe('whether this component names a display kind'),
      columns: z.union([
        z.array(z.string()),
        z.array(
          z.object({
            prop: z.string(),
            type: z.string(),
            description: z.string().optional(),
            values: z.array(z.string()).optional(),
            ref: z.string().optional(),
            notes: z.array(z.string()).optional(),
          }).passthrough(),
        ),
      ]),
      worn_with: z.array(z.string()).optional(),
      references: z.object({
        out: z.array(z.object({ prop: z.string(), to: z.string() })),
        in: z.array(z.object({ comp: z.string(), prop: z.string() })),
      }).optional(),
      example: z.record(z.unknown()).optional(),
      guide: z.string().optional(),
    }).passthrough(),
  ),
  kinds: z.array(z.string()).optional(),
  kind: z.string().optional(),
})
