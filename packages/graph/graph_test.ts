// A whole `apply()`, over the Map adapter: what lands, what dies with it, what
// is stamped, what a hook can do at each phase, and — running the same batches
// over the asynchronous wrapper — that none of it depends on being
// synchronous.

import { test } from '@yaks/testing'
import { record } from '@yaks/trace'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { isPromise } from '@yaks/fp'
import { Checked, graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { Stale, token } from './guard.ts'
import { Refused } from './admit.ts'
import { books, comp, isDead, memory, slow } from './testing.ts'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { match } from './join.ts'

let g = (plugins: Plugin[] = []) =>
  graph({ storage: memory(), vocab: books, plugins })

// Every test's apply is synchronous over the Map adapter — the assertion is
// part of the test, not a convenience.
let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  assert(!isPromise(out), 'apply() went async over a synchronous storage')
  return out
}

let at = (out: Bundle[], eid: string, name: string) =>
  comp(out.find((b) => b.entity.eid == eid && b[name] !== undefined), name)

for (let async of [false, true]) {
  for (let again of [false, true]) {
    test(`deleting a never-existing eid${again ? ' again' : ''} writes and returns nothing (${async ? 'async' : 'sync'})`, async () => {
      let journaled: Bundle[] = []
      let storage = ram(books)
      let one = graph({
        vocab: books,
        storage: async ? slow(storage) : storage,
        plugins: [{
          name: 'journal',
          hooks: {
            journal: (bs) => (journaled.push(...bs), bs),
          },
        }],
      })
      let deletion = [{ entity: { eid: 'missing' }, $delete: true }]
      if (again) await one.apply(deletion)
      assertEquals(await one.apply(deletion), [])
      assertEquals(await one.get(['missing']), [])
      assertEquals(journaled, [])
    })
  }
  for (let ordered of [false, true]) {
    test(`missing deletes preserve writes in the same batch (${async ? 'async' : 'sync'}, ${ordered ? 'ordered' : 'bulk'})`, async () => {
      let storage = ram(books)
      let one = graph({
        vocab: books,
        storage: async ? slow(storage) : storage,
        plugins: ordered
          ? [{ name: 'ordered', beforeWrite: () => (bs) => bs }]
          : [],
      })
      let out = await one.apply([
        { entity: { eid: 'first' }, book: { pages: 1 } },
        { entity: { eid: 'first' }, $delete: true },
        { entity: { eid: 'later' }, $delete: true },
        { entity: { eid: 'later' }, book: { pages: 2 } },
        { entity: { eid: 'missing' }, $delete: true },
        { entity: { eid: 'other' }, book: { pages: 3 } },
      ])
      assertEquals(out.map((b) => b.entity.eid), ['first', 'later', 'other'])
      assertEquals((await one.get(['first']))[0].tombstone, {})
      assertEquals((await one.get(['later']))[0].book, { pages: 2 })
      assertEquals((await one.get(['other']))[0].book, { pages: 3 })
      assertEquals(await one.get(['missing']), [])
    })
  }
}

test('outside reads whole committed state and evaluates bindings after each write', async () => {
  let one = graph({ storage: ram(books), vocab: books })
  let tx = one.outside
  one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 7 },
    doc: { title: 'Seven' },
  }])
  let [found] = await tx.read('.book.pages=7')
  assertEquals(found.doc, { title: 'Seven' })
  assertEquals(at(await tx.get(['b1'], ['book']), 'b1', 'book').pages, 7)
  one.apply([{ entity: { eid: 'b1' }, book: { pages: 8 } }], { check: true })
  assertEquals(at(await tx.get(['b1']), 'b1', 'book').pages, 7)
  one.apply([{ entity: { eid: 'b1' }, book: { pages: 9 } }])
  assertEquals(at(await tx.get(['b1']), 'b1', 'book').pages, 9)
  let [rows] = await tx.bindings!([match('.book.pages=$pages')], [], ['book'])
  assertEquals(rows.map((r) => r.vars), [{ pages: 9 }])
})

