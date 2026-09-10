/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { boxGraph, pair } from './harness.ts'
import { sync } from './sync.ts'

Deno.test('ready waits for apply, and an old completion cannot confirm a new ask', async () => {
  let graph = boxGraph(true)
  let socket = pair().client
  let finish!: (bundles: Bundle[]) => void
  graph.apply = () => new Promise<Bundle[]>((ok) => finish = ok)
  let s = sync(graph, { url: 'http://box.test', connect: () => socket })
  let heard: boolean[] = []
  s.onReady((_id, ready) => heard.push(ready))
  s.subscribe('.recipe', 'r')
  socket.emit('open')
  socket.emit(
    'message',
    JSON.stringify({
      id: 'r',
      bundles: [{ entity: { eid: 'r1' }, recipe: { serves: 4 } }],
    }),
  )
  assertEquals(s.ready('r'), false)
  s.unsubscribe('r')
  s.subscribe('.recipe', 'r')
  finish([])
  await Promise.resolve()
  assertEquals(s.ready('r'), false)
  assertEquals(heard, [])
  socket.emit('message', JSON.stringify({ id: 'r', bundles: [] }))
  assertEquals(s.ready('r'), true)
  assertEquals(heard, [true])
  s.close()
  assertEquals(s.ready('r'), false)
  assertEquals(heard, [true, false])
  assertThrows(() => s.subscribe('.recipe'), Error, 'closed')
})

Deno.test('failed frame application reports failure without confirming readiness', async () => {
  let graph = boxGraph(true)
  let socket = pair().client
  let errors: unknown[] = []
  let reported = Promise.withResolvers<void>()
  graph.apply = () => Promise.reject(new Error('cannot apply'))
  let s = sync(graph, {
    url: 'http://box.test',
    connect: () => socket,
    report: (trouble) => {
      errors.push(trouble.error)
      reported.resolve()
    },
  })
  s.subscribe('.recipe', 'r')
  socket.emit('open')
  socket.emit(
    'message',
    JSON.stringify({
      id: 'r',
      bundles: [{ entity: { eid: 'r1' }, recipe: { serves: 4 } }],
    }),
  )
  await reported.promise
  assertEquals(s.ready('r'), false)
  assertEquals(errors.length, 1)
  s.close()
})

Deno.test('ready listeners detach and a successful apply confirms after completion', async () => {
  let graph = boxGraph(true)
  let socket = pair().client
  let finish!: (bundles: Bundle[]) => void
  graph.apply = () => new Promise<Bundle[]>((ok) => finish = ok)
  let s = sync(graph, { url: 'http://box.test', connect: () => socket })
  let heard: boolean[] = []
  let stop = s.onReady((_id, ready) => heard.push(ready))
  s.subscribe('.recipe', 'r')
  socket.emit('open')
  socket.emit(
    'message',
    JSON.stringify({
      id: 'r',
      bundles: [{ entity: { eid: 'r1' }, recipe: { serves: 4 } }],
    }),
  )
  assertEquals(s.ready('r'), false)
  finish([])
  await Promise.resolve()
  await Promise.resolve()
  assertEquals(s.ready('r'), true)
  assertEquals(heard, [true])
  stop()
  s.close()
  assertEquals(heard, [true])
})
