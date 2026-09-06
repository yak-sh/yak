/// <reference lib="deno.ns" />
// The line-at-a-time door: a load too big to hold, applied in chunks through
// the same `apply()`, answered as each one commits — and a refusal that names
// the line its bundle was on and what had already landed.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { CHUNK } from './doors.ts'
import { api } from './route.ts'
import { comp, req, shopGraph } from './harness.ts'

let ada = { eid: 'm1' }

/** A handler over a fresh shop, the width of every batch that reached the
 * graph, and a hook to hold the nth one open. */
let shop = (hold: (nth: number) => Promise<void> | void = () => {}) => {
  let graph = shopGraph()
  let widths: number[] = []
  let apply = graph.apply
  graph.apply = async (change, opts) => {
    widths.push(change.length)
    await hold(widths.length)
    return await apply(change, opts)
  }
  return { handler: api({ graph, authenticate: () => ada }), widths }
}

let ndjson = (path: string, body: string) =>
  req(path, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-ndjson' },
  })

// deno-lint-ignore no-explicit-any
let rows = async (r: Response): Promise<any[]> =>
  (await r.text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

// The answer as it arrives: `take(n)` reads until n lines are in, and no
// further — which is what makes "the body started before the load finished"
// something a test can wait on.
let taking = (r: Response) => {
  let reader = r.body!.getReader()
  let decoder = new TextDecoder()
  let held = ''
  let out: unknown[] = []
  return async (n: number) => {
    while (out.length < n) {
      let { done, value } = await reader.read()
      if (done) break
      let parts = (held + decoder.decode(value, { stream: true })).split('\n')
      held = parts.pop()!
      for (let p of parts) if (p.trim()) out.push(JSON.parse(p))
    }
    return out
  }
}

/** n bundles, one per line. */
let load = (n: number, from = 1) =>
  Array.from(
    { length: n },
    (_, i) =>
      JSON.stringify({
        entity: { eid: `b${from + i}` },
        book: { price: from + i },
      }),
  )

let ask = (line: string) => req(`/query?q=${encodeURIComponent(line)}`)

Deno.test('a load lands in chunks, and a blank line is not a bundle', async () => {
  let { handler, widths } = shop()
  // A blank line between every bundle, and no newline at the end.
  let r = await handler(ndjson('/apply', load(120).join('\n\n')))
  assertEquals(r.status, 200)
  assertEquals(r.headers.get('content-type'), 'application/x-ndjson')
  let answered = await rows(r)
  assertEquals(answered.length, 120)
  assertEquals(widths, [CHUNK, CHUNK, 20])
  assertEquals(comp(answered[0] as Bundle, 'book'), { price: 1 })
  assertEquals(typeof answered[0].entity.num, 'number')
  assertEquals((await (await handler(ask('.price>0'))).json()).length, 120)
})

Deno.test('a refusal is the last line: which line, and what landed', async () => {
  let { handler } = shop()
  let r = await handler(ndjson(
    '/apply',
    [
      ...load(CHUNK), // lines 1…50 — one whole chunk, and it commits
      JSON.stringify({ entity: { eid: 'x1' }, book: { price: 1 } }),
      JSON.stringify({ entity: { eid: 'x2' }, book: { colour: 'red' } }),
      JSON.stringify({ entity: { eid: 'x3' }, book: { price: 3 } }),
    ].join('\n'),
  ))
  // A 200 with the refusal in the body: the first bundles were on the wire
  // before the bad line was read, so there is no status left to say it in.
  assertEquals(r.status, 200)
  let answered = await rows(r)
  assertEquals(answered.length, CHUNK + 1)
  let no = answered.at(-1)
  assertEquals(no.error, 'Refused')
  assert(no.message.includes('book.colour'), no.message)
  assertEquals(no.line, CHUNK + 2)
  assertEquals(no.committed, CHUNK)
  // Its chunk rolled back whole, and nothing after it was read.
  assertEquals((await (await handler(ask('.price>0'))).json()).length, CHUNK)
})

Deno.test('a line that is not JSON names itself', async () => {
  let { handler } = shop()
  let r = await handler(ndjson('/apply', `${load(1)[0]}\nnot json\n`))
  let no = (await rows(r)).at(-1)
  assertEquals(no.error, 'SyntaxError')
  assertEquals(no.line, 2)
  assertEquals(no.committed, 0)
})

Deno.test('each chunk is answered as it commits, not at the end', async () => {
  let third = Promise.withResolvers<void>()
  let { handler } = shop((nth) => (nth == 3 ? third.promise : undefined))
  let take = taking(await handler(ndjson('/apply', load(120).join('\n'))))
  // The third chunk is held open, so a door that answered at the end would
  // never reach this line: the body would not start until the whole load did.
  assertEquals((await take(100)).length, 100)
  third.resolve()
  assertEquals((await take(120)).length, 120)
})

Deno.test('an alias resolves within its own chunk and nowhere else', async () => {
  let { handler } = shop()
  let near = await handler(ndjson(
    '/apply',
    [
      JSON.stringify({ entity: { eid: '$ada' }, doc: { title: 'Ada' } }),
      JSON.stringify({
        entity: { eid: 'b1' },
        book: { price: 1, author: '$ada' },
      }),
    ].join('\n'),
  ))
  let answered = await rows(near)
  assertEquals(answered.length, 2)
  assertEquals(
    comp(answered[1] as Bundle, 'book').author,
    answered[0].entity.eid,
  )

  // The same two bundles a chunk apart: the second one's batch never mints it.
  let far = await handler(ndjson(
    '/apply',
    [
      JSON.stringify({ entity: { eid: '$zoe' }, doc: { title: 'Zoe' } }),
      ...load(CHUNK - 1, 100),
      JSON.stringify({
        entity: { eid: 'b2' },
        book: { price: 2, author: '$zoe' },
      }),
    ].join('\n'),
  ))
  let no = (await rows(far)).at(-1)
  assertEquals(no.error, 'Refused')
  assert(no.message.includes('$zoe'), no.message)
  assertEquals(no.line, CHUNK + 1)
  assertEquals(no.committed, CHUNK)
})
