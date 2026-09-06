/// <reference lib="deno.ns" />
// The defining test: the same script of batches through a graph over D1 and
// through a graph over the reference adapter, with no disagreement anywhere —
// same bundles returned, same batches refused, same entities read back. The
// script lives beside the reference adapter (@yaks/sqlite's parity.ts) because
// agreeing with it is what it means to be a storage adapter.
//
// This is also where the sync pass-through is proved from the other side. The
// same `parity()` returns `void` over two synchronous adapters (see
// @yaks/ram and @yaks/durable-object) and a promise here, because one of the
// two graphs is asynchronous — one apply(), threaded either way.

import { assert } from '@std/assert'
import { isPromise } from '@yaks/graph'
import { parity, rig } from '../sqlite/parity.ts'
import { store as reference } from '../sqlite/harness.ts'
import { store } from './harness.ts'

Deno.test('a d1 graph and a sqlite graph agree, batch for batch', async () => {
  let out = parity(rig(await store()), rig(reference()))
  assert(isPromise(out), 'the script should go async over D1')
  await out
})
