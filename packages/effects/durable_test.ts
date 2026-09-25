/// <reference lib="deno.ns" />
// The durability tier: a run is written down before it happens and marked
// after, what a crash left `pending` is picked back up, and a run that did not
// land is tried again — its registration's count of attempts, a backoff
// between them, and the last error beside it when they are spent.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Tx } from '@yaks/graph'
import { detached, isPromise } from '@yaks/graph'
import { effects } from './registry.ts'
import { EFFECT, ledger } from './durable.ts'
import { Elsewhere } from './lease.ts'
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
  let row = (eid: string) => sync(tx.get([eid]))[0][EFFECT] as Comp
  return { fx, g, log, tx, seen, oops, rows, row, now }
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

Deno.test('a run handed Elsewhere waits, due at once, for the sweep holder', () => {
  let f = fixture()
  let mine = false
  f.fx.created('post', (e) => {
    if (!mine) throw new Elsewhere('the server starts it')
    f.seen.push(e.entity.eid)
  })
  sync(f.g.apply([post('p1')]))
  // Nothing reported, no attempt spent, and nothing to wait out.
  assertEquals(f.oops, [])
  let [row] = f.rows()
  assertEquals(row.state, 'pending')
  assertEquals(row.attempts, 0)
  assertEquals(row.error, null)
  assertEquals(sync(f.log.due(f.tx)), f.now())
  // The process holding the sweep runs it on its next pass.
  mine = true
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, ['p1'])
  assertEquals(f.rows()[0].state, 'done')
})

Deno.test('a run still going here is not taken for one a crash left', async () => {
  let f = fixture()
  let finish = () => {}
  let runs = 0
  f.fx.created('post', () => {
    runs++
    return new Promise<void>((go) => finish = go)
  })
  let applied = f.g.apply([post('p1')])
  // Pending with no `next` reads as interrupted, but its handler is running.
  assertEquals(await f.log.reconcile(f.fx, f.tx), 0)
  assertEquals(runs, 1)
  finish()
  await applied
  await new Promise((go) => setTimeout(go))
  assertEquals(f.rows()[0].state, 'done')
})

Deno.test('a failing run keeps its error and comes back due, not failed', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  f.fx.created('post', () => {
    throw new Error('boom')
  })
  sync(f.g.apply([post('p1')]))
  assertEquals(f.oops, ['post.created'])
  let [row] = f.rows()
  // Still pending: it has attempts left, so it is owed another one — with
  // what it threw beside it and the instant its backoff is up.
  assertEquals(row.state, 'pending')
  assertEquals(row.error, 'boom')
  assertEquals(row.attempts, 1)
  assertEquals(row.next, new Date(now() + 1000).toISOString())
  // And it is not due yet: a sweep now finds nothing to do.
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
})

Deno.test('a handler that throws twice lands on the third', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  let thrown = 0
  f.fx.created('post', () => {
    if (++thrown <= 2) throw new Error(`boom ${thrown}`)
    f.seen.push('landed')
  })
  sync(f.g.apply([post('p1')]))
  assertEquals(f.rows().map((r) => r.error), ['boom 1'])
  // The second attempt, once its backoff is up.
  now.tick(1000)
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  let [second] = f.rows()
  assertEquals([second.state, second.attempts, second.error], [
    'pending',
    2,
    'boom 2',
  ])
  // The third lands, and the row says so — one row throughout, because a
  // retry is the same run, not a new one.
  now.tick(2000)
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, ['landed'])
  assertEquals(f.rows().length, 1)
  let [done] = f.rows()
  assertEquals([done.state, done.attempts, done.error, done.next], [
    'done',
    3,
    null,
    null,
  ])
  // Nothing left owed.
  now.tick(60_000)
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
})

Deno.test('a handler that always throws rests failed with the last error', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  let thrown = 0
  f.fx.created('post', () => {
    throw new Error(`boom ${++thrown}`)
  })
  sync(f.g.apply([post('p1')]))
  for (let i = 0; i < 4; i++) {
    now.tick(60_000)
    f.log.reconcile(f.fx, f.tx)
  }
  assertEquals(thrown, 3)
  let [row] = f.rows()
  assertEquals([row.state, row.attempts, row.error, row.next], [
    'failed',
    3,
    'boom 3',
    null,
  ])
})

Deno.test('a registration says how many attempts its runs get', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  let thrown = 0
  f.fx.created('post', () => {
    throw new Error(`boom ${++thrown}`)
  }, { tries: 1 })
  sync(f.g.apply([post('p1')]))
  // One attempt was all it asked for: no backoff, no second go.
  assertEquals(f.rows().map((r) => [r.state, r.error]), [['failed', 'boom 1']])
  now.tick(60_000)
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(thrown, 1)
})

Deno.test('a handler that is not idempotent is retried for a failure, never a lapse', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  f.fx.created('post', () => f.seen.push('ran'), { idempotent: false })
  sync(f.g.apply([post('p1')]))
  f.seen.length = 0
  // A run whose lease lapsed mid-flight: nobody knows what it did, so this
  // one is not run again — it rests, and says why.
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
      lease_expiry: new Date(now() - 1).toISOString(),
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(f.seen, [])
  let row = f.row('r1')
  assertEquals(row.state, 'failed')
  assert(String(row.error).includes('not idempotent'), String(row.error))
  // A failure it reported is another matter: it threw before doing anything,
  // so that one is tried again.
  f.tx.patch([{
    entity: { eid: 'r2' },
    effect: {
      handler: 'post.created',
      target: 'p1',
      comp: 'post',
      kind: 'created',
      state: 'pending',
      attempts: 1,
      error: 'boom',
      next: new Date(now() - 1).toISOString(),
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 1)
  assertEquals(f.seen, ['ran'])
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

Deno.test('a run that has spent its attempts is given up on, not looped', () => {
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
      attempts: 3,
      error: 'boom 3',
    },
  }])
  assertEquals(sync(f.log.reconcile(f.fx, f.tx)), 0)
  assertEquals(f.seen, [])
  let [row] = f.rows().filter((r) => r.attempts == 3)
  // The verdict a person reads, with what it last threw beside it.
  assertEquals([row.state, row.error], ['failed', 'boom 3'])
})

Deno.test('the soonest waiting retry is what a sweep sleeps until', () => {
  let now = clock()
  let f = fixture('worker-1', now)
  assertEquals(sync(f.log.due(f.tx)), undefined)
  f.fx.created('post', () => {
    throw new Error('boom')
  })
  sync(f.g.apply([post('p1')]))
  assertEquals(sync(f.log.due(f.tx)), now() + 1000)
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

Deno.test('split reconciliation never claims or settles another process class', () => {
  let g = blogGraph([], durableBlog)
  let tx = detached(g.storage)
  let log = ledger({ owner: 'server' })
  let fx = effects(durableBlog, { want: (w) => w == 'serve' })
  let ran = 0
  fx.created('post', () => ran++) // do owned
  tx.patch([{
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
  let before = sync(tx.get(['r1']))
  assertEquals(sync(log.reconcile(fx, tx)), 0)
  assertEquals(
    sync(tx.get(['r1'])),
    before,
    'the sibling keeps its attempt and pending state',
  )
  assertEquals(ran, 0)
})
