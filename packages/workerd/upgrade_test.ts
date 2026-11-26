/// <reference lib="deno.ns" />
// The upgrade: a pair minted, the server half accepted and served, the client
// half handed back on the 101 — and a clear refusal anywhere that is not a
// Worker.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { api } from '@yaks/api'
import { installPair, made, req, shopGraph } from './testing.ts'
import { rehandshake, workerUpgrade } from './upgrade.ts'

let ws = () => req('/ws', { headers: { upgrade: 'websocket' } })

test('the server half is accepted and the client half answers 101', () => {
  let undo = installPair()
  try {
    let { socket, response } = workerUpgrade(ws())
    assertEquals(response.status, 101)
    assertEquals(made.length, 1)
    assert(made[0][1].accepted, 'the half the Worker keeps is accepted')
    assert(!made[0][0].accepted, 'the half the client gets is not')
    assertEquals(socket, made[0][1])
  } finally {
    undo()
  }
})

test('off a Worker it says so instead of failing obscurely', () => {
  assertThrows(
    () => workerUpgrade(ws()),
    Error,
    'no WebSocketPair here',
  )
})

test('a forwarded socket lets the next hop write its handshake headers', () => {
  let webSocket = {}
  let upgraded = Object.assign(
    new Response(null, {
      status: 101,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-accept': 'upstream',
        'sec-websocket-protocol': 'room',
      },
    }),
    { webSocket },
  )
  let forwarded = rehandshake(upgraded)
  assertEquals(forwarded.status, 101)
  assert(
    (forwarded as Response & { webSocket: unknown }).webSocket === webSocket,
  )
  assertEquals([...forwarded.headers], [['sec-websocket-protocol', 'room']])
  let ordinary = new Response('ok')
  assert(rehandshake(ordinary) === ordinary)
})

test('/ws through this upgrade serves subscriptions', async () => {
  let undo = installPair()
  try {
    let handler = api({ graph: shopGraph(), upgrade: workerUpgrade })
    assertEquals((await handler(ws())).status, 101)
    let socket = made[0][1]

    socket.emit(
      'message',
      JSON.stringify({ subscribe: '.book.price<20', id: 'c' }),
    )
    assertEquals(socket.taken().map(({ revision: _, ...f }) => f), [
      { id: 'c', bundles: [], coverage: {}, transientReset: [] },
    ])

    await handler(req('/apply', {
      method: 'POST',
      body: JSON.stringify([{ entity: { eid: 'b1' }, book: { price: 12 } }]),
    }))
    assertEquals(
      socket.taken().flatMap((f) => (f.bundles ?? []).map((b) => b.entity.eid)),
      ['b1'],
    )
  } finally {
    undo()
  }
})