test('a traced dry run reports phases and leaves the graph unchanged', () => {
  let one = g()
  let captured = record(one, () =>
    one.apply([
      { entity: { eid: 'b1' }, book: { pages: 7 } },
    ], { check: true }))
  assert(!isPromise(captured))
  let out = sync(captured.result)
  let phases = captured.spans.filter((span) => span.kind == 'phase')
  assert(phases.every((span) => span.duration! >= 0))
  let names = phases.map((span) => span.name)
  assertEquals(at(out, 'b1', 'book').pages, 7)
  assertEquals(one.get(['b1']), [])
  assert(names.includes('gather'))
  assert(names.includes('mutate'))
  assert(names.includes('transaction'))
  assert(names.includes('compose'))
})

for (let async of [false, true]) {
  test(`failed effect snapshots log at error level (${async ? 'async' : 'sync'})`, async () => {
    let storage = memory()
    let committed = false
    let error = new Error('too many terms in compound SELECT')
    let observed: string[] = []
    let one = graph({
      vocab: books,
      // Every read after the commit fails, whichever door it takes.
      storage: {
        ...storage,
        get: (eids) => {
          if (committed) {
            if (async) return Promise.reject(error)
            throw error
          }
          return storage.get(eids)
        },
        tx: (body) => {
          if (committed) {
            if (async) return Promise.reject(error)
            throw error
          }
          return storage.tx(body)
        },
      },
      plugins: [{
        name: 'shelf',
        rules: [{
          phase: 'effect',
          match: '*book',
          run: () => {
            observed.push('rule')
          },
        }],
        hooks: {
          commit: (b) => (committed = true, b),
          effect: (b) => (observed.push('hook'), b),
        },
      }],
    })
    using logged = stub(console, 'error')
    let out = await one.apply([{
      entity: { eid: 'b1' },
      book: { pages: 412 },
    }])
    assertEquals(logged.calls.map((c) => c.args), [
      ['graph failed at effect —', error],
    ])
    assertEquals(observed, ['hook'])
    assertEquals(at(out, 'b1', 'book').pages, 412)
    let stored = await storage.tx((tx) => tx.get(['b1']))
    assertEquals(at(stored, 'b1', 'book').pages, 412)
  })
}

test('failed effect hooks log their plugin and do not undo committed writes', async () => {
  let error = new Error('observer failed')
  let one = g([{
    name: 'shelf',
    hooks: { effect: () => Promise.reject(error) },
  }])
  using logged = stub(console, 'error')
  let out = await one.apply([{ entity: { eid: 'b1' }, book: { pages: 412 } }])
  assertEquals(at(out, 'b1', 'book').pages, 412)
  assertEquals(logged.calls.map((c) => c.args), [
    ['shelf failed at effect —', error],
  ])
})

test('a batch lands, and the return carries the births', () => {
  let one = g()
  let out = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ]))
  let born = out.find((b) => b.entity.num != null)!
  assertEquals(born.entity.eid, 'b1')
  assertEquals(typeof born.entity.num, 'number')
  let [stored] = one.get(['b1']) as Bundle[]
  assertEquals(comp(stored, 'doc').title, 'Dune')
  assertEquals(comp(stored, 'book').pages, 412)
})

test('a write naming a component the graph does not declare lands nothing', () => {
  let one = g()
  assertThrows(
    () =>
      one.apply([
        { entity: { eid: 'b1' }, doc: { title: 'Dune' }, audiobook: {} },
      ]),
    Refused,
    'unknown component: audiobook',
  )
  assertEquals(one.get(['b1']), [])
})

test('a bundle that names no entity is refused by its place, and lands nothing', () => {
  let one = g()
  for (let bad of [{ doc: { title: 'Dune' } }, { entity: {} }, null]) {
    assertThrows(
      () =>
        one.apply([
          { entity: { eid: 'b1' }, doc: { title: 'Dune' } },
          bad as unknown as Bundle,
        ]),
      Refused,
      'bundle 1 needs an entity',
    )
  }
  assertEquals(one.get(['b1']), [])
})

