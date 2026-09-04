// @yaks/sqlite — a storage adapter that turns the yaks query/vocabulary/SQL
// stack into a working SQLite-backed store. It composes three sibling packages:
//
//   @yaks/query   parses a query string into an AST
//   @yaks/vocab   describes a component vocabulary and interrogates it
//   @yaks/sql     compiles an AST + a vocabulary into SQL + bound params
//
// and adds the two halves those packages leave to a backend: DDL (the schema a
// vocabulary implies) and WRITES (a patch applied to that schema). The reads it
// gets for free — it runs @yaks/sql's compiled statement and gathers the rows.
//
// The model is the yaks entity graph: everything is an ENTITY (a string id)
// wearing COMPONENTS (a row per component table). An entity is what its
// components make it — a blog post is a `doc` plus a `post`; a product is a
// `doc` plus a `price`. There is no type column. A read hands back a BUNDLE
// (an entity with its components gathered); a write takes a batch of bundles
// and PATCHES them in — omitted columns untouched, a null column cleared, a
// null component dropped, a null `entity` deleted (and death cascades).
//
// The adapter is bound to a driver and a vocabulary once, by `storage()`, and
// speaks bundles from then on. The driver is any object with `query`/`exec`
// (see ./driver.ts) — an in-process SQLite for a test, a pooled handle for a
// server — so nothing here names a concrete SQLite library.

import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from '@yaks/sql'
import type { Driver, Row } from './driver.ts'
import type { Bundle } from './bundle.ts'
import { schema } from './ddl.ts'
import { type Query, read, rows } from './read.ts'
import { write } from './write.ts'

export * from './driver.ts'
export * from './bundle.ts'
export { schema } from './ddl.ts'
export { type Query, read, rows } from './read.ts'
export { write } from './write.ts'

// A store, bound to one driver and one vocabulary:
//   ddl      the schema statements the vocabulary implies (to inspect or run)
//   install  run them — create the tables, the doc view, the search index
//   read     a query → the matching entities as whole bundles
//   rows     a query → the compiled statement's raw rows (counts, tallies)
//   write    a batch of bundles patched in → the eids any delete tombstoned
export type Storage = {
  ddl: () => string[]
  install: () => void
  read: (query: Query, opts?: BindOpts) => Bundle[]
  rows: (query: Query, opts?: BindOpts) => Row[]
  write: (bundles: Bundle[]) => string[]
}

// Bind a store to a driver and a vocabulary. `base` options (a derived-column
// registry, a fixed `now` for time phrases) ride every read; a per-call `opts`
// merges over them.
export let storage = (
  driver: Driver,
  vocab: Vocab,
  base: BindOpts = {},
): Storage => ({
  ddl: () => schema(vocab),
  install: () => {
    for (let stmt of schema(vocab)) driver.exec(stmt)
  },
  read: (query, opts) => read(driver, vocab, query, { ...base, ...opts }),
  rows: (query, opts) => rows(driver, vocab, query, { ...base, ...opts }),
  write: (bundles) => write(driver, vocab, bundles),
})
