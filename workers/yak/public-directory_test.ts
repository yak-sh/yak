// The serving copy's object keeps its ceiling in one row of SQL, through the
// package's driver (whose statements its row ceiling counts).
import { clock, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { durable } from '../../packages/durable-object/testing.ts'
import { PublicDirectoryStore } from './public-directory.ts'
import { LEASE } from '@yaks/platform/serving-copy'
import { REGIONAL_LEASE_MS } from '@yaks/platform/regional-serving-copy'

test('a copy keeps its ceiling past its instance', async () => {
  let storage = durable()
  let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
  let made = () => new PublicDirectoryStore(ctx, {})
  assertEquals(await made().begin(), 1)
  // A new instance stands fenced at the ceiling the last one saved.
  let next = made()
  assertEquals([await next.revision(), await next.read('k')], [1 + LEASE, null])
})

test('a regional route and its invalidation survive eviction', async () => {
  let time = clock()
  let storage = durable()
  let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
  let made = () => new PublicDirectoryStore(ctx, { CLOCK: time })
  let lease = { epoch: 0, revision: 1, until: time.now() + REGIONAL_LEASE_MS }
  assertEquals(await made().regionalPublish(lease, 'page', 'public'), true)
  await time.advance(22_000)
  assertEquals(await made().regionalRead('page'), { ...lease, body: 'public' })
  await made().regionalInvalidate(1)
  let restarted = made()
  assertEquals(await restarted.regionalPublish(lease, 'page', 'public'), false)
  assertEquals(await restarted.regionalRead('page'), null)
})
