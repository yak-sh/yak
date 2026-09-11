/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from '@std/assert'
import { boxGraph, pair } from './harness.ts'
import { land, snapshot } from './inbound.ts'
import { sync } from './sync.ts'
import { type Frame, wire } from './socket.ts'

Deno.test('low-level snapshots clear covered whole components, not other tiers or scopes', async () => {
  let g = boxGraph(true)
  await snapshot(g, [{
    entity: { eid: 'a' },
    recipe: { serves: 2, course: 'dinner' },
  }])
  await snapshot(g, [{ entity: { eid: 'a' } }], {
    coverage: { a: { recipe: true } },
  })
  assertEquals((await g.read('.recipe!')).length, 0)
})

Deno.test('unowned land/standalone sync reject projected and rider shapes rather than lose payloads', () => {
  let g = boxGraph(true)
  let socket = pair().client
  let errors: unknown[] = []
  let s = sync(g, {
    url: 'http://box.test',
    connect: () => socket,
    report: (t) => errors.push(t.error),
  })
  s.subscribe('.recipe', 'r')
  for (
    let shape of [{ coverage: {} }, { peerCoverage: {} }, { peers: [] }, {
      peerGone: [],
    }]
  ) {
    assertThrows(
      () => land(g, { id: 'r', ...shape }),
      Error,
      'working-set replica',
    )
    socket.emit('message', JSON.stringify({ id: 'r', ...shape }))
    assertEquals(s.ready('r'), false)
  }
  assertEquals(errors.length, 4)
  s.close()
})

Deno.test('socket resets replace membership on every ranking reset; peers never become gone hits', () => {
  let socket = pair().client
  let frames: Frame[] = []
  let w = wire({
    url: 'http://box.test',
    connect: () => socket,
    land: (f) => frames.push(f),
    report: (e) => {
      throw e
    },
  })
  w.subscribe('opaque', 'r')
  let row = (eid: string) => ({ entity: { eid }, recipe: {} })
  let send = (frame: Frame) => socket.emit('message', JSON.stringify(frame))
  send({ id: 'r', bundles: [row('a'), row('b')], peers: [row('peer')] })
  send({ id: 'r', reset: true, bundles: [row('b')] })
  assertEquals(frames.at(-1)!.gone, ['a'])
  send({ id: 'r', reset: true, bundles: [] })
  assertEquals(frames.at(-1)!.gone, ['b'])
  w.close()
})
