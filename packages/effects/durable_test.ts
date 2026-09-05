/// <reference lib="deno.ns" />
// The durability tier: a run is written down before it happens and marked
// after, and what a crash left `pending` gets exactly one more attempt.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Tx } from '@yaks/graph'
import { detached, isPromise } from '@yaks/graph'
import { effects } from './registry.ts'
import { ledger } from './durable.ts'
import { blogGraph, durableBlog } from './harness.ts'

let sync = <T>(out: T | Promise<T>): T => {
  assert(!isPromise(out), 'apply() went async over a Map')
  return out as T
}

// A clock the tests move by hand, so a lease can expire without waiting.
let clock = (start = 1_000) => {
  let at = start
  return Object.assign(() => at, { tick: (ms: number) => at += ms })
}

let fixture = (owner = 'worker-1', now = clock()) => {
  let seen: string[] = []
  let oops: string[] = []
  let log = ledger({ owner, now, lease: 60_000 })
  let fx = effects(durableBlog, {
    around: log.around,
    report: (_e, job) => oops.push(job.handler),
  })
  let g = blogGraph([fx], durableBlog)
  let tx: Tx = detached(g.storage)
  let rows = () => (g.read('.effect!') as Bundle[]).map((b) => b.effect as Comp)
  return { fx, g, log, tx, seen, oops, rows, now }
}

let post = (eid: string, comp: Record<string, unknown> = { title: 'One' }) => ({
  entity: { eid },
  post: comp,
})

Deno.test('a run is recorded and marked done', () => {
  let f = fixture()
  f.fx.created('post', (e) => f.seen.push(e.entity.eid))
  sync(f.g.apply([post('p1')]))
  assertEquals(f.seen, ['p1'])
  let [row] = f.rows().filter((r) => r.handler == 'post.created')
  assertEquals(row.state, 'done')
  assertEquals(row.target, 'p1')
  assertEquals(row.comp, 'post')
  assertEquals(row.kind, 'created')
  assertEquals(row.attempts, 1)
})

Deno.test('a failing run is recorded as failed, and still reported', () => {
  let f = fixture()
  f.fx.created('post', () => {
    throw new Error('boom')
  })
  sync(f.g.apply([post('p1')]))
  assertEquals(f.oops, ['post.created'])
  assertEquals(f.rows().map((r) => r.state), ['failed'])
})

Deno.test('reconcile finishes what a crash interrupted, once', () => {
  let f = fixture()
  f.fx.created('post', (e) => f.seen.push(`${e.entity.eid} ${e.comp?.title}`))
  sync(f.g.apply([post('p1')]))
  f.seen.length = 0
  // A crash: the row was written, the handler never got to run.
  f.tx.patch([{
    entity: { eid: 'r1' },
    effect: {
      handler: 'post.created',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'pending',
      attempts: 1,
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  // it ran again, with the entity as it stands now
  assertEquals(f.seen, ['p1 One'])
  let [row] = f.rows().filter((r) =>
    r.handler == 'post.created' && r.attempts == 2
  )
  assertEquals(row.state, 'done')
  assertEquals(row.lease_owner, null)
  // and a second pass finds nothing left to do
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(f.seen.length, 1)
})

Deno.test('a run that has spent its retry is given up on, not looped', () => {
  let f = fixture()
  f.fx.created('post', () => f.seen.push('ran'))
  sync(f.g.apply([post('p1')]))
  f.seen.length = 0
  f.tx.patch([{
    entity: { eid: 'r1' },
    effect: {
      handler: 'post.created',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'pending',
      attempts: 2,
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(f.seen, [])
  let [row] = f.rows().filter((r) => r.attempts == 2)
  assertEquals(row.state, 'failed')
})

Deno.test('a row another process holds is left alone until the lease lapses', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  f.fx.created('post', () => f.seen.push('ran'))
  sync(f.g.apply([post('p1')]))
  f.seen.length = 0
  f.tx.patch([{
    entity: { eid: 'r1' },
    effect: {
      handler: 'post.created',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'pending',
      attempts: 1,
      lease_owner: 'worker-2',
      lease_token: 'tok',
      lease_expiry: new Date(now() + 30_000).toISOString(),
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(f.seen, [])
  // once it lapses, this process may take it
  now.tick(31_000)
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, ['ran'])
})

Deno.test('a reconciled removal carries no component, and its entity is gone', () => {
  let f = fixture()
  f.fx.removed('post', (e) => f.seen.push(`${e.entity.eid} ${e.comp}`))
  sync(f.g.apply([post('p1')]))
  sync(f.g.apply([{ entity: { eid: 'p1' }, $delete: true }]))
  f.seen.length = 0
  f.tx.patch([{
    entity: { eid: 'r1' },
    effect: {
      handler: 'post.removed',
      target: 'p1',
      comp: 'post',
      kind: 'removed',
      state: 'pending',
      attempts: 1,
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, ['p1 undefined'])
})

Deno.test('a row naming a handler nobody registered is reported, not guessed at', () => {
  let f = fixture()
  f.fx.created('post', () => f.seen.push('ran'))
  f.tx.patch([{
    entity: { eid: 'r1' },
    effect: {
      handler: 'post.created.nope',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'pending',
      attempts: 1,
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, [])
  assertEquals(f.oops, ['post.created.nope'])
  assertEquals(f.rows().map((r) => r.state), ['failed'])
})