test('a replica lands what it declares and leaves the rest out', () => {
  let one = g()
  sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, audiobook: {} },
    { entity: { eid: 'b2' }, audiobook: {} },
  ], { trusted: true, replica: true }))
  let [b1] = one.get(['b1']) as Bundle[]
  assertEquals(comp(b1, 'doc').title, 'Dune')
  assertEquals(b1.audiobook, undefined)
  assertEquals(one.get(['b2']), [])
})

for (
  let [name, patch] of Object.entries({
    'unresolved word ref': { book: { publisher: 'forgotten-publisher' } },
    'retired enum value': { book: { status: 'shipped' } },
  })
) {
  test(`accepted replica data skips write admission: ${name}`, () => {
    let row = { entity: { eid: 'b1' }, ...patch }
    for (let opts of [{}, { trusted: true }, { replica: true }]) {
      let one = graph({ storage: ram(books), vocab: books })
      assertThrows(() => one.apply([row], opts), Refused)
      assertEquals(one.get(['b1']), [])
    }
    let one = graph({ storage: ram(books), vocab: books })
    sync(one.apply([row], { trusted: true, replica: true }))
    assertEquals(comp((one.get(['b1']) as Bundle[])[0], 'book'), patch.book)
  })
}

test('a replica does not rerun a plugin’s write admission', () => {
  let one = g([{
    name: 'write-policy',
    hooks: {
      admit: () => {
        throw new Refused('write closed')
      },
    },
  }])
  let row = { entity: { eid: 'b1' }, doc: { title: 'Dune' } }
  assertThrows(() => one.apply([row]), Refused, 'write closed')
  sync(one.apply([row], { trusted: true, replica: true }))
  assertEquals(comp((one.get(['b1']) as Bundle[])[0], 'doc'), row.doc)
})

test('the answer is one bundle per entity, and no pipeline key', () => {
  let one = g()
  // A write: the caller's patch, the stamp and the birth are one bundle, and
  // the `$actor` that made the stamp does not leave apply() (T-34294).
  let wrote = sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    book: { pages: 412 },
    $actor: { by: 'ada' },
  }], { now: '2026-01-01T00:00:00.000Z' }))
  assertEquals(wrote.length, 1)
  assertEquals(wrote[0], {
    entity: { eid: 'b1', num: 1 },
    doc: { title: 'Dune' },
    book: { pages: 412 },
    created: { at: '2026-01-01T00:00:00.000Z', by: 'ada' },
  })
  // A mint keeps the word the caller named it by, and nothing else.
  let [minted] = sync(one.apply([{
    entity: { eid: '$new' },
    doc: { title: 'Emma' },
    $actor: { by: 'ada' },
  }]))
  assertEquals(minted.$alias, '$new')
  assert(minted.entity.eid != '$new' && minted.entity.num != null)
  assertEquals(comp(minted, 'doc').title, 'Emma')
  // A delete answers as the tombstone alone: `$delete` is the pipeline's word
  // for it, and a dead entity's components are a ghost.
  let died = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'too late' }, $delete: true },
  ]))
  assertEquals(died, [{ entity: { eid: 'b1' }, tombstone: {} }])
})

test('an event is applied and carried, and never stored', () => {
  let vocab = loadVocab([...books.docs, {
    $defs: {
      Browsed: {
        component: true,
        type: 'object',
        sync: 'none',
        durable: '0s',
        properties: { by: { type: 'string' } },
      },
    },
  }])
  let one = graph({ storage: memory(), vocab })
  let out = sync(one.apply([
    { entity: { eid: 'b1' }, book: { pages: 7 }, Browsed: { by: 'ann' } },
    { entity: { eid: 'b2' }, Browsed: { by: 'bo' } },
  ]))
  assertEquals(at(out, 'b1', 'Browsed'), { by: 'ann' })
  assertEquals(at(out, 'b2', 'Browsed'), { by: 'bo' })
  assertEquals(sync(one.get(['b1', 'b2'])).map((b) => Object.keys(b)), [[
    'entity',
    'book',
    'created',
  ]])
})

