/// <reference lib="deno.ns" />
// The defining test: one script of batches, two storages, no disagreement.
//
// The script lives beside the reference adapter (@yaks/sqlite's parity.ts),
// because agreeing with the database is what it means to be a storage adapter.
// Both sides run @yaks/graph's own `apply()` over the same shop vocabulary —
// one storing rows in an in-memory SQLite database, the other storing bundles
// in this package's Map — and must return the same bundles, refuse the same
// batches, and read back the same entities, batch for batch.

import { answers, parity, rig } from '../sqlite/parity.ts'
import { shop, store } from '../sqlite/testing.ts'
import { ram } from './mod.ts'

let mine = () => rig(ram(shop, { number: true }))

Deno.test('a ram graph and a sqlite graph agree, batch for batch', () => {
  parity(mine(), rig(store()))
})

Deno.test('a ram graph selects what each query means', () => answers(mine()))
