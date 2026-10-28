// A long-lived handler is already owned work, not a reason to scan every
// handler's pending window while waiting for something else to arrive.
import { system } from '@yaks/fp'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, ok, test } from '@yaks/testing'
import { effects } from './registry.ts'
import { pooledBlog as vocab } from './testing.ts'

let storage = ram(vocab),
  held = Promise.withResolvers<void>(),
  ran: string[] = [],
  now = 0
let fx = effects(vocab, {
  owner: 'worker',
  startup: 'manual',
  clock: { ...system, now: () => now },
  write: (bs) => g.apply(bs, { trusted: true }),
})
let g = graph({ storage, vocab, plugins: [fx] })
fx.handle({
  post_note: (e) =>
    e.entity.eid == 'held' ? held.promise : void ran.push(e.entity.eid),
  post_swept: () => {},
})
await g.apply([{ entity: { eid: 'worker' }, subscriber: {} }])
await fx.work(g, AbortSignal.abort(), { passes: 0 })
await g.apply([{ entity: { eid: 'held' }, post: {} }])
let read = g.read.bind(g), reads = 0
g.read = (q, opts) => {
  reads++
  return read(q, opts)
}
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let idleReads = reads, active = fx.running().map((r) => r.target)
test('locally running work leaves idle discovery at one pending seek', () => {
  equal(active, ['held'])
  ok(idleReads <= 2, `${idleReads} discovery reads with only a running handler`)
})
let other = effects(vocab, {
  owes: 'declared',
  write: (bs) => writer.apply(bs, { trusted: true }),
})
let writer = graph({ storage, vocab, plugins: [other] })
await writer.apply([{ entity: { eid: 'new' }, post: {} }])
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let received = [...ran]
test('a waiting handler cannot hide work another process just wrote', () => {
  equal(received, ['new'])
})
await writer.apply([{
  entity: { eid: 'unserved' },
  effect: { handler: 'post_gone', target: 'held', state: 'pending' },
}], { trusted: true })
reads = 0
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let coldReads = reads
test('another handler cannot make this worker scan its idle windows', () => {
  ok(coldReads <= 2, `${coldReads} reads for another handler's work`)
})
await graph({ storage, vocab }).apply([{
  entity: { eid: 'later' },
  post: {},
}])
await writer.apply([{
  entity: { eid: 'delayed' },
  effect: {
    handler: 'post_note',
    target: 'later',
    state: 'pending',
    next: new Date(1000).toISOString(),
  },
}], { trusted: true })
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let beforeDue = [...ran]
test('a future retry is not started early', () => {
  equal(beforeDue, ['new'])
})
now = 1000
await fx.work(g, AbortSignal.abort(), { passes: 1 })
let due = [...ran]
test('a retry becomes discoverable at its due time', () => {
  equal(due, ['new', 'later'])
})
held.resolve()
await fx.idle()
