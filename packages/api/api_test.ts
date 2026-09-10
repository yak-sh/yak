/// <reference lib="deno.ns" />
// The route table, end to end: a batch in and back out, a query answered, the
// door's own actor on every write, and each refusal at its own status.

import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph'
import type { Authenticate } from './actor.ts'
import { api } from './route.ts'
import { Unauthorized } from './refuse.ts'
import { comp, post, req, shopGraph } from './harness.ts'

let ada = { eid: 'm1' }

// A handler over a fresh shop, with `ada` at the keyboard unless told
// otherwise, and the member she is already in the graph.
let shop = (authenticate: Authenticate = () => ada) => {
  let graph = shopGraph()
  graph.apply([{ entity: ada, doc: { title: 'Ada Card' } }])
  return api({ graph, authenticate })
}

let body = async (r: Response) => await r.json()
let ask = (line: string) => req(`/query?q=${encodeURIComponent(line)}`)

for (let async of [false, true]) {
  for (let method of ['GET', 'POST']) {
    Deno.test(`${method} /query logs ${async ? 'async' : 'sync'} failures with door context`, async () => {
      let graph = shopGraph()
      let error = new Error('too many terms in compound SELECT')
      graph.read = () => {
        if (async) return Promise.reject(error)
        throw error
      }
      let handler = api({ graph })
      using logged = stub(console, 'error')
      let response = await handler(
        method == 'GET'
          ? ask('.title=private-query-value')
          : post('/query', { q: '.title=private-query-value' }),
      )
      assertEquals(response.status, 500)
      assertEquals(await response.json(), {
        error: 'Error',
        message: error.message,
      })
      assertEquals(logged.calls.map((c) => c.args), [
        [`${method} /query failed —`, error],
      ])
    })
  }
}

Deno.test('expected client refusals do not log server errors', async () => {
  using logged = stub(console, 'error')
  assertEquals(
    (await shop(() => {
      throw new Unauthorized()
    })(ask(''))).status,
    401,
  )
  assertEquals((await shop()(post('/query', '{'))).status, 400)
  assertEquals(logged.calls.length, 0)
})

Deno.test('/apply logs failed post-commit effects while preserving its successful response', async () => {
  let graph = shopGraph()
  let error = new Error('observer failed')
  graph.use({
    name: 'shelf',
    hooks: {
      effect: () => {
        throw error
      },
    },
  })
  let handler = api({ graph })
  using logged = stub(console, 'error')
  let response = await handler(post('/apply', [{
    entity: { eid: 'b1' },
    book: { price: 12 },
  }]))
  assertEquals(response.status, 200)
  assertEquals(comp((await response.json())[0], 'book'), { price: 12 })
  assertEquals(logged.calls.map((c) => c.args), [
    ['shelf failed at effect —', error],
  ])
  assertEquals((await graph.read('.price=12')).length, 1)
})

Deno.test('a batch applied comes back as it landed, and reads back', async () => {
  let handler = shop()
  let wrote = await handler(post('/apply', [
    { entity: { eid: 'b1' }, doc: { title: 'Spring' }, book: { price: 12 } },
  ]))
  assertEquals(wrote.status, 200)
  let applied: Bundle[] = await body(wrote)
  // One bundle for the one entity: its patch, its number and the stamp the
  // door's own actor made — and nothing the pipeline said (T-34294).
  assertEquals(applied.length, 1)
  assertEquals(applied[0].entity.eid, 'b1')
  assertEquals(typeof applied[0].entity.num, 'number')
  assertEquals(comp(applied[0], 'book'), { price: 12 })
  assertEquals(comp(applied[0], 'doc'), { title: 'Spring' })
  assertEquals(comp(applied[0], 'created').by, 'm1')
  assertEquals(applied[0].$actor, undefined)

  let read = await handler(ask('.price<20'))
  assertEquals(read.status, 200)
  let found: Bundle[] = await body(read)
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
  assertEquals(comp(found[0], 'doc').title, 'Spring')
})

