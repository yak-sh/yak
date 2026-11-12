/// <reference lib="deno.ns" />
// Slow reads own their subscription lifetime, while independent navigation,
// cancelled navigation and writes can progress without waiting for them.
import { equal, test } from '@yaks/testing'
import { type Graph } from '@yaks/graph'
import { type Frame, subscriptions } from './subs.ts'
import { shopGraph } from './testing.ts'
import { api } from './route.ts'
import { faults as faults_ } from './refuse.ts'

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
// An answer the box's commits move faster than it can be read is still heard.
test('a write during an opening answers what was read, then what the write moved', async () => {
  let f = written
  f.resume()
  f.release()
  await opening
  await f.subs.check()
  equal(f.frames.map((f) => f.bundles?.[0].book), [{ price: 1 }, { price: 2 }])
  await f.g.apply([{ entity: { eid: 'one' }, book: { price: 3 } }])
  equal(f.frames.map((f) => f.bundles?.[0].book), [
    { price: 1 },
    { price: 2 },
    { price: 3 },
  ])
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
  await revised.check()
  equal(external.frames.map((f) => f.bundles?.[0].book), [
    { price: 1 },
    { price: 4 },
  ])
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

// Two pages watching the same query share one read when a write moves it.
let pass = (() => {
  let g = shopGraph()
  g.apply([{ entity: { eid: 'one' }, book: { price: 1 } }])
  let gate: Promise<void> | undefined
  let release = () => {}
  let signals: AbortSignal[] = []
  let subs = subscriptions({
    ...g,
    read: (q, opts) => {
      let rows = g.read(q, opts)
      if (!gate || q != '.book') return rows
      let signal = opts!.signal!
      signals.push(signal)
      return new Promise<Awaited<typeof rows>>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
        gate!.then(() => resolve(rows))
      })
    },
  }, { invalidate: () => true })
  let hold = () => gate = new Promise<void>((done) => release = done)
  let page = () => {
    let frames: Frame[] = []
    let sink = (frame: Frame) => void frames.push(frame)
    subs.open(sink, 'books', '.book')
    return { frames, sink }
  }
  return { g, subs, signals, hold, release: () => release(), page }
})()
test('a page that leaves mid-pass cancels no read another page shares', async () => {
  let f = pass
  let faults: unknown[] = []
  let unhook = faults_((err) => faults.push(err))
  let [gone, stays] = [f.page(), f.page()]
  try {
    f.hold()
    let writing = f.g.apply([{ entity: { eid: 'one' }, book: { price: 2 } }])
    // Not awaited: a drop waits for the pass it interrupts.
    let dropped = f.subs.drop(gone.sink)
    f.release()
    await Promise.all([writing, dropped, f.subs.check()])
    equal(stays.frames.map((f) => f.refused ?? f.bundles?.[0].book), [
      { price: 1 },
      { price: 2 },
    ])
    equal(faults, [])
    f.hold()
    writing = f.g.apply([{ entity: { eid: 'one' }, book: { price: 3 } }])
    dropped = f.subs.drop(stays.sink)
    equal(f.signals.at(-1)!.aborted, true)
    f.release()
    await Promise.all([writing, dropped])
  } finally {
    unhook()
    f.release()
  }
})
