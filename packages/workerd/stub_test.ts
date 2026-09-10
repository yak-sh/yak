/// <reference lib="deno.ns" />
// The switchboard: a request handed to the object that holds a named graph,
// whole and unopened.

import { assertEquals } from '@std/assert'
import { namespace, post } from './harness.ts'
import { forward } from './stub.ts'

Deno.test('a request reaches the object for its name, unopened', async () => {
  let ns = namespace((name) => new Response(name))
  let batch = post('/apply', [{ entity: { eid: 'b1' }, book: { price: 12 } }])

  assertEquals(await (await forward(ns, 'ada', batch)).text(), 'ada')
  assertEquals(ns.seen.map((s) => s.name), ['ada'])

  let sent = ns.seen[0].request
  assertEquals(sent.method, 'POST')
  assertEquals(new URL(sent.url).pathname, '/apply')
  assertEquals(await sent.json(), [{
    entity: { eid: 'b1' },
    book: { price: 12 },
  }])
})

Deno.test('the same name is the same object, a different name another', async () => {
  let ns = namespace()
  await forward(ns, 'ada', post('/apply', []))
  await forward(ns, 'ada', post('/apply', []))
  await forward(ns, 'bo', post('/apply', []))
  assertEquals(ns.seen.map((s) => s.name), ['ada', 'ada', 'bo'])
})
