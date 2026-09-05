// A whole `apply()`, over the Map adapter: what lands, what dies with it, what
// is stamped, what a hook can do at each phase, and — running the same batches
// over the asynchronous wrapper — that none of it depends on being
// synchronous.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { Checked, graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import type { Plugin } from './plugin.ts'
import { Stale, token } from './guard.ts'
import { Refused } from './admit.ts'
import { isPromise } from './pipe.ts'
import { books, comp, isDead, memory, slow } from './harness.ts'

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

Deno.test('a batch lands, and the return carries the births', () => {
  let one = g()
  let out = sync(one.apply([
    { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ]))
  let born = out.find((b) => b.entity.num != null)!
  assertEquals(born.entity.eid, 'b1')
  assertEquals(typeof born.entity.num, 'number')
  let [stored] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assertEquals(comp(stored, 'doc').title, 'Dune')
  assertEquals(comp(stored, 'book').pages, 412)
})

Deno.test('the answer is one bundle per entity, and no pipeline key', () => {
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

Deno.test('a patch touches only the columns it names; null clears one', () => {
  let one = g()
  sync(one.apply([{
    entity: { eid: 'b1' },
    book: { pages: 412, status: 'stocked' },
  }]))
  sync(one.apply([{ entity: { eid: 'b1' }, book: { pages: 500 } }]))
  let [b] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assertEquals(comp(b, 'book'), { pages: 500, status: 'stocked' })
  sync(one.apply([{ entity: { eid: 'b1' }, book: { status: null } }]))
  let [c] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assertEquals(comp(c, 'book').status, null)
})

Deno.test('a null component drops the row, the entity survives', () => {
  let one = g()
  sync(one.apply([{
    entity: { eid: 'b1' },
    doc: { title: 'Dune' },
    book: { pages: 412 },
  }]))
  sync(one.apply([{ entity: { eid: 'b1' }, book: null }]))
  let [b] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assertEquals(b.book, undefined)
  assertEquals(comp(b, 'doc').title, 'Dune')
})

Deno.test('births are stamped created, later touches updated', () => {
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

Deno.test('$was guards a column, and a moved value refuses the whole batch', () => {
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
  // refused WHOLE: the other bundle in the batch did not land either
  assertEquals(one.storage.tx((tx) => tx.get(['b2'])), [])
})

Deno.test('a guard on an absent value is null, and on an unknown column refuses', () => {
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

Deno.test('a delete tombstones the entity and death spreads by the vocabulary', () => {
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
  // the bookmark's row was released; its owner lives
  assertEquals(out.find((b) => b.entity.eid == 'u1')!.bookmark, null)
  let [u] = one.storage.tx((tx) => tx.get(['u1'])) as Bundle[]
  assertEquals(u.bookmark, undefined)
  // the dead are dead
  let dead = one.storage.tx((tx) => tx.get(['b1', 'r1'])) as Bundle[]
  assertEquals(dead.filter(isDead).length, 2)
})

Deno.test('a detach reference is nulled and the survivor hears it', () => {
  let one = g()
  sync(one.apply([
    { entity: { eid: 'p1' }, doc: { title: 'Chilton' } },
    { entity: { eid: 'b1' }, book: { pages: 412, publisher: 'p1' } },
  ]))
  let out = sync(one.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  assertEquals(at(out, 'b1', 'book'), { publisher: null })
  let [b] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assertEquals(comp(b, 'book').publisher, null)
  assertEquals(comp(b, 'book').pages, 412) // the book itself is untouched
})

Deno.test('a dead entity takes no patch, in this batch or a later one', () => {
  let one = g()
  sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }]))
  sync(one.apply([
    { entity: { eid: 'b1' }, $delete: true },
    { entity: { eid: 'b1' }, doc: { title: 'back from the dead' } },
  ]))
  sync(one.apply([{ entity: { eid: 'b1' }, doc: { title: 'still no' } }]))
  let [b] = one.storage.tx((tx) => tx.get(['b1'])) as Bundle[]
  assert(isDead(b))
})

Deno.test('a hook rewrites the batch the next phase sees', () => {
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

Deno.test('a hook that throws refuses the batch and nothing lands', () => {
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
  assertEquals(one.storage.tx((tx) => tx.get(['b1'])), [])
})

Deno.test('a hook can add a bundle, and the added one is applied', () => {
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
  let [log] = one.storage.tx((tx) => tx.get(['log'])) as Bundle[]
  assertEquals(comp(log, 'doc').title, 'applied 1')
})

Deno.test('effects run after the commit and a failing one is telemetry', () => {
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
  assertEquals(seen, ['Dune']) // the effect saw COMMITTED data
  assertEquals(errs.length, 1)
  assert(out.length > 0) // and the batch was not broken by the broken effect
})

Deno.test('a check runs every phase, writes nothing, and refuses what it must', () => {
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
  assertEquals(one.storage.tx((tx) => tx.get(['b1'])), [])
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

Deno.test('an audit hook runs after the rollback, with the refusal', () => {
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

Deno.test('a check over an asynchronous storage rolls back the same way', async () => {
  let one = graph({ storage: slow(memory()), vocab: books })
  let out = await one.apply(
    [{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }],
    { check: true },
  )
  assertEquals(out[0].entity.eid, 'b1')
  assertEquals(await one.storage.tx((tx) => tx.get(['b1'])), [])
})

Deno.test('the same batches run over an asynchronous storage', async () => {
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

Deno.test('registries are per instance', () => {
  let a = g([{ name: 'p', hooks: { normalize: (b) => b } }])
  let b = g()
  assertEquals(a.plugins.length, 1)
  assertEquals(b.plugins.length, 0)
  b.use({ name: 'q' })
  assertEquals(a.plugins.length, 1)
})
