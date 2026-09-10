import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { graph } from './graph.ts'
import { token } from './guard.ts'
import { detached, type Storage } from './storage.ts'
import { then } from './pipe.ts'
import { books, comp, memory, slow } from './harness.ts'
import type { Bundle } from './bundle.ts'

for (let async of [false, true]) {
  for (let veto of [false, true]) {
    Deno.test(`beforeWrite: independent batches require unanimous guards (${async}, ${veto})`, async () => {
      let base = memory()
      let writes: number[] = [], seen: number[] = [], journal: Bundle[] = []
      let counted: Storage = {
        ...base,
        tx: (body) =>
          base.tx((tx) =>
            body({
              ...tx,
              patch: (bs) => {
                let docs = bs.filter((b) => b.doc)
                if (docs.length) writes.push(docs.length)
                return tx.patch(bs)
              },
            })
          ),
      }
      let g = graph({ storage: async ? slow(counted) : counted, vocab: books })
      await g.apply([{ entity: { eid: 'dead' }, doc: { title: 'gone' } }])
      await g.apply([{ entity: { eid: 'dead' }, tombstone: {} }])
      writes.length = 0
      g.use({
        name: 'independent',
        beforeWrite: () =>
          Object.assign((bs: Bundle[]) => {
            seen.push(bs.length)
            return bs.map((b) => ({ ...b, doc: { title: 'rewritten' } }))
          }, { independent: true }),
        hooks: {
          journal: (bs) => {
            journal = bs
            return bs
          },
        },
      })
      if (veto) g.use({ name: 'ordered', beforeWrite: () => (bs) => bs })
      let out = g.apply(['a', 'dead', 'b'].map((eid) => ({
        entity: { eid },
        doc: { title: 'input' },
      })))
      assertEquals(out instanceof Promise, async)
      let answer = await out
      assertEquals(seen, veto ? [1, 1] : [2])
      assertEquals(writes, veto ? [1, 1] : [2])
      assertEquals(journal.filter((b) => b.doc).map((b) => b.entity.eid), [
        'a',
        'b',
      ])
      for (let eid of ['a', 'b']) {
        assertEquals(
          comp(answer.find((b) => b.entity.eid == eid), 'doc').title,
          'rewritten',
        )
      }
    })
  }

  Deno.test(`beforeWrite: one ordered mutation, FOUND guards, final answer (${async})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let seen: unknown[] = [], journal: unknown[] = []
    let g = graph({ storage, vocab: books })
    await g.apply([{ entity: { eid: 'b' }, book: { pages: 1 } }])
    g.use({
      name: 'ordered',
      beforeWrite: (all) => {
        assertEquals(all.length, 4)
        return (bs, tx) =>
          then(tx.get(['b']), (found) => {
            seen.push(comp(found[0], 'book').pages)
            return bs
          })
      },
      hooks: {
        journal: (bs) => {
          journal = bs.filter((b) => 'book' in b).map((b) => b.book)
          return bs
        },
      },
    })
    let batch: Bundle[] = [2, 3, null, 4].map((pages) => ({
      entity: { eid: 'b' },
      book: pages == null ? null : { pages },
      $was: { book: { pages: token(1) } },
    }))
    let out = g.apply(batch)
    assertEquals(out instanceof Promise, async)
    assertEquals(comp((await out)[0], 'book'), { pages: 4 })
    assertEquals(seen, [1, 2, 3, undefined])
    assertEquals(journal, [{ pages: 2 }, { pages: 3 }, null, { pages: 4 }])
  })

  Deno.test(`beforeWrite: death, releases and detaches precede the next check (${async})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let g = graph({ storage, vocab: books })
    await g.apply([
      { entity: { eid: 'p' }, doc: { title: 'publisher' } },
      { entity: { eid: 'b' }, book: { publisher: 'p' } },
      { entity: { eid: 'r' }, review: { book: 'b' } },
      { entity: { eid: 'm' }, bookmark: { of: 'p' } },
    ])
    let calls = 0
    g.use({
      name: 'prefix',
      beforeWrite: () => (bs, tx) =>
        then(tx.get(['b', 'm']), (found) => {
          if (calls++ == 1) {
            assertEquals(comp(found[0], 'book').publisher, null)
            assertEquals(found[1].bookmark, undefined)
          }
          return bs
        }),
    })
    let out = await g.apply([
      { entity: { eid: 'p' }, tombstone: {} },
      { entity: { eid: 'b' }, tombstone: {} },
      { entity: { eid: 'r' }, review: { stars: 4 } }, // already a casualty
    ])
    assertEquals(calls, 2)
    assertEquals(out.find((b) => b.entity.eid == 'r'), {
      entity: { eid: 'r' },
      tombstone: {},
    })
    assertEquals(comp(out.find((b) => b.entity.eid == 'm'), 'bookmark'), {})
  })

  Deno.test(`beforeWrite: a late refusal rolls back prefix and suppresses effects (${async})`, async () => {
    let storage = async ? slow(memory()) : memory()
    let effects = 0
    let g = graph({
      storage,
      vocab: books,
      plugins: [{
        name: 'refuse',
        beforeWrite: () => (bs) => {
          if (bs[0].book) throw new Error('late')
          return bs
        },
        hooks: {
          effect: (bs) => {
            effects++
            return bs
          },
        },
      }],
    })
    let batch = [
      { entity: { eid: 'b' }, doc: { title: 'prefix' } },
      { entity: { eid: 'b' }, book: { pages: 3 } },
    ]
    if (async) {
      await assertRejects(
        async () => {
          await g.apply(batch)
        },
        Error,
        'late',
      )
    } else assertThrows(() => g.apply(batch), Error, 'late')
    assertEquals(await detached(storage).get(['b']), [])
    assertEquals(effects, 0)
  })
}

Deno.test('a host may defer effects; its clock is frozen before context leaves', () => {
  let queued: (() => void | Promise<void>)[] = []
  let clocks = 0, observations = 0, active = true
  let g = graph({
    storage: memory(),
    vocab: books,
    clock: () => {
      assert(active)
      clocks++
      return '2026-09-10T00:00:00Z'
    },
    deferEffects: (run) => queued.push(run),
    plugins: [{
      name: 'observer',
      hooks: {
        effect: (bs) => {
          observations++
          assert(!active)
          return bs
        },
      },
    }],
  })
  let batch = [{ entity: { eid: 'a' }, book: {} }]
  let out = g.apply(batch)
  assert(!(out instanceof Promise))
  assertEquals(comp(out[0], 'created').at, '2026-09-10T00:00:00Z')
  assertEquals([clocks, observations, queued.length], [1, 0, 1])
  active = false
  queued.pop()!()
  assertEquals(observations, 1)
  g.apply(batch, { now: 'fixed', check: true })
  assertEquals(queued.length, 0)
})
