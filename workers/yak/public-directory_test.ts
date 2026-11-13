// The serving copy's object keeps its ceiling in one row of SQL, through the
// package's driver (whose statements its row ceiling counts).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { durable } from '../../packages/durable-object/testing.ts'
import { PublicDirectoryStore } from './public-directory.ts'
import { LEASE } from './serving-copy.ts'
import type { Env } from './env.ts'

test('a copy keeps its ceiling past its instance', async () => {
  let storage = durable()
  let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
  let made = () => new PublicDirectoryStore(ctx, {} as Env)
  assertEquals(await made().begin(), 1)
  // A new instance stands fenced at the ceiling the last one saved.
  let next = made()
  assertEquals([await next.revision(), await next.read('k')], [1 + LEASE, null])
})
