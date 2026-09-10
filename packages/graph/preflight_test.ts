import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import { detached } from './storage.ts'
import { preflight } from './preflight.ts'
import { then } from './pipe.ts'
import { books, comp, memory, slow } from './harness.ts'
import type { Bundle } from './bundle.ts'

for (let async of [false, true]) {
  Deno.test(`preflight sees ordered prefix and rolls back rehearsal (${async ? 'async' : 'sync'})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let seen: unknown[] = []
    let check = preflight(
      storage,
      books,
      (bs, tx) =>
        then(tx.get(['b']), (found) => {
          seen.push(comp(found[0], 'book').pages)
          return bs
        }),
    )
    let batch = [
      { entity: { eid: 'b' }, book: { pages: 1 } },
      { entity: { eid: 'b' }, book: { pages: 2 } },
      { entity: { eid: 'b' }, book: null },
      { entity: { eid: 'b' }, book: { pages: 3 } },
    ]
    assertEquals(await check(batch, detached(storage)), batch)
    assertEquals(seen, [undefined, 1, 2, undefined])
    assertEquals(await detached(storage).get(['b']), [])
    let effects = 0
    let g = graph({
      storage,
      vocab: books,
      plugins: [{
        name: 'ordered',
        hooks: {
          precondition: check,
          effect: (bs) => {
            effects++
            return bs
          },
        },
      }],
    })
    await g.apply(batch)
    assertEquals(comp((await detached(storage).get(['b']))[0], 'book').pages, 3)
    assertEquals(effects, 1)
  })

  Deno.test(`preflight refusal rolls back prefix, late tombstone writes are void (${async ? 'async' : 'sync'})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let calls = 0
    let check = preflight(storage, books, (bs) => {
      calls++
      if (bs[0].book) throw new Error('refused')
      return bs
    })
    let batch: Bundle[] = [
      { entity: { eid: 'b' }, doc: { title: 'prefix' } },
      { entity: { eid: 'b' }, book: { pages: 3 } },
    ]
    if (async) {
      await assertRejects(
        async () => {
          await check(batch, detached(storage))
        },
        Error,
        'refused',
      )
    } else assertThrows(() => check(batch, detached(storage)), Error, 'refused')
    assertEquals(await detached(storage).get(['b']), [])
    calls = 0
    await check(
      [batch[0], { entity: { eid: 'b' }, tombstone: {} }, batch[1]],
      detached(storage),
    )
    assertEquals(calls, 2)
    assertEquals(await detached(storage).get(['b']), [])
  })
}
