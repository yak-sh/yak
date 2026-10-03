/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert'
import { type Bundle } from '@yaks/graph'
import { test } from '@yaks/testing'
import { CHUNK } from './doors.ts'
import { api } from './route.ts'
import { comp, post, req, shopGraph } from './testing.ts'

let row = (i: number, cost: unknown = i): Bundle => ({
  entity: { eid: `b${i}` },
  oldbook: { cost },
})

for (let stream of [false, true]) {
  for (let check of [false, true]) {
    let mode = `${stream ? 'NDJSON' : 'JSON'}${check ? ' check' : ''}`
    let send = (bundles: Bundle[], version = true): Request => {
      let path = `/apply?${check ? 'check=1&' : ''}${
        version ? 'version=1' : ''
      }`
      return stream
        ? req(path, {
          method: 'POST',
          headers: { 'content-type': 'application/x-ndjson' },
          body: bundles.map((b) => JSON.stringify(b)).join('\n'),
        })
        : post(path, bundles)
    }
    let decode = async (response: Response): Promise<Bundle[]> =>
      stream
        ? (await response.text()).trim().split('\n').map((s) => JSON.parse(s))
        : await response.json()
    let shop = () => {
      let graph = shopGraph()
      graph.use({
        name: 'shop-version',
        reads: (opts) => opts.speaks?.shop == 1,
        answer: (_, bundles) =>
          bundles.map((b) => {
            if (b.book === undefined) return b
            let { book: _book, ...rest } = b
            return {
              ...rest,
              oldbook: b.book === null ? null : { cost: comp(b, 'book').price },
            }
          }),
      })
      let handler = api({
        graph,
        authenticate: () => ({ by: 'ada' }),
        read: (request) =>
          Promise.resolve(
            new URL(request.url).searchParams.get('version') == '1'
              ? { speaks: { shop: 1 } }
              : undefined,
          ),
        write: (request, bundles) => {
          if (new URL(request.url).searchParams.get('version') != '1') {
            return bundles
          }
          return bundles.map((b) => {
            let { oldbook: _oldbook, ...rest } = b
            return {
              ...rest,
              book: { price: comp(b, 'oldbook').cost },
              $actor: { by: 'villain' },
            }
          })
        },
      })
      return { graph, handler }
    }

    test(`${mode} applies request write context before authenticated signing`, async () => {
      let { graph, handler } = shop()
      let bundles = Array.from({ length: CHUNK + 2 }, (_, i) => row(i))
      let response = await handler(send(bundles))
      assertEquals(response.status, 200)
      let applied = await decode(response)
      assertEquals(applied.length, bundles.length)
      assertEquals(
        applied.map((b) => comp(b, 'oldbook').cost),
        bundles.map((_, i) => i),
      )
      assertEquals(
        applied.map((b) => comp(b, 'created').by),
        bundles.map(() => 'ada'),
      )
      assertEquals(
        (await graph.read('.book')).length,
        check ? 0 : bundles.length,
      )
      assertEquals(applied.some((b) => b.book !== undefined), false)
    })

    test(`${mode} answers old aliases and current writes in their caller's vocabulary`, async () => {
      let { graph, handler } = shop()
      let old = { ...row(1), entity: { eid: '$book' } }
      let [minted] = await decode(await handler(send([old])))
      assertEquals(minted.$alias, '$book')
      assertEquals(minted.entity.eid.startsWith('$'), false)
      assertEquals(comp(minted, 'oldbook'), { cost: 1 })
      let current = { entity: { eid: 'current' }, book: { price: 2 } }
      let [applied] = await decode(await handler(send([current], false)))
      assertEquals(comp(applied, 'book'), { price: 2 })
      assertEquals(applied.oldbook, undefined)
      assertEquals((await graph.read('.book')).length, check ? 0 : 2)
    })

    test(`${mode} rolls back a refused contextualized batch whole`, async () => {
      let { graph, handler } = shop()
      let bundles = Array.from({ length: CHUNK + 2 }, (_, i) => row(i))
      bundles[CHUNK + 1] = row(CHUNK + 1, 'invalid price')
      let response = await handler(send(bundles))
      assertEquals(response.status, stream ? 200 : 400)
      let refusal = stream
        ? (await decode(response)).at(-1)!
        : await response.json()
      assertEquals(refusal.error, 'Refused')
      if (stream) {
        assertEquals(refusal.line, CHUNK + 2)
        assertEquals(refusal.committed, CHUNK)
      }
      let stored = await graph.read('.book')
      assertEquals(stored.length, stream && !check ? CHUNK : 0)
      assertEquals(stored.some((b) => b.entity.eid == `b${CHUNK}`), false)
    })

    test(`${mode} keeps unversioned writes in the graph's own format`, async () => {
      let { graph, handler } = shop()
      let response = await handler(send([row(1)], false))
      assertEquals(response.status, stream ? 200 : 400)
      let refusal = stream
        ? (await decode(response)).at(-1)!
        : await response.json()
      assertEquals(refusal.error, 'Refused')
      assertEquals(await graph.read('.book'), [])
    })
  }
}