test('a patch touches only the properties it names; null clears one', () => {
  let one = g()
  sync(one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 412, status: 'stocked' },
  }]))
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }]))
  let [b] = one.get(['b1']) as Bundle[]
  assertEquals(comp(b, 'book'), { pages: 500, status: 'stocked' })
  sync(one.apply([{ entity: { eid: 'b1' }, book: { status: null } }]))
  let [c] = one.get(['b1']) as Bundle[]
  assertEquals(comp(c, 'book').status, null)
})

test('a null component drops the row, the entity survives', () => {
  let one = g()
  sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    book: { pages: 412 },
  }]))
  sync(one.apply([{ entity: { eid: 'b1' }, book: null }]))
  let [b] = one.get(['b1']) as Bundle[]
  assertEquals(b.book, undefined)
  assertEquals(comp(b, 'doc').title, 'Dune')
})

test('births are stamped created, later touches updated', () => {
  let one = g()
  let born = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, $actor: { by: 'me' } },
  ], { now: '2026-01-01T00:00:00.000Z' }))
  assertEquals(at(born, 'b1', 'created'), {
    at: '2026-01-01T00:00:00.000Z',
    by: 'me',
  })
  assertEquals(born.find((b) => b.updated), undefined)
  let again = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune II' }, $actor: { by: 'you' } },
  ], { now: '2026-01-02T00:00:00.000Z' }))
  assertEquals(at(again, 'b1', 'updated'), {
    at: '2026-01-02T00:00:00.000Z',
    by: 'you',
  })
  assertEquals(again.find((b) => b.created), undefined)
})

for (let async of [false, true]) {
  test(`trusted metadata corrections preserve provenance (${async ? 'async' : 'sync'})`, async () => {
    let vocab = loadVocab([...books.docs, {
      $defs: Object.fromEntries(['created', 'updated'].map((name) => [name, {
        component: true,
        extends: true,
        properties: {
          via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
        },
      }])),
    }])
    let storage = memory()
    let one = graph({ storage: async ? slow(storage) : storage, vocab })
    await one.apply(
      ['ada', 'visitor'].map((eid) => ({
        entity: { eid },
        doc: { title: eid },
      })),
    )
    let created = '2026-01-01T00:00:00.000Z'
    let updated = '2026-01-02T00:00:00.000Z'
    await one.apply(
      ['birth', 'edit'].map((eid) => ({
        entity: { eid },
        doc: { title: eid },
        $actor: { via: 'visitor' },
      })),
      { now: created },
    )
    await one.apply([{
      entity: { eid: 'edit' },
      doc: { title: 'revised' },
      $actor: { via: 'visitor' },
    }], { now: updated })
    await one.apply([
      { entity: { eid: 'birth' }, created: { by: 'ada' } },
      {
        entity: { eid: 'edit' },
        created: { by: 'ada' },
        updated: { by: 'ada' },
      },
    ], { trusted: true, stamp: false })
    let rows = await one.get(['birth', 'edit'])
    for (let row of rows) {
      assertEquals(row.created, { at: created, by: 'ada', via: 'visitor' })
    }
    assertEquals(rows[0].updated, undefined)
    assertEquals(rows[1].updated, { at: updated, by: 'ada', via: 'visitor' })
    // The next ordinary write still records its writer and time.
    let out = await one.apply([{
      entity: { eid: 'birth' },
      doc: { title: 'signed in' },
      $actor: { by: 'ada', via: 'visitor' },
    }], { now: updated })
    assertEquals(at(out, 'birth', 'updated'), {
      at: updated,
      by: 'ada',
      via: 'visitor',
    })
  })
}

