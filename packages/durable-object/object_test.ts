/// <reference lib="deno.ns" />
// The one object class: it opens once an instance and again after a failed
// open, answers a stopped door with how long to wait, rings its works from
// its alarm, and arms the alarm at the first entry on a new deploy.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { Durable, type Opened, type Spec } from './object.ts'
import { Stopped } from './ceiling.ts'
import { durable } from './testing.ts'

// An object at instant 1000 over the stand-in's storage, whose spec is
// `spec` with what it reported kept.
let object = (spec: Partial<Spec> & Pick<Spec, 'open'>) => {
  let storage = durable(), reported: string[] = []
  let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
  let made = new Durable(ctx, {
    report: (_e, entry) => void reported.push(entry),
    ...spec,
    alarm: { now: () => 1000, ...spec.alarm },
  })
  return { made, storage, reported }
}
let ok: Opened = { serve: () => new Response('ok') }
let get = (o: Durable) => o.fetch(new Request('https://do/'))

test('an object opens once, and again after an open that failed', async () => {
  let opens = 0
  let { made, reported } = object({
    open: () =>
      ++opens == 1 ? Promise.reject(Error('no')) : Promise.resolve(ok),
  })
  assertEquals((await get(made)).status, 503)
  assertEquals(await (await get(made)).text(), 'ok')
  await get(made)
  assertEquals([opens, reported], [2, ['fetch']])
})

test('a door stopped by the ceiling says how long to wait', async () => {
  let { made } = object({
    open: () =>
      Promise.resolve({
        serve: () => {
          throw new Stopped(5000, 'written')
        },
      }),
  })
  let answer = await get(made)
  assertEquals([answer.status, answer.headers.has('retry-after')], [429, true])
})

test('the alarm rings the works the object opened', async () => {
  let rang: number[] = []
  let { made, storage } = object({
    open: () =>
      Promise.resolve({
        ...ok,
        works: { a: (until) => (rang.push(until), 9000) },
      }),
    alarm: { slice: 50 },
  })
  await made.alarm()
  assertEquals([rang, await storage.getAlarm()], [[1050], 9000])
})

test('an alarm whose open failed is reported and rings again a minute on', async () => {
  let { made, storage, reported } = object({
    open: () => Promise.reject(Error('no')),
  })
  await made.alarm()
  assertEquals([reported, await storage.getAlarm()], [['alarm'], 61_000])
})

test('the first entry on a new deploy arms the alarm, once', async () => {
  let deploy = (version: string, storage = durable()) => {
    let ctx = { storage, acceptWebSocket() {}, getWebSockets: () => [] }
    return new Durable(ctx, {
      open: () => Promise.resolve(ok),
      report: () => {},
      version,
      alarm: { now: () => 1000 },
    })
  }
  let storage = durable()
  await get(deploy('a', storage))
  assertEquals(await storage.getAlarm(), 1000)
  await storage.deleteAlarm()
  await get(deploy('a', storage))
  assertEquals(await storage.getAlarm(), null)
  await get(deploy('b', storage))
  assertEquals(await storage.getAlarm(), 1000)
})

// A socket at the object, with what it was sent and how it was closed.
let socket = () => {
  let sent: string[] = [], closed: number[] = []
  let ws = {
    readyState: 1,
    send: (raw: string) => void sent.push(raw),
    close: (code: number) => void closed.push(code),
    serializeAttachment() {},
    deserializeAttachment: () => null,
  }
  return { ws, sent, closed }
}

// Sockets that keep what they were asked.
let heard = (asked: string[]) => ({
  accept: () => new Response(null),
  message: (_ws: unknown, data: unknown) => void asked.push(`frame ${data}`),
  close: () => void asked.push('close'),
  wake: () => {},
})

test('a socket the object does not admit is let go, its clock probe unanswered', async () => {
  let admitted = false, asked: string[] = []
  let { made } = object({
    open: () =>
      Promise.resolve({
        ...ok,
        admit: () => admitted,
        live: () => heard(asked),
      }),
  })
  let { ws, sent } = socket()
  await made.webSocketMessage(ws, '{"clock":5}')
  await made.webSocketMessage(ws, '{}')
  await made.webSocketError(ws, Error('gone'))
  assertEquals([sent, asked], [[], []])
  admitted = true
  await made.webSocketMessage(ws, '{"clock":5}')
  await made.webSocketMessage(ws, '{}')
  await made.webSocketError(ws, Error('gone'))
  assertEquals([sent.length, asked], [1, ['frame {}', 'close']])
})

test('a frame no sockets serve hangs its socket up, and the object reads around the rest', async () => {
  let live: ReturnType<typeof heard> | undefined, asked: string[] = []
  let { made } = object({
    open: () =>
      Promise.resolve({
        ...ok,
        live: () => live,
        frame: async (_ws, data, take) =>
          void asked.push(`${data} taken ${await take()}`),
      }),
  })
  let { ws, closed } = socket()
  await made.webSocketMessage(ws, '1')
  live = heard(asked)
  await made.webSocketMessage(ws, '2')
  assertEquals(closed, [1012])
  assertEquals(asked, ['1 taken false', 'frame 2', '2 taken true'])
})
