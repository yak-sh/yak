/// <reference lib="deno.ns" />
// The assembly: one call, and a graph that renders at once, agrees with the
// server afterwards, and keeps what the server will never send back.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
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
  assertEquals(titles(c.read('.course=dinner')), ['Dal'])
  assertEquals(c.wire, undefined)
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
