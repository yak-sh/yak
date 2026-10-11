/// <reference lib="deno.ns" />
// A second graph writes the shared store without the serving graph's hooks.
// Subscription answers must still match what a fresh graph read sees.
import { clock, equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { type Frame, subscriptions } from './subs.ts'
import { handler } from './routes.ts'

let vocab = loadVocab({
  $defs: {
    job: { component: true, properties: {} },
    resolved: { component: true, properties: {} },
  },
})
let query = '.job ?resolved'
let ear = () => {
  let frames: Frame[] = []
  return {
    sink: (frame: Frame) => frames.push(frame),
    take: () => frames.splice(0),
  }
}
let fixture = () => {
  let store = ram(vocab)
  let writer = graph({ vocab, storage: store })
  let reader = graph({ vocab, storage: store })
  writer.apply([{ entity: { eid: 'job' }, job: {} }])
  let version = 0
  let options = { activity: reader, revision: () => version }
  let subs = subscriptions(reader, options)
  let first = ear()
  subs.open(first.sink, 'jobs', query)
  first.take()
  return {
    subs,
    first,
    change: (remove = false) => {
      writer.apply([
        remove
          ? { entity: { eid: 'job' }, $delete: true }
          : { entity: { eid: 'job' }, resolved: {} },
      ])
      version++
    },
  }
}

let reopened = fixture()
reopened.change()
test('a reopened query receives a mark written through another graph', () => {
  let next = ear()
  reopened.subs.open(next.sink, 'jobs', query)
  equal(next.take()[0].bundles?.[0].resolved, {})
})

let retained = fixture()
retained.subs.drop(retained.first.sink)
retained.change()
test('a retained query receives a mark written while it was closed', () => {
  let next = ear()
  retained.subs.open(next.sink, 'jobs', query)
  equal(next.take()[0].bundles?.[0].resolved, {})
})

let active = fixture()
active.change()
test('an active query receives an external mark without another write', () => {
  active.subs.check()
  let [frame] = active.first.take()
  equal(frame.reset, true)
  equal(frame.bundles?.[0].resolved, {})
  active.subs.check()
  equal(active.first.take(), [])
})

let deleted = fixture()
deleted.change(true)
test('an external deletion resets the active query to an empty answer', () => {
  deleted.subs.check()
  let [frame] = deleted.first.take()
  equal(frame.reset, true)
  equal(frame.bundles, [])
  let next = ear()
  deleted.subs.open(next.sink, 'jobs', query)
  equal(next.take()[0].bundles, [])
})

let polling = (() => {
  let time = clock(), stopping = new AbortController()
  let reads = 0, feeds = 0
  handler({
    graph: graph({ vocab, storage: ram(vocab) }),
    storage: { revision: () => ++reads },
    stopping: stopping.signal,
    who: () => null,
    routes: [],
  }, { timer: (fn, ms) => time.after(ms, fn), every: 5 })
  return { time, stopping, reads: () => reads }
})()
test('a host without a commit feed checks store revisions until it stops', async () => {
  let before = polling.reads()
  await polling.time.advance(5)
  equal(polling.reads(), before + 1)
  polling.stopping.abort()
  await polling.time.advance(5)
  equal(polling.reads(), before + 1)
})

let fed = (() => {
  let time = clock(), reads = 0
  handler({
    graph: graph({ vocab, storage: ram(vocab) }),
    storage: { revision: () => ++reads },
    who: () => null,
    routes: [],
    feed: () => () => {},
  }, { timer: (fn, ms) => time.after(ms, fn), every: 5 })
  return { time, reads: () => reads }
})()
test('a host with a commit feed never polls the store revision', async () => {
  await fed.time.advance(20)
  equal(fed.reads(), 0)
})

let feedOnly = (() => {
  let stopping = new AbortController()
  let feeds = 0
  handler({
    graph: graph({ vocab, storage: ram(vocab) }),
    stopping: stopping.signal,
    who: () => null,
    routes: [],
    feed: () => {
      feeds++
      return () => feeds--
    },
  })
  return { stopping, feeds: () => feeds }
})()
test('the host releases its commit feed without a store revision door', () => {
  equal(feedOnly.feeds(), 1)
  feedOnly.stopping.abort()
  equal(feedOnly.feeds(), 0)
})
