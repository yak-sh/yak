import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { after } from '@yaks/fp'
import { graph } from './graph.ts'
import { detached } from './storage.ts'
import { preflight } from './preflight.ts'
import { books, comp, memory, slow } from './testing.ts'
import type { Bundle } from './bundle.ts'

for (let async of [false, true]) {
  let mode = async ? 'async' : 'sync'
  // A preflight check over its own storage, recording the pages each
  // operation in a batch saw held before it.
  let rehearsing = () => {
    let storage = async ? slow(memory()) : memory()
    let seen: unknown[] = []
    let check = preflight(
      storage,
      books,
      (bs, tx) =>
        after(tx.get(['b']), (found) => {
          seen.push(comp(found[0], 'book').pages)
          return bs
        }),
    )
    return { storage, seen, check }
  }
  let bundles = [
    { entity: { eid: 'b' }, book: { pages: 1 }, doc: { title: 'keep' } },
    { entity: { eid: 'b' }, book: { pages: 2 } },
    { entity: { eid: 'b' }, book: null },
    { entity: { eid: 'b' }, book: { pages: 3 } },
  ]

  let alone = rehearsing()
  test(`preflight sees ordered prefix and rolls back rehearsal (${mode})`, async () => {
    let { storage, seen, check } = alone
    assertEquals(await check(bundles, detached(storage)), bundles)
    assertEquals(seen, [undefined, 1, 2, undefined])
    assertEquals(await storage.get(['b']), [])
  })

  let guarding = rehearsing()
  let effects = 0
  let g = graph({
    storage: guarding.storage,
    vocab: books,
    plugins: [{
      name: 'ordered',
      hooks: {
        precondition: guarding.check,
        effect: (bs) => {
          effects++
          return bs
        },
      },
    }],
  })
  test(`a preflight precondition lets the batch write its final state (${mode})`, async () => {
    await g.apply(bundles)
    assertEquals(comp((await guarding.storage.get(['b']))[0], 'book').pages, 3)
    assertEquals(effects, 1)
  })

  test(`preflight refusal rolls back prefix, late tombstone writes are void (${async ? 'async' : 'sync'})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let calls = 0
    let check = preflight(storage, books, (bs) => {
      calls++
      if (bs[0].book) throw new Error('refused')
      return bs
    })
    let bundles: Bundle[] = [
      { entity: { eid: 'b' }, doc: { title: 'prefix' } },
      { entity: { eid: 'b' }, book: { pages: 3 } },
    ]
    if (async) {
      await assertRejects(
        async () => {
          await check(bundles, detached(storage))
        },
        Error,
        'refused',
      )
    } else {assertThrows(
        () => check(bundles, detached(storage)),
        Error,
        'refused',
      )}
    assertEquals(await storage.get(['b']), [])
    calls = 0
    await check(
      [bundles[0], { entity: { eid: 'b' }, tombstone: {} }, bundles[1]],
      detached(storage),
    )
    assertEquals(calls, 2)
    assertEquals(await storage.get(['b']), [])
  })
}
