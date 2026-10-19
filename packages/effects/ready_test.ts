// Eligibility is the query the pool uses, including deadlines, ownership and
// disabled work. The same query selects rows before the bounded claim window.
import { type Bundle, graph } from '@yaks/graph'
import { matcher } from '@yaks/match'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { ready } from './ready.ts'
import { effects } from './registry.ts'
import { pooledBlog as vocab } from './testing.ts'

let stamp = (n: number) => new Date(n).toISOString()
let run = (eid: string, patch = {}, handler = 'post_note'): Bundle => ({
  entity: { eid },
  effect: { handler, target: 'target', state: 'pending', ...patch },
})
let rows = [
  run('fresh'),
  run('future', { next: stamp(1001) }),
  run('due', { next: stamp(1000) }),
  run('held', { lease_owner: 'peer', lease_expiry: stamp(1001) }),
  run('expired', { lease_owner: 'peer', lease_expiry: stamp(1000) }),
  run('other', {}, 'post_gone'),
  run('disabled', { next: stamp(1001) }, 'post_swept'),
]
let ids = (opts: Parameters<typeof ready>[1] = {}, names = ['post_note']) =>
  matcher(ready(names, opts), vocab, { now: 1000 })(rows).map((b) =>
    b.entity.eid
  )

test('ready work excludes unsupported handlers, future retries and live claims', () => {
  equal(ids(), ['fresh', 'due', 'expired'])
})
test('disabled unclaimed work can settle while its retry deadline is in the future', () => {
  equal(ids({ disabled: ['post_swept'] }, ['post_swept']), ['disabled'])
})
test('a single owner still respects retries while recovering recorded claims', () => {
  equal(ids({ singleOwner: true }), ['fresh', 'due', 'held', 'expired'])
})

let storage = ram(vocab)
let calls = 0, attempts = 0, reads = 0, now = 0
let fx = effects(vocab, {
  owner: 'worker',
  startup: 'manual',
  now: () => now,
  gone: () => (calls++, false),
  write: (bs) => g.apply(bs, { trusted: true }),
})
let g = graph({ storage, vocab, plugins: [fx] })
await g.apply([
  { entity: { eid: 'worker' }, subscriber: {} },
  { entity: { eid: 'target' }, post: {} },
  run('retry', { next: stamp(1000) }),
  run('claimed', { lease_owner: 'peer', lease_expiry: stamp(1000) }),
], { trusted: true })
fx.handle({ post_note: () => void attempts++ })
await fx.work(g, AbortSignal.abort(), { passes: 0 })
let read = g.read
let queries: unknown[] = []
g.read = (q, o) => {
  if (typeof q != 'string') {
    reads++
    queries.push(q)
  }
  return read(q, o)
}
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let first = { reads, calls, attempts, query: queries[0] }
reads = calls = 0
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let second = { reads, calls, attempts, query: queries.at(-1) }
test('idle deferred and claimed work needs one identical ready query without owner probes', () => {
  equal(first.reads, 1)
  equal(second.reads, 1)
  equal([first.calls, second.calls, first.attempts, second.attempts], [
    0,
    0,
    0,
    0,
  ])
  equal(first.query, second.query)
})
now = 1000
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let recovered = attempts
await fx.stop()
test('the same ready query discovers retry deadlines and expired claims on the next turn', () => {
  equal(recovered, 2)
})
