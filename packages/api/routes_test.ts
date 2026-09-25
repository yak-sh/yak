/// <reference lib="deno.ns" />
import { assertEquals } from '@std/assert'
import type { Filter } from './route.ts'
import { handler } from './routes.ts'
import { req, shopGraph } from './testing.ts'

class Denied extends Error {
  override name = 'Denied'
}

// A host with one route at `/hello`, behind `filters`.
let host = (filters: Filter[]) =>
  handler({
    graph: shopGraph(),
    who: () => null,
    routes: [{
      method: 'GET',
      path: '/hello',
      handle: () => new Response('hi'),
    }],
    filters,
  })

let status = async (h: ReturnType<typeof host>, path: string) =>
  (await h(req(path))).status

Deno.test('a filter that throws answers the request, and nothing behind it runs', async () => {
  let asked: string[] = []
  let h = host([
    (r) => void asked.push(new URL(r.url).pathname),
    (r) => {
      if (new URL(r.url).pathname == '/hello') throw new Denied('not you')
    },
  ])
  let res = await h(req('/hello'))
  assertEquals(res.status, 403)
  assertEquals((await res.json()).message, 'not you')
  assertEquals(await status(h, '/query?q=.price'), 200)
  assertEquals(asked, ['/hello', '/query'])
})

Deno.test('with no filter, every route and door answers as before', async () => {
  let h = host([])
  assertEquals(await (await h(req('/hello'))).text(), 'hi')
  assertEquals(await status(h, '/query?q=.price'), 200)
  assertEquals(await status(h, '/nowhere'), 404)
})
