/// <reference lib="deno.ns" />
// The defining test: the same script of batches through a graph over a Durable
// Object's SQLite and through a graph over the reference adapter, with no
// disagreement anywhere — same bundles returned, same batches refused, same
// entities read back. The script lives beside the reference adapter
// (@yaks/sqlite's parity.ts) because agreeing with it is what it means to be a
// storage adapter.

import { parity, rig } from '../sqlite/parity.ts'
import { store as reference } from '../sqlite/harness.ts'
import { store } from './harness.ts'

Deno.test('a durable-object graph and a sqlite graph agree, batch for batch', () => {
  parity(rig(store()), rig(reference()))
})