Deno.test('POST /query reads the same line', async () => {
  let handler = shop()
  await handler(
    post('/apply', [{ entity: { eid: 'b1' }, book: { price: 12 } }]),
  )
  let found: Bundle[] = await body(
    await handler(post('/query', { q: '.price<20' })),
  )
  assertEquals(found.map((b) => b.entity.eid), ['b1'])
})

Deno.test('the door signs the batch, never the client', async () => {
  let handler = shop()
  await handler(post('/apply', [
    // the client claims someone else wrote this
    { entity: { eid: 'b1' }, book: { price: 12 }, $actor: { by: 'villain' } },
  ]))
  let found: Bundle[] = await body(await handler(ask('.price=12')))
  assertEquals(comp(found[0], 'created').by, 'm1')
})

Deno.test('an unattributed door leaves the actor off', async () => {
  let handler = shop(() => null)
  await handler(post('/apply', [
    { entity: { eid: 'b1' }, book: { price: 12 }, $actor: { by: 'villain' } },
  ]))
  let found: Bundle[] = await body(await handler(ask('.price=12')))
  assertEquals(comp(found[0], 'created').by, null)
})

Deno.test('a refused column answers 400 in the shape apply threw', async () => {
  let handler = shop()
  let r = await handler(post('/apply', [
    { entity: { eid: 'b1' }, book: { colour: 'red' } },
  ]))
  assertEquals(r.status, 400)
  let said = await body(r)
  assertEquals(said.error, 'Refused')
  assert(said.message.includes('book.colour'))
})

Deno.test('a moved precondition answers 409, naming what it holds now', async () => {
  let handler = shop()
  await handler(
    post('/apply', [{ entity: { eid: 'b1' }, book: { price: 12 } }]),
  )
  let r = await handler(post('/apply', [{
    entity: { eid: 'b1' },
    book: { price: 20 },
    $was: { book: { price: token(99) } },
  }]))
  assertEquals(r.status, 409)
  assertEquals(await body(r), {
    error: 'Stale',
    message: 'book.price of b1 has moved since it was read',
    eid: 'b1',
    comp: 'book',
    column: 'price',
    current: 12,
  })
})

Deno.test('/apply?check=1 answers the batch it would take, and keeps none of it', async () => {
  let handler = shop()
  let asked = await handler(post('/apply?check=1', [
    { entity: { eid: 'b1' }, doc: { title: 'Spring' }, book: { price: 12 } },
  ]))
  assertEquals(asked.status, 200)
  let applied: Bundle[] = await body(asked)
  assertEquals(comp(applied[0], 'book'), { price: 12 })
  assertEquals(await body(await handler(ask('.price<20'))), [])
  // And a batch it would refuse is refused at the same status a commit is.
  let no = await handler(post('/apply?check=1', [{
    entity: { eid: 'b1' },
    book: { price: 20 },
    $was: { book: { price: token(99) } },
  }]))
  assertEquals(no.status, 409)
})

Deno.test('a body that is not a batch is refused', async () => {
  let r = await shop()(post('/apply', { entity: { eid: 'b1' } }))
  assertEquals(r.status, 400)
  assertEquals((await body(r)).error, 'Refused')
})

Deno.test('/query needs a query', async () => {
  let r = await shop()(req('/query'))
  assertEquals(r.status, 400)
})

Deno.test('the route table refuses what it does not serve', async () => {
  let handler = shop()
  assertEquals((await handler(req('/apply'))).status, 405)
  assertEquals((await handler(req('/query', { method: 'DELETE' }))).status, 405)
  assertEquals((await handler(req('/ws'))).status, 405)
  let missing = await handler(req('/books'))
  assertEquals(missing.status, 404)
  assertEquals((await body(missing)).error, 'NotFound')
})

Deno.test('a door that refuses to name a writer answers 401', async () => {
  let handler = shop(() => {
    throw new Unauthorized('sign in first')
  })
  let r = await handler(post('/apply', [{ entity: { eid: 'b1' } }]))
  assertEquals(r.status, 401)
  assertEquals(await body(r), {
    error: 'Unauthorized',
    message: 'sign in first',
  })
})
