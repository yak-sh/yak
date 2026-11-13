/// <reference lib="deno.ns" />
// What a host gives its apply door as data: whom it trusts and how, today's
// authority to write, a constraint the batch broke answered as its own, and
// the tags it adds to what the door reports.

import { assertEquals } from '@std/assert'
import type { ApplyOpts, Graph } from '@yaks/graph'
import { test } from '@yaks/testing'
import { applier, type Applying } from './doors.ts'
import { faults, Unauthorized } from './refuse.ts'
import { api } from './route.ts'
import { post, shopGraph } from './testing.ts'

let TRUSTED = { 'x-trusted': '1' }
let book = [{ entity: { eid: '$b' }, doc: { title: 'Dune' } }]

// A door over a shop whose writes say which graph took them, and with what:
// the trusted one writes as server code.
let door = (o: Partial<Applying> = {}) => {
  let took: [string, ApplyOpts | undefined][] = []
  let g = shopGraph()
  let as = (name: string): Graph => ({
    ...g,
    apply: (bundles, opts) => (
      took.push([name, opts]),
        g.apply(bundles, { ...opts, trusted: name == 'kernel' })
    ),
  })
  let asked: string[] = []
  let d = applier({
    graph: as('caller'),
    authenticate: () => {
      throw new Unauthorized()
    },
    trust: (r) =>
      r.headers.has('x-trusted')
        ? { graph: as('kernel'), actor: null }
        : undefined,
    authorize: (r) => asked.push(new URL(r.url).pathname),
    ...o,
  })
  let send = async (path: string, headers = {}) => {
    let r = post(path, book)
    for (let [k, v] of Object.entries(headers)) r.headers.set(k, v as string)
    return (await d.apply(r)).status
  }
  return { d, took, asked, send }
}

test('a trusted write goes through the graph its host trusts it with, unasked who it is', async () => {
  let { took, send } = door()
  assertEquals(await send('/apply', TRUSTED), 200)
  assertEquals(took.map(([name]) => name), ['kernel'])
})

test("only a trusted write keeps the last write's provenance", async () => {
  let { took, send } = door({ authenticate: () => null })
  assertEquals(await send('/apply?stamp=0', TRUSTED), 200)
  assertEquals(await send('/apply?stamp=0'), 200)
  assertEquals(took.map(([name, o]) => [name, o?.stamp]), [
    ['kernel', false],
    ['caller', undefined],
  ])
  // A door that trusts nobody knows no such option.
  assertEquals(await door({ trust: undefined }).send('/apply?stamp=0'), 400)
})

test('a caller the host does not trust is signed by authenticate, and refused by it', async () => {
  let { took, send } = door()
  assertEquals(await send('/apply'), 401)
  assertEquals(took, [])
})

test('a trusted request holds the authority to write; any other is asked', async () => {
  let { d, asked } = door()
  let trusted = post('/kernel', [])
  trusted.headers.set('x-trusted', '1')
  await d.authorize(trusted)
  await d.authorize(post('/person', []))
  assertEquals(asked, ['/person'])
})

test('a batch that breaks a constraint is refused, not a server failure', async () => {
  let g = shopGraph()
  let d = applier({
    graph: {
      ...g,
      apply: () => {
        throw new Error('UNIQUE constraint failed: doc.title')
      },
    },
  })
  assertEquals((await d.apply(post('/apply', book))).status, 400)
})

// A write the graph fails, sent through a door built with the host's tags,
// as the host's reporter hears it.
let failed = async (
  through: (o: Applying) => (r: Request) => Response | Promise<Response>,
  request: Request,
) => {
  let told: [string, unknown][] = []
  let off = faults((_e, where, tags) => told.push([where, tags]))
  try {
    let g = shopGraph()
    let broken: Graph = {
      ...g,
      apply: () => {
        throw new Error('disk gone')
      },
    }
    await (await through({ graph: broken, tags: () => ({ store: 's' }) })(
      request,
    )).text()
  } finally {
    off()
  }
  return told.map(([where, tags]) => [where.replace(/ \(request .*/, ''), tags])
}

test("a failure the door reports carries its host's tags", async () => {
  let ndjson = () =>
    new Request('http://test/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: JSON.stringify(book[0]),
    })
  let said = [['POST /apply', { store: 's' }]]
  assertEquals(
    await failed((o) => applier(o).apply, post('/apply', book)),
    said,
  )
  assertEquals(await failed(api, post('/apply', book)), said)
  assertEquals(await failed((o) => applier(o).apply, ndjson()), said)
})
