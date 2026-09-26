/// <reference lib="deno.ns" />
// The assembly: one call, and a graph that renders at once, agrees with the
// server afterwards, and keeps what the server will never send back.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { ids } from '@yaks/id/rules'
import { replicate } from '@yaks/sync'
import { box, boxClient, comp, COOK, server, titles } from './testing.ts'
import { client } from './client.ts'
import { stash } from './vault.ts'
import { wireStash } from './wire-vault.ts'

let dal = (eid = 'r1'): Bundle => ({
  entity: { eid },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
})

Deno.test('a client with no server is a whole graph on its own', () => {
  let c = boxClient()
  c.mutate([dal()])
  assertEquals(comp(c.ent('r1'), 'doc').title, 'Dal')
  assertEquals(titles(c.read('.course=dinner&?doc')), ['Dal'])
  assertEquals(c.wire, undefined)
  c.close()
})

let note = { entity: { eid: 'n1' }, note: { stars: 5, recipe: 'r1' } }

Deno.test('a read answers the rows a watch on the same query holds', () => {
  let c = boxClient()
  c.mutate([dal(), note])
  for (
    let q of ['.course=dinner', '.recipe&?doc', '.note.recipe=r1', '.doc&*']
  ) {
    let w = c.watch(q)
    assertEquals(c.read(q), w.value)
    w.close()
  }
  c.close()
})

Deno.test('a read resolves the id a person types', () => {
  let c = client(box, [ids(box)], { vault: false })
  replicate(c.graph, [
    { ...dal(), entity: { eid: 'r1', num: 7 } },
    { ...note, entity: { eid: 'n1', num: 8 } },
  ])
  assertEquals(c.read('.note.recipe=R-7').map((b) => b.entity.eid), ['n1'])
  c.close()
})

Deno.test('ent answers nothing for an entity this client never held', () => {
  let c = boxClient()
  assertEquals(c.ent('nobody'), undefined)
  c.close()
})

Deno.test('a write lands locally first, then on the server', async () => {
  let srv = server()
  let c = boxClient(srv)
  c.mutate([{ ...dal(), draft: { text: 'more cumin?' } }])

  // Before anything crossed the wire.
  assertEquals(comp(c.ent('r1'), 'recipe').serves, 4)

  await c.idle()
  let there = srv.graph.get(['r1']) as Bundle[]
  assertEquals(comp(there[0], 'doc').title, 'Dal')
  assertEquals(comp(there[0], 'draft'), {}) // local: it never left
  // The stamp only the server could write, reconciled back.
  assertEquals(comp(c.ent('r1'), 'created').by, COOK)
  assertEquals(c.trouble, [])
  c.close()
})

Deno.test("a caller's plugin runs on the client graph", () => {
  let seen: string[] = []
  let c = client(box, [{
    name: 'the cook',
    hooks: {
      effect: (bundles) => {
        for (let b of bundles) seen.push(b.entity.eid)
        return bundles
      },
    },
  }], { vault: false })
  c.mutate([dal()])
  assertEquals([...new Set(seen)], ['r1'])
  c.close()
})

Deno.test('close stops the watches and the socket', async () => {
  let srv = server()
  let c = boxClient(srv, { vault: stash() })
  c.watch('.course=dinner')
  await c.idle()

  c.close()
  assertEquals(c.watches.size(), 0)
  assertEquals(c.wire?.connected(), false)
})

Deno.test("a watch sees a peer's value, and nothing stores it", async () => {
  let srv = server()
  let disk = wireStash()
  let a = boxClient(srv)
  let b = boxClient(srv, { wireVault: disk, epoch: 'boot' })
  await b.ready
  let dinners = b.watch('.course=dinner&?pointing')
  a.watch('.course=dinner')
  a.mutate([dal()])
  await a.idle()
  await b.idle()
  a.mutate([{ entity: { eid: 'r1' }, pointing: { x: 3, y: 9 } }])
  await a.idle()
  assertEquals(comp(dinners.value[0], 'pointing'), { x: 3, y: 9 })
  a.mutate([{ entity: { eid: 'r1' }, recipe: { serves: 6 } }])
  await a.idle()
  await b.idle()
  assertEquals(comp(b.ent('r1'), 'recipe').serves, 6)
  assertEquals(comp(dinners.value[0], 'pointing'), { x: 3, y: 9 })
  await b.cache.idle()
  let [kept] = await disk.load('boot', 10)
  assertEquals(kept.comps.recipe?.serves, 6)
  assertEquals(kept.comps.pointing, undefined)
  a.close()
  await b.idle()
  assertEquals(comp(b.ent('r1'), 'pointing'), {})
  b.close()
})

Deno.test('a replica can leave provenance exclusively to its authority', () => {
  let c = client(box, [], { vault: false, provenance: () => null })
  try {
    c.mutate([dal()])
    assertEquals(c.ent('r1')?.created, undefined)
    assertEquals(c.ent('r1')?.updated, undefined)
    c.mutate([{ entity: { eid: 'r1' }, doc: { title: 'changed' } }])
    assertEquals(c.ent('r1')?.updated, undefined)
  } finally {
    c.close()
  }
})

// `a` pointing at the dinner `b` is watching. `seen()` is where `a` has its
// own finger, and where `b` last heard it was.
let pointing = async () => {
  let srv = server()
  let a = boxClient(srv), b = boxClient(srv)
  a.watch('.course=dinner')
  b.watch('.course=dinner&?pointing')
  a.mutate([dal()])
  let seen = async () => {
    for (let i = 0; i < 2; i++) await Promise.all([a.idle(), b.idle()])
    return [comp(a.ent('r1'), 'pointing'), comp(b.ent('r1'), 'pointing')]
  }
  let point = (xy: Record<string, number>) =>
    a.mutate([{ entity: { eid: 'r1' }, pointing: xy }])
  await seen()
  return { a, point, seen, done: () => [a, b].forEach((c) => c.close()) }
}

Deno.test('a watch opened later leaves what this page is saying', async () => {
  let { a, point, seen, done } = await pointing()
  point({ x: 3, y: 9 })
  await seen()
  a.watch('.recipe')
  assertEquals(await seen(), [{ x: 3, y: 9 }, { x: 3, y: 9 }])
  done()
})

Deno.test('a reconnect keeps what this page is saying, and the peers hear it again', async () => {
  let { a, point, seen, done } = await pointing()
  point({ x: 3, y: 9 })
  await seen()
  a.socket()!.close()
  a.fire()
  assertEquals(await seen(), [{ x: 3, y: 9 }, { x: 3, y: 9 }])
  done()
})

Deno.test("a page's newer value is never replaced by an older one of its own", async () => {
  let { a, point, seen, done } = await pointing()
  point({ x: 1, y: 1 })
  await seen()
  // The page loses its socket; the server still holds the old one open.
  let old = a.cut()!
  point({ x: 2, y: 2 })
  a.fire()
  assertEquals(await seen(), [{ x: 2, y: 2 }, { x: 2, y: 2 }])
  old.close() // and at last the server hears it
  assertEquals(await seen(), [{ x: 2, y: 2 }, { x: 2, y: 2 }])
  done()
})
