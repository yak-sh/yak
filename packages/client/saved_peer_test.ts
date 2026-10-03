/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Frame } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { client } from './mod.ts'
import { pair } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    avatar: { component: true },
    position: {
      component: true,
      sync: 'peers',
      durable: 'forever',
      save: '30s',
      pace: '100ms',
      properties: { x: { type: 'number' } },
    },
  },
})
let row = (x: number): Bundle => ({
  entity: { eid: 'a' },
  avatar: {},
  position: { x },
})
let page = () => {
  let socket = pair().client
  let c = client(vocab, [], {
    url: 'http://box.test',
    vault: false,
    wireVault: false,
    connect: () => socket,
    timer: () => {},
    fetch: () => Response.json([]),
  })
  let watch = c.watch('.avatar ?position')
  let frame = (bundles: Bundle[], extra: Partial<Frame> = {}) =>
    socket.emit('message', JSON.stringify({ id: 's1', bundles, ...extra }))
  socket.emit('open')
  return { c, watch, socket, frame }
}

test('a new page reads its saved peer position from the initial subscription snapshot', async () => {
  for (let i = 0; i < 2; i++) {
    let { c, watch, frame } = page()
    try {
      await c.ready
      assertEquals(c.ent('a'), undefined)
      frame([row(4)], { reset: true })
      await c.wire!.idle()
      assertEquals(watch.ready, true)
      assertEquals(watch.value[0].position, { x: 4 })
      assertEquals(c.ent('a')?.position, { x: 4 })
    } finally {
      c.close()
    }
  }
})

test('incoming saved rows preserve newer local movement still waiting for its relay pace', async () => {
  let { c, watch, socket, frame } = page()
  try {
    await c.ready
    frame([row(1)], { reset: true })
    await c.wire!.idle()
    await c.mutate([{ entity: { eid: 'a' }, position: { x: 2 } }])
    await c.mutate([{ entity: { eid: 'a' }, position: { x: 3 } }])
    let relays = socket.sent.filter((m) => (m as Frame).relay) as Frame[]
    assertEquals(relays.map((f) => f.relay?.[0].position), [{ x: 2 }])
    for (let reset of [false, true]) {
      frame([row(1)], { reset })
      await c.wire!.idle()
      assertEquals(c.ent('a')?.position, { x: 3 })
      assertEquals(watch.value[0].position, { x: 3 })
    }
  } finally {
    c.close()
  }
})
