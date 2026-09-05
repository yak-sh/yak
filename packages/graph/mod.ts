/**
 * @yaks/graph — the entity/component graph core: the data model every yaks
 * package shares, the wire that carries writes, and the pluggable `apply()`
 * that commits them.
 *
 * ## The model
 * Everything is an ENTITY, identified by an {@link Entity} — a string `eid`
 * (client-minted) plus a server-minted `num`. An entity carries COMPONENTS: a
 * named bag of columns, one per component it wears. An entity has no type of
 * its own; it IS whatever components it carries. A blog post is a `doc` plus a
 * `post`; a product is a `doc` plus a `price`. Adding a component adds a facet.
 *
 * ## The wire
 * A {@link Bundle} is one entity plus the components to write to it. The
 * identity rides IN the bundle, under the `entity` key — `entity.eid` is the
 * id, never a bare key at the root. Every other key names a component mapping
 * to its columns. A write is a PATCH: an omitted column is left untouched, a
 * `null` column is cleared, and a `null` component is dropped. A {@link Change}
 * is a flat array of bundles, applied atomically. The bundle is the single
 * comp-carrying shape: even a value that is never stored (an aggregate, a
 * computed rank) rides as a component in a bundle.
 *
 * Two reserved keys ride beside the components as SUGAR, recognized by
 * `apply()` rather than stored as columns:
 * - `$delete: true` — delete the whole entity (it is tombstoned; a dropped
 *   entity can also be spelled as a `tombstone` component);
 * - `$was` — a per-column precondition: refuse the change if a value read has
 *   moved since (see {@link Was}).
 *
 * ## Apply is pluggable, in fixed phases
 * A change runs through an ordered pipeline of {@link Phase}s. The order is
 * load-bearing — preconditions and journalling commit inside the transaction,
 * effects fire only after commit — so a plugin registers hooks against a NAMED
 * phase, never an arbitrary point. A {@link Plugin} contributes a component
 * vocabulary and any phase hooks; the same shape a downstream app uses to add
 * its own domain.
 *
 * This package ships ZERO components — a vocabulary is described with
 * {@link https://jsr.io/@yaks/vocab | @yaks/vocab} and contributed by plugins.
 * It has no `snapshot()`: reads are queries answered by a {@link Storage}
 * adapter, never a whole-graph dump.
 *
 * @module
 */

import type { Query as Ast } from '@yaks/query'
import type { VocabDoc } from '@yaks/vocab'

/** An entity's id: a client-minted string (a uuid, or a content hash). A
 * reference column reads back as the target's `eid`, so this is also the type
 * of a reference. */
export type Eid = string

/**
 * An entity's identity: a client-minted string `eid` (a uuid, or a content
 * hash), and the server-minted `num` that appears on first touch. On the wire a
 * new entity carries only its `eid`; `num` is read back, never written.
 */
export type Entity = { eid: Eid; num?: number }

/** A component's columns — a flat bag of scalar values, never nested. */
export type Comp = Record<string, unknown>

/**
 * A per-column precondition, keyed by component name then column name: the
 * value each named column must still hold for the change to apply. `apply()`
 * refuses the whole change if any has moved. Rides a bundle as `$was`.
 */
export type Was = Record<string, Record<string, unknown>>

/**
 * A patch for one entity. Its identity rides under the `entity` key
 * (`entity.eid` is the id); every other key names a component mapping to its
 * columns, or `null` to drop that component. The reserved sugar keys `$delete`
 * (delete the whole entity) and `$was` (a {@link Was} precondition) are
 * recognized by `apply()` rather than written as columns.
 */
export type Bundle =
  & {
    /** the identity component: the entity this bundle patches */
    entity: Entity
    /** sugar — delete the whole entity (tombstoned) */
    $delete?: boolean
    /** sugar — a per-column precondition that must still hold */
    $was?: Was
  }
  & { [comp: string]: Comp | null | Entity | Was | boolean | undefined }

/** A flat batch of bundles, applied atomically: `Change = Bundle[]`. */
export type Change = Bundle[]

/** One raw result row from a storage read — column name → value. */
export type Row = Record<string, unknown>

/** A query, as text (parsed by @yaks/query) or an already-built AST. */
export type Query = string | Ast

/** Options that ride a read, such as a fixed `now` for relative time phrases. */
export type ReadOpts = { now?: number }

/**
 * A storage adapter — the seam that owns the bytes. It turns a vocabulary into
 * schema, answers queries as whole bundles, and patches a change into rows.
 * Every method is async-or-sync: an async engine returns a promise, a
 * synchronous one returns a value, so one seam serves an embedded SQLite and a
 * remote database alike. {@link https://jsr.io/@yaks/sqlite | @yaks/sqlite},
 * `@yaks/durable-object`, and `@yaks/d1` implement this shape.
 */
export type Storage = {
  /** the schema statements the bound vocabulary implies */
  ddl: () => string[]
  /** run them — create the tables and indexes the vocabulary needs */
  install: () => void | Promise<void>
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
  /** a query → the compiled statement's raw rows (counts, tallies) */
  rows: (query: Query, opts?: ReadOpts) => Row[] | Promise<Row[]>
  /** a change patched in → the identities any delete tombstoned */
  write: (change: Change) => Entity[] | Promise<Entity[]>
}

/**
 * The ordered phases a change runs through in `apply()`. The order is
 * load-bearing, so a plugin registers against a NAMED phase, never an
 * arbitrary point in the pipeline.
 */
export type Phase =
  | 'normalize' // canonicalize incoming column values
  | 'admit' // drop server-owned/unknown columns, validate against the vocab
  | 'precondition' // the `$was` guard: refuse if a read value has moved
  | 'mutate' // patch the components in
  | 'cascade' // a delete tombstones the entity and its dependents
  | 'journal' // record attribution and history for the change
  | 'commit' // the transaction boundary
  | 'effect' // post-commit observers act on committed data
  | 'audit' // post-rollback bookkeeping (e.g. a bounced-claim record)

/** The context a phase hook receives: the phase name and the bound vocabulary. */
export type ApplyCtx = { phase: Phase; vocab: VocabDoc[] }

/** A hook a plugin runs at one phase; it may inspect or reject the change. */
export type PhaseHook = (change: Change, ctx: ApplyCtx) => void | Promise<void>

/**
 * A plugin: a self-contained contribution to a graph. It brings a component
 * vocabulary (its domain) and any phase hooks it needs. Composing plugins is
 * how a graph gains a domain — the same shape a downstream app uses to add its
 * own components.
 */
export type Plugin = {
  /** the plugin's name */
  name: string
  /** the component vocabulary this plugin contributes */
  vocab?: VocabDoc[]
  /** phase hooks it registers on `apply()` */
  apply?: Partial<Record<Phase, PhaseHook>>
}