test('an unstamped correction still derives, journals and observes committed data', () => {
  let seen: string[] = []
  let one = g([{
    name: 'watcher',
    rules: [{
      name: 'shelf',
      phase: 'stamp',
      match: '.book, *book',
      run: () => ({ book: { shelved: true } }),
    }],
    hooks: {
      stamp: (b) => (seen.push('stamp'), b),
      journal: (b) => (seen.push('journal'), b),
      effect: (b, tx) => {
        let [held] = tx.get(['b1']) as Bundle[]
        assertEquals(held.book, { pages: 7, shelved: true })
        seen.push('effect')
        return b
      },
    },
  }])
  let out = sync(one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 7 },
    sold: {},
  }], { trusted: true, stamp: false }))
  assertEquals(seen, ['stamp', 'journal', 'effect'])
  assertEquals(at(out, 'b1', 'book'), { pages: 7, shelved: true })
  assertEquals(at(out, 'b1', 'sold'), {})
  assertEquals(out[0].created, undefined)
  assertEquals(out[0].updated, undefined)
})

test('unstamped corrections require trust and still validate and guard writes', () => {
  let one = g()
  let bundles = [{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]
  assertThrows(() => one.apply(bundles, { stamp: false }), Refused)
  assertEquals(one.get(['b1']), [])
  sync(one.apply(bundles))
  assertThrows(
    () =>
      one.apply([{ entity: { eid: 'b1' }, undeclared: {} }], {
        trusted: true,
        stamp: false,
      }),
    Refused,
  )
  assertThrows(
    () =>
      one.apply([{
        ...bundles[0],
        $was: { doc: { title: token('Emma') } },
      }], { trusted: true, stamp: false }),
    Stale,
  )
  assertEquals((one.get(['b1']) as Bundle[])[0].updated, undefined)
})

test("a batch nobody signed is the graph's own, and a signed one is not", () => {
  let one = graph({
    storage: memory(),
    vocab: books,
    actor: { by: 'shop', via: 'shop' },
  })
  // Nobody at a door: an effect, a boot pass, a load poured in.
  let own = sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  assertEquals(at(own, 'b1', 'created').by, 'shop')
  // And a door that named somebody has the last word.
  let hers = sync(one.apply([{
    entity: { eid: 'b2' },
    doc: { title: 'Dune II' },
    $actor: { by: 'ada' },
  }]))
  assertEquals(at(hers, 'b2', 'created').by, 'ada')
})

test("each entity is its own bundle's writer's, and the rest the batch's", () => {
  let out = sync(
    g().apply([
      { entity: { eid: 'b1' }, doc: { title: 'Dune' }, $actor: { by: 'ada' } },
      { entity: { eid: 'b2' }, sold: {}, $actor: { by: 'till' } },
      { entity: { eid: 'b3' }, doc: { title: 'Emma' } },
    ]),
  )
  assertEquals(
    ['b1', 'b2', 'b3'].map((eid) => at(out, eid, 'created').by),
    ['ada', 'till', 'ada'],
  )
  assertEquals(at(out, 'b2', 'sold').by, 'till')
})

test('a mark is signed where it lands, and the first telling stands', () => {
  let one = g()
  let out = sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    sold: {},
    $actor: { by: 'me', via: 'till' },
  }], { now: '2026-01-01T00:00:00.000Z' }))
  assertEquals(at(out, 'b1', 'sold'), {
    at: '2026-01-01T00:00:00.000Z',
    by: 'me',
    via: 'till',
  })
  // Said again, by somebody else, a day later: a mark is not a touch.
  sync(one.apply([{
    entity: { eid: 'b1' },
    sold: {},
    $actor: { by: 'you', via: 'post' },
  }], { now: '2026-01-02T00:00:00.000Z' }))
  let [held] = one.get(['b1']) as Bundle[]
  assertEquals(comp(held, 'sold'), {
    at: '2026-01-01T00:00:00.000Z',
    by: 'me',
    via: 'till',
  })
})

test('$was guards a property, and a moved value refuses the whole batch', () => {
  let one = g()
  sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  // the value the caller read still holds
  sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune II' },
    $was: { doc: { title: token('Dune') } },
  }]))
  // ... and now it has moved
  let e = assertThrows(
    () =>
      sync(one.apply([
        { entity: { eid: 'b2' }, doc: { title: 'Emma' } },
        {
          entity: { eid: 'b1' },
          doc: { title: 'Dune III' },
          $was: { doc: { title: token('Dune') } },
        },
      ])),
    Stale,
  ) as Stale
  assertEquals(e.current, 'Dune II')
  // refused whole: the other bundle in the batch did not land either
  assertEquals(one.get(['b2']), [])
})

