// The backend that lives in the database the rows already live in: one table
// of `(sha, value)` beside the component tables. It is the backend to reach for
// first — the bytes land in the same transaction as the row that addresses
// them, so a committed document can never point at a value that was not
// written, and there is no second thing to back up.
//
// It also gives the read side something no other backend can: the resolution is
// a SQL EXPRESSION, so a query and a whole-entity gather both read text without
// a second round trip. {@link blobRead} builds that expression as an @yaks/sql
// read override, one per content-addressed column.
//
// The table holds TEXT, not bytes — which is what lets the read be an ordinary
// string expression — so this backend is for prose. Binary content belongs in
// the file or object backends, whose bytes never have to be read by SQL.
//
// Every name in the layout is configurable because this table is often one an
// application already has: point {@link Layout} at it and the existing rows are
// readable as they stand.

import type { Vocab } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import type { Driver } from './driver.ts'
import { bodies } from './columns.ts'
import { type Blobs, decode, encode } from './store.ts'

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
 * it stays synchronous end to end; `put` is insert-or-ignore, because writing
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
        [sha, decode(bytes)],
      )
    },
  }
}

// The read expression for one column: the stored text, found by joining the
// column's address to the blob table. It is written self-contained — it names
// its own component table rather than assuming the query joined one — so the
// same expression serves a membership predicate, a dereferenced path, and a
// whole-entity gather.
let readExpr = (l: Named, comp: string, prop: string) => (owner: string) =>
  `(select __b.${q(l.value)} from ${q(l.table)} __b` +
  ` where __b.${q(l.key)} = (select __c.${q(prop)} from ${q(comp)} __c` +
  ` where __c."entity" = ${owner}))`

/**
 * The read side, as @yaks/sql read overrides: one entry per content-addressed
 * column, each resolving the stored address to its text in the statement
 * itself. Hand them to a compile (or to `@yaks/sqlite`'s `storage()`, which
 * passes them on to both the query and the whole-entity gather) and a body
 * column reads as text everywhere:
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
      { tag: 'text' as const, expr: readExpr(l, comp, prop) },
    ]),
  )
}
