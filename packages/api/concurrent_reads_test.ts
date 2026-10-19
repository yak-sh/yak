/// <reference lib="deno.ns" />
// Slow reads own their subscription lifetime, while independent navigation,
// cancelled navigation and writes can progress without waiting for them.
import { equal, test } from '@yaks/testing'
import { type Graph } from '@yaks/graph'
import { type Frame, subscriptions } from './subs.ts'
import { shopGraph } from './testing.ts'
import { api } from './route.ts'

let fixture = () => {
  let g = shopGraph()
  g.apply([{ entity: { eid: 'one' }, book: { price: 1 } }])
  let release!: () => void
  let gate = new Promise<void>((done) => release = done)
  let delayed = true
  let signals: AbortSignal[] = []
  let graph: Graph = {
    ...g,
    read: (q, opts) => {
      let rows = g.read(q, opts)
      if (!delayed || q != '.book') return rows
      if (opts?.signal) signals.push(opts.signal)
      return gate.then(() => rows)
    },
  }
  let subs = subscriptions(graph)
  let frames: Frame[] = []
  let sink = (frame: Frame) => void frames.push(frame)
  return {
    g,
    subs,
    frames,
    sink,
    signals,
    release,
    resume: () => delayed = false,
  }
}

let independent = fixture()
test('a slow subscription cannot hold later navigation or a snapshot', async () => {
  let f = independent
  let opening = f.subs.open(f.sink, 'old', '.book')
  try {
    f.subs.open(f.sink, 'new', '.book.price=1')
    equal(f.frames.map((f) => f.id), ['new'])
    let snapshot = f.subs.snapshot('.book.price=1')
    equal(Array.isArray(snapshot), true)
    equal((await snapshot as unknown[]).length, 1)
  } finally {
    f.release()
    await opening
    await f.subs.drop(f.sink)
  }
})

let replaced = fixture()
test('replacing and closing slow subscriptions cancel them without stale answers', async () => {
  let f = replaced
  let first = f.subs.open(f.sink, 'page', '.book')
  f.subs.open(f.sink, 'page', '.book.price=1')
  let second = f.subs.open(f.sink, 'discard', '.book')
  f.subs.close(f.sink, 'discard')
  try {
    equal(f.signals.map((s) => s.aborted), [true, true])
    equal(f.frames.map((f) => f.id), ['page'])
    f.release()
    await Promise.all([first, second])
    equal(f.frames.map((f) => f.id), ['page'])
  } finally {
    f.release()
    await f.subs.drop(f.sink)
  }
})

let written = fixture()
let opening = written.subs.open(written.sink, 'page', '.book')
await written.g.apply([{ entity: { eid: 'one' }, book: { price: 2 } }])
test('a write during an opening replaces its old snapshot with fresh rows', async () => {
  let f = written
  f.resume()
  f.release()
  await opening
  equal(f.frames.map((f) => f.bundles?.[0].book), [{ price: 2 }])
  await f.g.apply([{ entity: { eid: 'one' }, book: { price: 3 } }])
  equal(f.frames.map((f) => f.bundles?.[0].book), [{ price: 2 }, { price: 3 }])
  await f.subs.drop(f.sink)
})

let external = fixture()
let revision = 0
let revised = subscriptions({
  ...external.g,
  read: (q, opts) => {
    let rows = external.g.read(q, opts)
    return revision ? rows : new Promise<Awaited<typeof rows>>((resolve) => {
      complete = () => resolve(rows)
    })
  },
}, { revision: () => revision })
let complete!: () => void
let revising = revised.open(external.sink, 'external', '.book')
await external.g.apply([{ entity: { eid: 'one' }, book: { price: 4 } }])
revision++
revised.check()
test('an external revision refreshes an initial snapshot still in flight', async () => {
  complete()
  await revising
  equal(external.frames.map((f) => f.bundles?.[0].book), [{ price: 4 }])
  await revised.drop(external.sink)
})

let restore = fixture()
let restoring = restore.subs.restore([
  { sink: restore.sink, id: 'cancelled', query: '.book' },
  { sink: restore.sink, id: 'survivor', query: '.book' },
])
restore.subs.close(restore.sink, 'cancelled')
test('restored watches have separate cancellation ownership', async () => {
  equal(restore.signals.map((s) => s.aborted), [true, false])
  restore.release()
  await restoring
  equal(restore.frames.map((f) => f.id), ['survivor'])
  await restore.subs.drop(restore.sink)
})

let interrupted = fixture()
let started = Promise.withResolvers<void>()
let abort = new AbortController()
let reports: unknown[] = []
let serve = api({
  graph: {
    ...interrupted.g,
    read: (_q, opts) =>
      new Promise<never>((_resolve, reject) => {
        opts!.signal!.addEventListener('abort', () =>
          reject(opts!.signal!.reason))
        started.resolve()
      }),
  },
  report: (r) => reports.push(r),
})
let posted = serve(
  new Request('http://probe/query', {
    method: 'POST',
    body: JSON.stringify({ q: '.book' }),
    signal: abort.signal,
  }),
)
await started.promise
test('an abandoned POST query is cancelled without reporting a server failure', async () => {
  abort.abort()
  equal((await posted).status, 400)
  equal(reports, [])
})
