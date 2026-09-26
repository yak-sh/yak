// What a tool promises about its result — and, for `graph_apply`, about what
// it accepts. A tool that replies in JSON declares an `outputSchema` and
// returns `structuredContent` (MCP 2025-06-18), so a caller parses a typed
// value instead of guessing at a blob of text.
//
// The bundle schema is not hand-written: it is derived from the vocabulary.
// `bundleSchema()` reads a loaded @yaks/vocab and emits the `entity` component
// plus one object per declared component, each carrying its readable
// properties. Add a component to the vocabulary and it appears here with nobody
// editing this file.
//
// The depth is a choice with a price. The tool list is sent to the agent
// before it asks anything, so every byte of schema is context spent up front:
// over a ninety-component vocabulary the fully typed bundle is ~30 KB per tool
// and the names-only one ~11 KB. `graph_apply` always uses `full`, because the
// alternative is an agent guessing at a property's type (T-34153) — and a guess
// costs a refused transaction, a re-read and a second attempt, which is more
// context than the schema ever was.

import { z } from 'zod'
import type { Prop, Vocab } from '@yaks/vocab'

/**
 * How much of the vocabulary a bundle schema describes.
 *
 * - `names` — every component and every property name, with values left
 *   untyped. Roughly a third the size, for a deployment that would rather
 *   spend the agent's context elsewhere.
 * - `full` — each property at its declared type, with an enum's members listed
 *   and the description the vocabulary gives it. The default.
 */
export type Depth = 'names' | 'full'

/** How a bundle schema is derived: how much detail, whether a component may be
 * null, whether it is `graph_apply`'s input schema, and any property you type
 * yourself. */
export type BundleOpts = {
  /** how much of each property to describe (default: `names`) */
  depth?: Depth
  /** allow a null component — the shape of an applied transaction, which
   * echoes a component the transaction removed as `null`. A read never
   * returns one, so a read tool leaves this off (default: `false`) */
  nulls?: boolean
  /** `graph_apply`'s input schema: the writable components and their writable
   * properties, each typed and described. It is open, like a read schema: a
   * client caches this schema when it connects and the vocabulary grows
   * afterwards, so a schema that refused an undeclared property would refuse a
   * property that now exists. The schema describes; the server decides
   * (default: `false`) */
  write?: boolean
  /** a property your deployment returns (or accepts) differently than the
   * vocabulary declares — a reference that reads back as a named object, or a
   * property two of your stores name differently. It is handed the options the
   * schema is being derived under, so you can type a property one way for a
   * read and another for a write; return `undefined` to use the vocabulary's
   * own type */
  prop?: (prop: Prop, opts: BundleOpts) => z.ZodTypeAny | undefined
}

// A JSON value of the types a property declares. What an object or array holds
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

// A property's value as it reads back. Every property is nullable (a cleared
// property reads back null) and optional (a patch only touches the properties
// it names), and an enum reads back as one of its members. `.catch` is
// deliberately absent: this schema describes the reply, and a reply that does
// not match is a bug to see, not to coerce.
let typed = (prop: Prop): z.ZodTypeAny =>
  prop.category == 'enum' && prop.values?.length
    ? z.enum(prop.values as [string, ...string[]])
    : prop.scalar == 'jsonb'
    ? json(prop.types!)
    : prop.scalar == 'bool'
    ? z.boolean()
    : prop.scalar == 'number' || prop.scalar == 'priority'
    ? z.number()
    : z.string()

// Attach the vocabulary's description of a component or property, when it has
// one. Only at `full`: a description is the other half of a type, and `names`
// is the depth that spends context on neither. It is attached to the outermost
// wrapper a value has, because a description set inside a nullable is emitted
// at both levels — the same sentence, twice, for every component there is.
let saying = <T extends z.ZodTypeAny>(
  s: T,
  said: string | undefined,
  o: BundleOpts,
): T => said && o.depth == 'full' ? s.describe(said) : s

// One component as it appears in a bundle: a flat object of its properties,
// each carrying the vocabulary's type and description for it. Both the read and
// the write schema are passthrough, never strict. A reader must not break on a
// property the server started sending after this client was written — and a
// writer keeps this schema for the whole conversation, cached along with the
// tool list it arrived in, while the vocabulary grows (roster.ts). A closed
// write schema would make that stale copy refuse a property that exists, inside
// the client, where no server can explain it. So the schema describes — every
// declared property typed, named and described — and the server decides:
// @yaks/graph's `admit` refuses a property nobody declared and lists the ones
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
      let def = vocab.prop(name, prop)!
      // A server-owned property is named in the write schema but left untyped:
      // a caller that reads a bundle and sends it back will include one, and
      // @yaks/graph's `admit` drops it rather than refusing the transaction.
      // The caller's own `prop` function is consulted only where a type is
      // being emitted at all: `names` costs a third of `full` by leaving every
      // value untyped, and typing some properties in the middle of that would
      // be neither.
      let owned = o.write && !info?.writable.includes(prop)
      let said = owned || o.depth != 'full'
        ? null
        : o.prop?.(def, o) ?? typed(def)
      // An untyped property is `unknown`, which already allows the null a
      // cleared property reads back as — declaring that separately would double
      // what the schema costs in the agent's context for nothing.
      return [
        prop,
        said
          ? saying(said.nullable().optional(), def.description, o)
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
    'delete the whole entity — it is tombstoned under the same eid; a later ' +
      'write that gives it a component, not based on a read from before the ' +
      'delete, brings it back',
  ),
  $was: z.record(z.record(z.string().nullable())).optional().describe(
    'a precondition, by component then property: the SHA-256 of the value ' +
      'you read (or null for "I read none"). The transaction is refused if ' +
      'the value changed.',
  ),
}

/**
 * The bundle, derived whole from a vocabulary: `{entity: {eid, num}, <comp>:
 * {<properties>}}` — the shape every interface in this family speaks, for reads
 * and for writes.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 *
 * let price = { type: 'number' }
 * let shop = loadVocab([{
 *   $defs: { book: { component: true, properties: { price } } },
 * }])
 * let bundle = bundleSchema(shop) // names only, the cheap default
 * let typed = bundleSchema(shop, { depth: 'full' }) // every property's type
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
    // `entity` is a declared component too, but its `eid` is the row key rather
    // than a property, and a read returns the derived display kind beside it.
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
