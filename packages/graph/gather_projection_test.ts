import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  gather,
  graph,
  holding,
  pick,
  type Storage,
  then,
  token,
  type Tx,
} from './mod.ts'
import { books, comp, memory } from './harness.ts'

// The optional projection deliberately returns ONLY requested facets, even
// though this test's backing map has whole rows. Count adapter crossings.
let fixture = (async: boolean) => {
  let base = memory()
  let calls: string[] = []
  let answer = <T>(value: T | Promise<T>): T | Promise<T> =>
    async ? Promise.resolve(value) : value
  let wrap = (tx: Tx): Tx => ({
    ...tx,
    get: (eids) => {
      calls.push('whole')
      return answer(tx.get(eids))
    },
    pick: (eids, names) => {
      calls.push('pick')
      return then(
        tx.get(eids),
        (rows) =>
          answer(rows.map((b) =>
            Object.fromEntries(
              Object.entries(b).filter(([k]) =>
                k == 'entity' || k == 'tombstone' || names.includes(k)
              ),
            ) as Bundle
          )),
      )
    },
    patch: (bs) => {
      calls.push('patch')
      return answer(tx.patch(bs))
    },
    remove: (es) => {
      calls.push('remove')
      return answer(tx.remove(es))
    },
  })
  let storage: Storage = {
    ...base,
    tx: (body) => base.tx((tx) => body(wrap(tx))),
  }
  return { base, calls, storage }
}

for (let async of [false, true]) {
  Deno.test(`projected gather: noop checks do not read unrelated facets (${async})`, async () => {
    let { storage, calls } = fixture(async)
    let g = graph({ storage, vocab: books })
    await g.apply([{
      entity: { eid: 'b' },
      doc: { title: 'Book' },
      book: { pages: 4 },
    }])
    let journals: Bundle[][] = []
    g.use({
      name: 'settle',
      beforeWrite: () => (bs, tx) =>
        then(pick(tx, ['b'], ['book']), (held) => {
          assertEquals(comp(held[0], 'book').pages, 4)
          assertEquals(held[0].doc, undefined)
          return bs.filter((b) => comp(b, 'book').pages != 4)
        }),
      hooks: {
        journal: (bs) => {
          journals.push(bs)
          return bs
        },
      },
    })
    calls.length = 0
    assertEquals(
      await g.apply([{ entity: { eid: 'b' }, book: { pages: 4 } }]),
      [],
    )
    assertEquals(calls, ['pick'])
    assertEquals(journals, [[]])
  })

  Deno.test(`projected gather: whole read and precondition writes complete FOUND (${async})`, async () => {
    let { base, storage, calls } = fixture(async)
    await base.tx((tx) =>
      tx.patch([{
        entity: { eid: 'b' },
        doc: { title: 'Before' },
        book: { pages: 4 },
      }])
    )
    await storage.tx(async (tx) => {
      let snap = await gather(tx, books, [{
        eids: ['b'],
        select: ['book', 'tombstone'],
      }])
      let held = holding(tx, books, snap)
      let retained = (await pick(held, ['b'], ['book']))[0]
      assertEquals(retained.doc, undefined)
      // Even a write to a DIFFERENT owner must freeze the original view first.
      await held.patch([{ entity: { eid: 'other' }, doc: { title: 'Other' } }])
      assertEquals(comp(retained, 'doc').title, 'Before')
      assertEquals(calls, ['pick', 'whole', 'patch'])
      await held.patch([{ entity: { eid: 'b' }, doc: { title: 'After' } }])
      assertEquals(comp((await held.get(['b']))[0], 'doc').title, 'After')
      assertEquals(comp(retained, 'doc').title, 'Before')
    })
    calls.length = 0
    await storage.tx(async (tx) => {
      let snap = await gather(tx, books, [{ eids: ['b'], select: ['book'] }, {
        eids: ['b'],
      }])
      assertEquals(comp(snap.got.get('b')!, 'doc').title, 'After')
      assertEquals(calls, ['whole']) // an explicit whole want wins
    })
  })

  Deno.test(`projected gather: ordered stamps, guards and late rollback (${async})`, async () => {
    let { base, storage } = fixture(async)
    let g = graph({ storage, vocab: books })
    let initial = await g.apply([{
      entity: { eid: 'b' },
      doc: { title: 'Before' },
      book: { pages: 4 },
    }])
    let checks: number[] = []
    g.use({
      name: 'ordered',
      beforeWrite: () => (bs, tx) =>
        then(pick(tx, ['b'], ['book']), (held) => {
          checks.push(Number(comp(held[0], 'book').pages))
          if (comp(bs[0], 'book').pages == 9) throw Error('late refusal')
          return bs
        }),
    })
    let changed = await g.apply([{ entity: { eid: 'b' }, book: { pages: 5 } }])
    assertEquals(comp(changed[0], 'created'), {}) // no second birth stamp
    assert(comp(changed[0], 'updated').at)
    await assertRejects(
      async () =>
        await g.apply([
          {
            entity: { eid: 'b' },
            book: { pages: 6 },
            $was: { doc: { title: token('Before') } },
          },
          {
            entity: { eid: 'b' },
            book: { pages: 9 },
            $was: { book: { pages: token(5) } },
          },
        ]),
      Error,
      'late refusal',
    )
    assertEquals(checks, [4, 5, 6])
    let held = (await base.tx((tx) => tx.get(['b'])))[0]
    assertEquals(comp(held, 'book').pages, 5)
    assertEquals(held.created, initial[0].created)
    // Without a $was whole read, the first ordered write itself must finish
    // the projection, and a later refusal must still roll back that prefix.
    await assertRejects(
      async () =>
        await g.apply([
          { entity: { eid: 'b' }, book: { pages: 6 } },
          { entity: { eid: 'b' }, book: { pages: 9 } },
        ]),
      Error,
      'late refusal',
    )
    assertEquals(checks, [4, 5, 6, 5, 6])
    assertEquals(
      comp((await base.tx((tx) => tx.get(['b'])))[0], 'book').pages,
      5,
    )
    await g.apply([{ entity: { eid: 'b' }, tombstone: {} }])
    assertEquals(
      await g.apply([{ entity: { eid: 'b' }, book: { pages: 9 } }]),
      [],
    )
  })

  Deno.test(`projected gather: completing keeps already observed facets (${async})`, async () => {
    let { base, storage } = fixture(async)
    await base.tx((tx) =>
      tx.patch([{
        entity: { eid: 'b' },
        book: { pages: 4 },
        doc: { title: 'Before' },
      }])
    )
    await storage.tx(async (tx) => {
      let snap = await gather(tx, books, [{
        eids: ['b'],
        select: ['book', 'created'],
      }])
      // Model a derived projection that changes between reads. Completion
      // fills only previously unread facets, not values/absence FOUND earlier.
      let held = holding(
        {
          ...tx,
          get: (es) =>
            then(tx.get(es), (bs) =>
              bs.map((b) => ({
                ...b,
                book: { pages: 9 },
                created: { at: 'later' },
              }))),
        },
        books,
        snap,
      )
      let before = (await pick(held, ['b'], ['book']))[0]
      let whole = (await held.get(['b']))[0]
      assertEquals(whole === before, true)
      assertEquals(comp(whole, 'book').pages, 4)
      assertEquals(whole.created, undefined)
      assertEquals(comp(whole, 'doc').title, 'Before')
    })
  })
}
