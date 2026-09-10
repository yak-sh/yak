/// <reference lib="deno.ns" />
// The entrypoint: the api's three routes answered from a Worker's bindings,
// built once per isolate, with the socket upgrade already wired.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { door } from './door.ts'
import { installPair, made, post, req, shopGraph } from './harness.ts'
import { worker } from './worker.ts'

type Env = { DB: string }

let env: Env = { DB: 'shop' }

// A Worker over one bookshop, counting how often its api was built.
let shop = (opts: { required?: boolean } = {}) => {
  let graph = shopGraph()
  let builds = 0
  let w = worker<Env>({
    api: () => {
      builds++
      return {
        graph,
        authenticate: door({
          cookie: 'shop_session',
          verify: (token) => (token == 'ada' ? { eid: 'm1' } : null),
          required: opts.required,
        }),
      }
    },
  })
  return { w, graph, builds: () => builds }
}

let ada = { cookie: 'shop_session=ada' }
let body = async (r: Response) => await r.json()

Deno.test('a Worker answers apply and query over its bindings', async () => {
  let { w } = shop()
  let wrote = await w.fetch(
    post('/apply', [{ entity: { eid: 'b1' }, book: { price: 12 } }]),
    env,
  )
  assertEquals(wrote.status, 200)

  let read = await w.fetch(req('/query?q=.price%3C20'), env)
  let found: Bundle[] = await body(read)
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
})

Deno.test('the door names the writer of a request', async () => {
  let { w } = shop()
  await w.fetch(
    post('/apply', [{ entity: { eid: 'b1' }, book: { price: 12 } }]),
    env,
  )
  let anon: Bundle[] = await body(await w.fetch(req('/query?q=.price=12'), env))
  assert(!(anon[0].created as { by?: string })?.by, 'nobody signed it')

  await w.fetch(
    new Request('https://shop.test/apply', {
      method: 'POST',
      headers: ada,
      body: JSON.stringify([{ entity: { eid: 'b2' }, book: { price: 9 } }]),
    }),
    env,
  )
  let signed: Bundle[] = await body(
    await w.fetch(req('/query?q=.price=9'), env),
  )
  assertEquals((signed[0].created as { by?: string }).by, 'm1')
})

Deno.test('a required door refuses with the api refusal shape', async () => {
  let { w } = shop({ required: true })
  let r = await w.fetch(req('/query?q=.price%3C20'), env)
  assertEquals(r.status, 401)
  assertEquals((await body(r)).error, 'Unauthorized')
})

Deno.test('the api is built once for the isolate, not once a request', async () => {
  let { w, builds } = shop()
  await w.fetch(req('/query?q=.price%3C20'), env)
  await w.fetch(req('/query?q=.price%3C20'), env)
  await w.fetch(post('/apply', []), env)
  assertEquals(builds(), 1)

  // …and a Worker serving a second set of bindings builds a second time.
  await w.fetch(req('/query?q=.price%3C20'), { DB: 'other' })
  assertEquals(builds(), 2)
})

Deno.test('a build that throws is refused, and tried again next time', async () => {
  let tries = 0
  let w = worker<Env>({
    api: () => {
      tries++
      if (tries == 1) throw new Error('DB binding is missing')
      return { graph: shopGraph() }
    },
  })

  let refused = await w.fetch(req('/query?q=.price%3C20'), env)
  assertEquals(refused.status, 500)
  assertEquals((await body(refused)).message, 'DB binding is missing')

  assertEquals((await w.fetch(req('/query?q=.price%3C20'), env)).status, 200)
  assertEquals(tries, 2)
})

Deno.test('/ws upgrades through Cloudflare without being asked to', async () => {
  let undo = installPair()
  try {
    let { w } = shop()
    let r = await w.fetch(
      req('/ws', { headers: { upgrade: 'websocket' } }),
      env,
    )
    assertEquals(r.status, 101)
    assert(made[0][1].accepted)
  } finally {
    undo()
  }
})
