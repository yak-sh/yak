/// <reference lib="deno.ns" />
// The HTTP door: one JSON-RPC request in, one reply out, the actor taken from
// the door and nowhere else, and every other shape of request refused in its
// own words.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { Unauthorized } from '@yaks/api'
import { mcp } from './mount.ts'
import { comp, shopGraph } from './harness.ts'

let ada = { eid: 'm1' }

let post = (body: unknown) =>
  new Request('http://shop.test/mcp', {
    method: 'POST',
    body: JSON.stringify(body),
  })

let rpc = (method: string, params: Record<string, unknown> = {}) =>
  post({ jsonrpc: '2.0', id: 1, method, params })

let call = (name: string, args: Record<string, unknown> = {}) =>
  rpc('tools/call', { name, arguments: args })

Deno.test('the door answers the protocol, and signs what a tool writes', async () => {
  let graph = shopGraph()
  let door = mcp({ graph, authenticate: () => ada })

  let hello = await (await door(rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'shop', version: '0' },
  }))).json()
  assertEquals(hello.result.serverInfo.name, 'yaks')

  let listed = await (await door(rpc('tools/list'))).json()
  assert(listed.result.tools.length >= 4)

  let wrote = await door(call('graph_apply', {
    change: [{
      entity: { eid: 'b1' },
      book: { price: 12 },
      $actor: { by: 'villain' },
    }],
  }))
  assertEquals(wrote.status, 200)
  assertEquals(wrote.headers.get('content-type'), 'application/json')
  let said = await wrote.json()
  assertEquals(said.result.isError, undefined)

  let found: Bundle[] = await graph.read('.price=12')
  assertEquals(comp(found[0], 'created').by, 'm1')
})

Deno.test('a door that refuses to name a caller answers 401', async () => {
  let door = mcp({
    graph: shopGraph(),
    authenticate: () => {
      throw new Unauthorized('sign in first')
    },
  })
  let r = await door(rpc('tools/list'))
  assertEquals(r.status, 401)
  assertEquals((await r.json()).error, 'Unauthorized')
})

Deno.test('the door refuses what it does not serve', async () => {
  let door = mcp({ graph: shopGraph() })
  assertEquals((await door(new Request('http://shop.test/mcp'))).status, 405)
  assertEquals(
    (await door(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]))).status,
    400,
  )
  assertEquals((await door(post('not a request'))).status, 400)
  let broken = new Request('http://shop.test/mcp', {
    method: 'POST',
    body: '{',
  })
  assertEquals((await door(broken)).status, 400)
})

Deno.test('a notification is answered with nothing at all', async () => {
  let door = mcp({ graph: shopGraph() })
  let r = await door(
    post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  )
  assertEquals(r.status, 202)
})
