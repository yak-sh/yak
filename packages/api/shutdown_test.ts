/// <reference lib="deno.ns" />
// A retiring web host stops subscription reads before closing its reader.
// Cancellation belongs to observation; admitted writes retain their lifetime.
import { equal, test } from '@yaks/testing'
import { type Graph, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { assertRejects } from '@std/assert'
import { handler } from './routes.ts'
import { subscriptions } from './subs.ts'
import { req, shop, shopGraph } from './testing.ts'

let fixture = () => {
  let g = shopGraph()
  g.apply([{ entity: { eid: 'one' }, book: { price: 1 } }])
  let paused = false, reads = 0
  let signal: AbortSignal | undefined
  let failed = Promise.withResolvers<never>()
  let graph: Graph = {
    ...g,
    get: (ids, comps, opts) => {
      reads++
      if (!paused) return g.get(ids, comps, opts)
      signal = opts?.signal
      signal?.addEventListener('abort', () => failed.reject(signal!.reason))
      return failed.promise
    },
  }
  let subs = subscriptions(graph)
  let frames: unknown[] = []
  subs.open((f) => void frames.push(f), 'books', '.book')
  return {
    g,
    subs,
    frames,
    failed,
    pause: () => paused = true,
    reads: () => reads,
    signal: () => signal,
  }
}

let retiring = fixture()
test('registry shutdown cancels a shared refresh and releases its graph hook', async () => {
  let f = retiring
  let errors: unknown[][] = []
  let original = console.error
  console.error = (...args) => void errors.push(args)
  try {
    f.pause()
    f.g.apply([{ entity: { eid: 'one' }, book: { price: 2 } }])
    let pending = f.subs.commit([])
    equal(f.signal()?.aborted, false)
    f.subs.stop()
    equal(f.signal()?.aborted, true)
    await pending
    let reads = f.reads(), frames = f.frames.length
    f.g.apply([{ entity: { eid: 'one' }, book: { price: 3 } }])
    await f.subs.commit([])
    equal(f.reads(), reads)
    equal(f.frames.length, frames)
    equal((await f.g.get(['one']))[0].book, { price: 3 })
    equal(errors, [])
    f.subs.stop()
  } finally {
    console.error = original
  }
})

let broken = fixture()
test('registry shutdown does not hide an unrelated in-flight read failure', async () => {
  let f = broken
  f.pause()
  let pending = f.subs.commit([{
    entity: { eid: 'one' },
    book: { price: 2 },
  }])
  let error = new Error('read failed independently')
  f.failed.reject(error)
  f.subs.stop()
  equal(await Promise.resolve(pending).catch((e) => e), error)
})

let host = (() => {
  let g = shopGraph()
  let stopping = new AbortController()
  let reading = Promise.withResolvers<void>()
  let written = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  let reports: unknown[] = []
  let signal: AbortSignal | undefined
  let serve = handler({
    graph: {
      ...g,
      apply: (bundles, opts) => {
        written.resolve()
        return release.promise.then(() => g.apply(bundles, opts))
      },
    },
    reader: {
      get: g.get,
      rows: g.rows,
      read: (_q, opts) => {
        signal = opts?.signal
        reading.resolve()
        return new Promise<never>((_resolve, reject) => {
          opts!.signal!.addEventListener(
            'abort',
            () => reject(opts!.signal!.reason),
          )
        })
      },
    },
    stopping: stopping.signal,
    who: () => null,
    routes: [],
    report: (error) => void reports.push(error),
  })
  let query = serve(req('/query?q=.book&live=1'))
  let write = serve(req('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: 'saved' }, book: { price: 7 } }]),
  }))
  return {
    g,
    stopping,
    reading,
    written,
    release,
    reports,
    query,
    write,
    signal: () => signal,
  }
})()
await Promise.all([host.reading.promise, host.written.promise])
test('host stop cancels a live query while an admitted write still commits', async () => {
  host.stopping.abort()
  equal(host.signal()?.aborted, true)
  equal((await host.query).status, 400)
  host.release.resolve()
  equal((await host.write).status, 200)
  equal((await host.g.get(['saved']))[0].book, { price: 7 })
  equal(host.reports, [])
})

let ended = subscriptions(shopGraph())
ended.stop()
test('a stopped registry refuses new watches', async () => {
  await assertRejects(
    () => Promise.resolve().then(() => ended.open(() => {}, 'late', '.book')),
    Refused,
  )
})

let saved = (() => {
  let vocab = loadVocab([...shop.docs, {
    $defs: {
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        save: '.book',
        properties: { x: { type: 'number' } },
      },
    },
  }])
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply([{ entity: { eid: 'one' }, book: { price: 1 } }])
  let release = Promise.withResolvers<void>()
  let started = Promise.withResolvers<void>()
  let signal: AbortSignal | undefined
  let subs = subscriptions({
    ...g,
    get: (ids, comps, opts) => {
      signal = opts?.signal
      started.resolve()
      return release.promise.then(() => g.get(ids, comps, opts))
    },
  })
  let saving = subs.relay(() => {}, [{
    entity: { eid: 'one' },
    position: { x: 9 },
  }])
  return { g, subs, saving, started, release, signal: () => signal }
})()
await saved.started.promise
test('registry shutdown preserves an admitted peer save through its eligibility read', async () => {
  saved.subs.stop()
  equal(saved.signal()?.aborted ?? false, false)
  saved.release.resolve()
  await saved.saving
  equal((await saved.g.get(['one']))[0].position, { x: 9 })
})
