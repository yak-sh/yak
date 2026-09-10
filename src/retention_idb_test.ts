import 'npm:fake-indexeddb@6/auto'
import { assertEquals } from '@std/assert'
import { hydrate, retain } from './idb.ts'
import type { Comps } from './live.ts'

Deno.test('disk retention bounds checkpoints, accepts same-cursor confirmations, and resets epochs', async () => {
  let row = (eid: string): Comps => ({
    entity: { eid, num: 1 },
    doc: { eid, title: eid },
  })
  let stamp = { epoch: 'retention-A', cursor: 1, vocabHash: 'v' }
  let rows = { a: row('a'), b: row('b'), c: row('c') }
  assertEquals(await retain(['a', 'b'], rows, stamp, true, 2), true)
  assertEquals(await retain(['a', 'c'], rows, stamp, false, 2), true)
  let saved = await hydrate(2)
  assertEquals(Object.keys(saved.ents), ['a', 'c'])
  assertEquals(saved.meta.scope, 'retention')
  assertEquals(saved.meta.epoch, stamp.epoch)
  // An authoritative absence removes the disk row at the same cursor, too.
  assertEquals(await retain(['a'], {}, stamp, false, 2), true)
  assertEquals(Object.keys((await hydrate()).ents), ['c'])
  assertEquals(await retain(['b'], rows, { ...stamp, cursor: 0 }), false)
  assertEquals(
    await retain(
      ['b'],
      rows,
      { ...stamp, epoch: 'retention-B', cursor: 0 },
      true,
      2,
    ),
    true,
  )
  saved = await hydrate(2)
  assertEquals(Object.keys(saved.ents), ['b'])
  assertEquals(saved.meta.epoch, 'retention-B')
})
