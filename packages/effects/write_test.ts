/// <reference lib="deno.ns" />
// The write door (T-34044): what an effect's own write goes through, and what
// stops it looping. A write from an effect is a new batch through the graph's
// own apply() — journaled, seen by the other effects, cast to whoever the host
// pushes to — never a row put straight into a transaction that has finished.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Graph, Tx } from '@yaks/graph'
import { detached, graph, isPromise } from '@yaks/graph'
import { ddl, journal, log } from '@yaks/journal'
import { mem } from '../sqlite/harness.ts'
import { storage } from '../sqlite/mod.ts'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { effects } from './registry.ts'
import { ledger } from './durable.ts'
import { generation, ORIGIN } from './write.ts'
import { blog, blogGraph, durableBlog } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

// A registry whose handlers write through the graph they are registered on.
// `g` is built after the registry and only ever reached post-commit.
let fixture = (vocab: Vocab = blog) => {
  let oops: unknown[] = []
  let fx = effects(vocab, {
    report: (e) => oops.push(e),
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = blogGraph([fx], vocab)
  return { fx, g, oops, apply: (b: Bundle[]) => sync(g.apply(b)) }
}

let post = (eid: string, comp: Record<string, unknown> = { title: 'One' }) => ({
  entity: { eid },
  post: comp,
})

Deno.test('an effect writes through apply(), so the write is stamped', () => {
  let { fx, g, apply } = fixture()
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 's1' }, subscriber: { email: 'ana@blog' } }]),
  )
  apply([post('p1')])
  let [sub] = g.read('.subscriber!&.created?') as Bundle[]
  assertEquals((sub.subscriber as Record<string, unknown>).email, 'ana@blog')
  // `created` is @yaks/graph's own stamp: a `tx.patch` write would carry none.
  assert(sub.created, 'the write-back went through the whole pipeline')
})

Deno.test('an effect with no write door is reported, never written past', () => {
  let oops: unknown[] = []
  let fx = effects(blog, { report: (e) => oops.push(e) })
  let g = blogGraph([fx])
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 's1' }, subscriber: { email: 'ana@blog' } }]),
  )
  sync(g.apply([post('p1')]))
  assertEquals((g.read('.subscriber!') as Bundle[]).length, 0)
  assertEquals(oops.length, 1)
  assert(String(oops[0]).includes('no write door'))
})

Deno.test("an effect's write is seen by the other effects", () => {
  let { fx, apply } = fixture()
  let seen: string[] = []
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 's1' }, subscriber: { email: 'ana@blog' } }]),
  )
  fx.created('subscriber', (e) => seen.push(`welcomed ${e.entity.eid}`))
  apply([post('p1')])
  assertEquals(seen, ['welcomed s1'])
})

Deno.test('a writing effect that triggers itself is stopped by the marker', () => {
  let { fx, g, apply } = fixture()
  let n = 0
  // Each run writes a new post, so nothing about the data ever settles: only
  // the generation the door marks can end this.
  fx.created('post', (_e, _tx, write) => {
    n++
    write([post(`p${n + 1}`)])
  })
  apply([post('p1')])
  // The batch at the door is generation 0 and fires; its write is generation 1
  // and fires; generation 2 wakes nobody. The rows are all there — the batch
  // committed like any other, it simply woke no handler.
  assertEquals(n, 2)
  assertEquals((g.read('.post!') as Bundle[]).length, 3)
})

Deno.test('depth 0 lets an effect write without waking anything', () => {
  let oops: unknown[] = []
  let fx = effects(blog, {
    report: (e) => oops.push(e),
    depth: 0,
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = blogGraph([fx])
  let n = 0
  fx.created('post', (_e, _tx, write) => {
    n++
    write([post(`p${n + 1}`)])
  })
  sync(g.apply([post('p1')]))
  assertEquals(n, 1)
  assertEquals((g.read('.post!') as Bundle[]).length, 2)
  assertEquals(oops, [])
})

Deno.test('the generation marker never reaches the caller, or a property', () => {
  let { fx, g, apply } = fixture()
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 's1' }, subscriber: { email: 'ana@blog' } }]),
  )
  let out = apply([post('p1')])
  assertEquals(generation(out), 0)
  for (let b of [...out, ...(g.read('.subscriber!') as Bundle[])]) {
    assert(!(ORIGIN in b), `${ORIGIN} escaped onto a bundle`)
  }
})