test('a guard on an absent value is null, and on an unknown property refuses', () => {
  let one = g()
  sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    $was: { doc: { title: null } },
  }]))
  assertThrows(
    () =>
      sync(one.apply([{
        entity: { eid: 'b1' },
        doc: { title: 'x' },
        $was: { doc: { titel: null } },
      }])),
    Refused,
    'doc.titel',
  )
})

test('a delete tombstones the entity and death spreads by the vocabulary', () => {
  let one = g()
  sync(one.apply([
    { entity: { eid: 'p1' }, doc: { title: 'Chilton' } },
    { entity: { eid: 'b1' }, book: { pages: 412, publisher: 'p1' } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
    { entity: { eid: 'u1' }, bookmark: { of: 'b1' } },
  ]))
  let out = sync(one.apply([{ entity: { eid: 'b1' }, $delete: true }]))
  // the review cascaded, and the batch says so
  let casualty = out.find((b) => b.entity.eid == 'r1')!
  assert(isDead(casualty))
  // Releasing its only component deletes the bookmark's empty owner too.
  assert(isDead(out.find((b) => b.entity.eid == 'u1')!))
  let [u] = one.get(['u1']) as Bundle[]
  assert(isDead(u))
  // the dead are dead
  let dead = one.get(['b1', 'r1']) as Bundle[]
  assertEquals(dead.filter(isDead).length, 2)
})

test('a detach reference is nulled and the survivor hears it', () => {
  let one = g()
  sync(one.apply([
    { entity: { eid: 'p1' }, doc: { title: 'Chilton' } },
    { entity: { eid: 'b1' }, book: { pages: 412, publisher: 'p1' } },
  ]))
  let out = sync(one.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  assertEquals(at(out, 'b1', 'book'), { publisher: null })
  let [b] = one.get(['b1']) as Bundle[]
  assertEquals(comp(b, 'book').publisher, null)
  assertEquals(comp(b, 'book').pages, 412) // the book itself is untouched
})

test('a patch after its own delete in one batch is dropped', () => {
  let one = g()
  sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  sync(one.apply([
    { entity: { eid: 'b1' }, $delete: true },
    { entity: { eid: 'b1' }, doc: { title: 'back from the dead' } },
  ]))
  let [b] = one.get(['b1']) as Bundle[]
  assert(isDead(b))
})

// Three writes reach one tombstone: the entity was `Dune`, with pages, and
// then deleted.
let buried = () => {
  let one = g()
  let [born] = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ]))
  sync(one.apply([{ entity: { eid: 'b1' }, $delete: true }]))
  return { one, num: born.entity.num }
}

test('a write that raced the delete is swallowed, and the batch lands', () => {
  let { one } = buried()
  sync(one.apply([
    {
      entity: { eid: 'b1' },
      doc: { title: 'Dune II' },
      $was: { doc: { title: token('Dune') } },
    },
    { entity: { eid: 'b2' }, doc: { title: 'Emma' } },
  ]))
  let [b1, b2] = one.get(['b1', 'b2']) as Bundle[]
  assert(isDead(b1))
  assertEquals(comp(b2, 'doc').title, 'Emma')
})

test('any other write brings the dead back under its eid and number', () => {
  for (let was of [undefined, { doc: { title: null } }]) {
    let { one, num } = buried()
    let out = sync(one.apply([{
      entity: { eid: 'b1' },
      doc: { title: 'Dune, again' },
      ...(was ? { $was: was } : {}),
    }]))
    assertEquals(at(out, 'b1', 'doc'), { title: 'Dune, again' })
    let [b] = one.get(['b1']) as Bundle[]
    assert(!isDead(b))
    assertEquals(b.entity, { eid: 'b1', num })
    // only what the write gave: the pages went with the delete
    assertEquals(b.book, undefined)
  }
})

