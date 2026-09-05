/// <reference lib="deno.ns" />
// The assembly: one call, and a graph that renders at once, agrees with the
// server afterwards, and keeps what the server will never send back.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { box, boxClient, comp, COOK, server, titles } from './harness.ts'
import { client } from './client.ts'
import { stash } from './vault.ts'

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
  let there = srv.graph.storage.tx((tx) => tx.get(['r1'])) as Bundle[]
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
