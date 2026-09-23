// The byte store that lives in the database the rows already live in: one table
// of `(sha, value)` beside the component tables. It is the one to reach for
// first — the bytes land in the same transaction as the row that addresses
// them, so a committed document can never point at a value that was not
// written, and there is no second thing to back up.
//
// It also gives the read side something no other store can: the resolution is a
// SQL expression, so a query and a whole-entity read both get text without a
// second round trip. {@link blobRead} builds that expression as an @yaks/sql
// read override, one per content-addressed property; {@link blobText} builds
// its smaller half — an address resolved to its text — for the places that
// already hold an address, chiefly a full-text index's triggers and the view it
// reads back through.
//
// The table holds text, not bytes — which is what lets the read be an ordinary
// string expression — so this store is for prose. Binary content belongs in the
// file or object stores, whose bytes never have to be read by SQL.
//
// Every name in the layout is configurable because this table is often one an
// application already has: point {@link Layout} at it and the existing rows are
// readable as they stand.

import type { Vocab } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import type { Driver } from './driver.ts'
import { bodies } from './props.ts'
import { type Blobs, encode } from './store.ts'

/**
 * Where the blob table is and what its two columns are called. The defaults
 * describe the table {@link blobSchema} creates; an application pointing this
 * at a table it already has names that table's columns instead.
 */
export type Layout = {
  /** the table holding the objects (default `blob_text`) */
  table?: string
  /** the column holding an object's address (default `sha`) */
  key?: string
  /** the column holding its text (default `value`) */
  value?: string
}

type Named = Required<Layout>

let named = (l: Layout = {}): Named => ({
  table: l.table ?? 'blob_text',
  key: l.key ?? 'sha',
  value: l.value ?? 'value',
})

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// This table's column is text, so bytes that are not valid UTF-8 have no
// representation in it. Refusing them here is the difference between a store
// that cannot hold an object and one that holds a mangled copy: the address
// would return bytes that do not hash to it, breaking the one thing content
// addressing promises.
let strict = new TextDecoder('utf-8', { fatal: true })
let asText = (bytes: Uint8Array): string => {
  try {
    return strict.decode(bytes)
  } catch {
    throw new Error(
      '@yaks/blob: this store holds text and these bytes are not UTF-8 — ' +
        'binary belongs in a directory or a bucket',
    )
  }
}

/**
 * The statement creating the blob table: an address, and the text stored under
 * it. Run it beside a storage adapter's own schema.
 */
export let blobSchema = (layout: Layout = {}): string[] => {
  let l = named(layout)
  return [
    `create table if not exists ${q(l.table)} (
    ${q(l.key)} text primary key,
    ${q(l.value)} text not null
  )`,
  ]
}

/**
 * A {@link Blobs} over a SQLite table. Synchronous, so a graph writing through
 * it stays synchronous end to end; `put` is `insert or ignore`, because writing
 * the same address twice is writing the same bytes twice.
 */
export let sqliteBlobs = (driver: Driver, layout: Layout = {}): Blobs => {
  let l = named(layout)
  let row = (sha: string) =>
    driver.query(
      `select ${q(l.value)} as value from ${q(l.table)} where ${q(l.key)} = ?`,
      [sha],
    )[0]
  return {
    has: (sha) => row(sha) != null,
    get: (sha) => {
      let found = row(sha)
      return found == null ? undefined : encode(String(found.value))
    },
    put: (sha, bytes) => {
      driver.query(
        `insert or ignore into ${q(l.table)} (${q(l.key)}, ${q(l.value)})
           values (?, ?)`,
        [sha, asText(bytes)],
      )
    },
  }
}

/**
 * How a stored address reads as its text, keyed `comp.prop`: given SQL naming
 * the address, each entry returns SQL naming the text it stands for. It is the
 * smaller half of a read override — no entity, no join, just the value — which
 * is the form needed wherever the address is already in hand: an FTS5 trigger
 * (`new."body"`), a view column, a report.
 *
 * @yaks/fts and @yaks/sqlite accept a map of this shape so their indexes hold
 * words rather than addresses; both declare the type structurally, so neither
 * has to depend on this package to be handed one.
 */
export type Text = Record<string, (address: string) => string>

// The text an address stands for: one row of the blob table, found by its key.
let textExpr = (l: Named) => (address: string) =>
  `(select __b.${q(l.value)} from ${q(l.table)} __b` +
  ` where __b.${q(l.key)} = ${address})`

/**
 * The resolution for every content-addressed property in a vocabulary, as
 * {@link Text}. Pass it to `@yaks/sqlite`'s `storage()` (or to @yaks/fts's
 * `schema()`) and a full-text index over a body property holds the prose
 * instead of the hash that stands for it:
 *
 * ```ts
 * import { storage } from '@yaks/sqlite'
 * import { blobText } from '@yaks/blob'
 *
 * let store = storage(driver, vocab, { text: blobText(vocab) })
 * ```
 *
 * A blob is immutable and content-addressed, so resolving one in a trigger is
 * sound: the text an address stands for is the same before and after the row
 * that names it moves, which is exactly what an external-content index needs
 * from a delete.
 */
export let blobText = (vocab: Vocab, layout: Layout = {}): Text => {
  let text = textExpr(named(layout))
  return Object.fromEntries(
    bodies(vocab).map(({ comp, prop }) => [`${comp}.${prop}`, text]),
  )
}

// The read expression for one property: the stored text, found by joining the
// address its column holds to the blob table. It is written self-contained — it
// names its own component table rather than assuming the query already joined
// one — so the same expression serves a filter predicate, a dereferenced path,
// and a whole-entity read.
let readExpr = (l: Named, comp: string, prop: string) => (owner: string) =>
  textExpr(l)(
    `(select __c.${q(prop)} from ${q(comp)} __c where __c."entity" = ${owner})`,
  )

/**
 * The read side, as @yaks/sql read overrides: one entry per content-addressed
 * property, each resolving the stored address to its text in the statement
 * itself. Pass them to a compile (or to `@yaks/sqlite`'s `storage()`, which
 * passes them on to both the query and the whole-entity read) and a body
 * property reads as text everywhere:
 *
 * ```ts
 * import { storage } from '@yaks/sqlite'
 * import { blobRead } from '@yaks/blob'
 *
 * let store = storage(driver, vocab, { derived: blobRead(vocab) })
 * // store.read('.post!')[0].post.body === 'a long essay…'
 * ```
 *
 * Merge them with any overrides of your own — the registry is a plain object
 * keyed `comp.prop`.
 */
export let blobRead = (vocab: Vocab, layout: Layout = {}): Derived => {
  let l = named(layout)
  return Object.fromEntries(
    bodies(vocab).map(({ comp, prop }) => [
      `${comp}.${prop}`,
      {
        tag: 'text' as const,
        expr: readExpr(l, comp, prop),
        text: textExpr(l),
      },
    ]),
  )
}