test('a write that only removes leaves the dead dead', () => {
  let { one } = buried()
  sync(one.apply([{ entity: { eid: 'b1' }, book: null }]))
  let [b] = one.get(['b1']) as Bundle[]
  assert(isDead(b))
})

test('a hook rewrites the batch the next phase sees', () => {
  let one = g([{
    name: 'shelver',
    hooks: {
      normalize: (bundles) =>
        bundles.map((b) =>
          b.book
            ? {
              ...b,
              book: { ...(b.book as Record<string, unknown>), shelved: true },
            }
            : b
        ),
    },
  }])
  let out = sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 1 } }]))
  assertEquals(at(out, 'b1', 'book'), { pages: 1, shelved: true })
})

test('a hook that throws refuses the batch and nothing lands', () => {
  let one = g([{
    name: 'lease',
    hooks: {
      precondition: () => {
        throw new Error('held by someone else')
      },
    },
  }])
  assertThrows(
    () => sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'x' } }])),
    Error,
    'held by someone else',
  )
  assertEquals(one.get(['b1']), [])
})

test('a hook can add a bundle, and the added one is applied', () => {
  let one = g([{
    name: 'librarian',
    hooks: {
      admit: (bundles) => [...bundles, {
        entity: { eid: 'log' },
        doc: { title: `applied ${bundles.length}` },
      }],
    },
  }])
  sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  let [log] = one.get(['log']) as Bundle[]
  assertEquals(comp(log, 'doc').title, 'applied 1')
})

test('effects run after the commit and a failing one is telemetry', () => {
  let seen: string[] = []
  let errs: unknown[] = []
  let one = graph({
    storage: memory(),
    vocab: books,
    report: (e) => errs.push(e),
    plugins: [
      {
        name: 'broken',
        hooks: {
          effect: () => {
            throw new Error('boom')
          },
        },
      },
      {
        name: 'watcher',
        hooks: {
          effect: (bundles, tx) => {
            let [b] = tx.get(['b1']) as Bundle[]
            seen.push(String(comp(b, 'doc').title))
            return bundles
          },
        },
      },
    ],
  })
  let out = sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  assertEquals(seen, ['Dune']) // the effect saw committed data
  assertEquals(errs.length, 1)
  assert(out.length > 0) // and the batch was not broken by the broken effect
})

test('a check runs every phase, writes nothing, and refuses what it must', () => {
  let ran: string[] = []
  let one = graph({
    storage: memory(),
    vocab: books,
    plugins: [{
      name: 'watcher',
      hooks: {
        commit: (b) => (ran.push('commit'), b),
        effect: (b) => (ran.push('effect'), b),
        // The rollback is a rollback: a hook that wrote inside the
        // transaction hears that its rows are gone, and can tell a rehearsal
        // from a refusal by what it is handed.
        audit: (b, _tx, err) => (
          ran.push(err instanceof Checked ? 'checked' : 'refused'), b
        ),
      },
    }],
  })
  let out = sync(one.apply(
    [{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }],
    { check: true },
  ))
  // Every phase inside the transaction ran, and the answer is stamped —
  assertEquals(ran, ['commit', 'checked'])
  assert(at(out, 'b1', 'created').at)
  // — but nothing was committed, and no effect saw it.
  assertEquals(one.get(['b1']), [])
  // A batch that would be refused is refused just as loudly — which is the
  // whole reason to ask.
  assertThrows(
    () =>
      sync(one.apply([{
        entity: { eid: 'b1' },
        doc: { title: 'Dune' },
        $was: { doc: { title: token('Emma') } },
      }], { check: true })),
    Stale,
  )
})

test('an audit hook runs after the rollback, with the refusal', () => {
  let audited: unknown[] = []
  let one = g([{
    name: 'auditor',
    hooks: {
      precondition: () => {
        throw new Error('refused')
      },
      audit: (bundles, _tx, err) => {
        audited.push(err)
        return bundles
      },
    },
  }])
  assertThrows(() =>
    sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'x' } }]))
  )
  assertEquals((audited[0] as Error).message, 'refused')
})