// The journal is a plugin like any other, so an effect's write is journaled
// exactly because it is an apply() — the point of the door.
let logged = (): {
  g: Graph
  fx: ReturnType<typeof effects>
  j: ReturnType<typeof log>
} => {
  let vocab: Vocab = loadVocab([
    {
      $defs: {
        entity: {
          component: true,
          type: 'object',
          wire: false,
          properties: { num: { type: 'number', stamped: true } },
        },
        post: {
          component: true,
          type: 'object',
          kind: true,
          properties: { title: { type: 'string' } },
        },
        subscriber: {
          component: true,
          type: 'object',
          kind: true,
          properties: { email: { type: 'string' } },
        },
      },
    },
  ])
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let db = mem()
  let store = storage(db, vocab)
  store.install()
  db.exec(ddl())
  let j = log({
    rows: (sql, params) =>
      db.query(sql, params as never[]) as Record<string, unknown>[],
  })
  let g = graph({ storage: store, vocab, plugins: [journal(j), fx] })
  return { g, fx, j }
}

Deno.test("the journal carries an effect's own write", () => {
  let { g, fx, j } = logged()
  fx.created(
    'post',
    (_e, _tx, write) =>
      write([{ entity: { eid: 's1' }, subscriber: { email: 'ana@blog' } }]),
  )
  sync(g.apply([post('p1')]))
  let deltas = j.history('s1').flatMap((b) => b.deltas.map((d) => d.prop))
  // The component appearing, and the property it appeared with.
  assertEquals(deltas, [null, 'email'])
  // Its own batch row, not a line tacked onto the one that woke it.
  assertEquals(j.tip(), 2)
})

// A bounded number of attempts is the ledger's promise, and the write door
// does not change it: a run that was interrupted is tried again up to the
// count, and a run that already wrote is not run again just because its write
// went through apply().
Deno.test('the attempt count holds when the effect writes through the door', async () => {
  let runs: string[] = []
  let log = ledger({
    owner: 'w1',
    mint: (() => {
      let n = 0
      return () => `fx${++n}`
    })(),
  })
  let fx = effects(durableBlog, {
    around: log.around,
    write: (b) => g.apply(b, { trusted: true }),
  })
  let g = blogGraph([fx], durableBlog)
  fx.created('post', (e, _tx: Tx, write) => {
    runs.push(e.entity.eid)
    return write([{
      entity: { eid: `s-${e.entity.eid}` },
      subscriber: { email: `${e.entity.eid}@blog` },
    }])
  })
  await g.apply([post('p1')])
  assertEquals(runs, ['p1'])

  // Nothing is left pending, so a boot reconcile runs nothing at all.
  assertEquals(await log.reconcile(fx, detached(g.storage)), 0)
  assertEquals(runs, ['p1'])

  // A run the ledger thinks was interrupted is tried again, up to the count
  // and no further — never a loop, however many times boot comes round.
  let interrupt = () =>
    g.apply([{ entity: { eid: 'fx1' }, effect: { state: 'pending' } }], {
      trusted: true,
    })
  await interrupt()
  assertEquals(await log.reconcile(fx, detached(g.storage)), 1)
  await interrupt()
  assertEquals(await log.reconcile(fx, detached(g.storage)), 1)
  assertEquals(runs, ['p1', 'p1', 'p1'])
  await interrupt()
  assertEquals(await log.reconcile(fx, detached(g.storage)), 0)
  assertEquals(runs, ['p1', 'p1', 'p1'])
  // Three runs, three write-backs, one row: the writes were idempotent by eid,
  // and the attempts are spent rather than looping.
  assertEquals((g.read('.subscriber!') as Bundle[]).length, 1)
})