test('a check over an asynchronous storage rolls back the same way', async () => {
  let one = graph({ storage: slow(memory()), vocab: books })
  let out = await one.apply(
    [{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }],
    { check: true },
  )
  assertEquals(out[0].entity.eid, 'b1')
  assertEquals(await one.get(['b1']), [])
})

test('the same batches run over an asynchronous storage', async () => {
  let one = graph({ storage: slow(memory()), vocab: books })
  let out = one.apply([
    { entity: { eid: 'b1' }, book: { pages: 412 } },
    { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
  ])
  assert(isPromise(out))
  await out
  let dead = await one.apply([{ entity: { eid: 'b1' }, $delete: true }])
  assert(dead.some((b) => b.entity.eid == 'r1' && isDead(b)))
})

test('registries are per instance', () => {
  let a = g([{ name: 'p', hooks: { normalize: (b) => b } }])
  let b = g()
  assertEquals(a.plugins.length, 1)
  assertEquals(b.plugins.length, 0)
  b.use({ name: 'q' })
  assertEquals(a.plugins.length, 1)
})

for (let async of [false, true]) {
  test(`provenance policy selects, overrides and suppresses without bypassing core clock (${async ? 'async' : 'sync'})`, async () => {
    let store = memory()
    let one = graph({
      storage: async ? slow(store) : store,
      vocab: books,
      provenance: (b) =>
        b.entity.eid == 'skip' ? null : {
          kind: b.entity.eid == 'edit' ? 'updated' : 'created',
          by: b.entity.eid == 'unowned' ? null : 'author',
          via: 'not-in-this-vocabulary',
        },
    })
    let now = '2026-09-01T01:02:03.000Z'
    let out = await one.apply(
      ['birth', 'edit', 'skip', 'unowned'].map((eid) => ({
        entity: { eid },
        doc: { title: eid },
        $actor: { by: 'writer' },
      })),
      { now },
    )
    assertEquals(at(out, 'birth', 'created'), { at: now, by: 'author' })
    assertEquals(at(out, 'edit', 'updated'), { at: now, by: 'author' })
    assertEquals(at(out, 'unowned', 'created'), { at: now, by: null })
    let skipped = out.find((b) => b.entity.eid == 'skip')!
    assertEquals(skipped.created, undefined)
    assertEquals(skipped.updated, undefined)
    let held = await store.tx((tx) => tx.get(['skip']))
    assertEquals(held[0].created, undefined)
    assertEquals(held[0].updated, undefined)
  })
}

test('provenance policy narrows an attribution-only vocabulary, including explicit null', () => {
  let vocab = loadVocab({
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
      created: {
        component: true,
        type: 'object',
        properties: { by: { type: 'string', stamped: true } },
      },
    },
  })
  let one = graph({
    storage: memory(),
    vocab,
    provenance: (b) => ({
      kind: 'created',
      by: b.entity.eid == 'a' ? 'author' : null,
      via: 'omitted',
    }),
  })
  let out = sync(one.apply([
    { entity: { eid: 'a' }, doc: { title: 'A' } },
    { entity: { eid: 'b' }, doc: { title: 'B' } },
  ]))
  assertEquals(at(out, 'a', 'created'), { by: 'author' })
  assertEquals(at(out, 'b', 'created'), { by: null })
})

test('the rules phase runs after the guard and before the patches land', () => {
  let seen: string[] = []
  let one = g([{
    name: 'watcher',
    hooks: {
      precondition: (b) => (seen.push('precondition'), b),
      // What a rule produces here joins the batch; `mutate` writes it like
      // anything else, which is what makes the stamps land on it too.
      rules: (b) => (
        seen.push('rules'),
          [...b, { entity: { eid: 'b2' }, doc: { title: 'derived' } }]
      ),
      journal: (b) => (seen.push('journal'), b),
    },
  }])
  let out = sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  assertEquals(seen, ['precondition', 'rules', 'journal'])
  let [derived] = one.get(['b2']) as Bundle[]
  assertEquals(comp(derived, 'doc').title, 'derived')
  assert(at(out, 'b2', 'created'), "a rule's entity is stamped like any other")
})
