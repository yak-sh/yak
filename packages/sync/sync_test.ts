/// <reference lib="deno.ns" />
// A client graph and a server graph in one process, with the transports
// pointed at each other: a write on one appears on the other, the server's
// answer reconciles the client, a refusal puts the client back, and a dropped
// socket catches up on what it missed. No network, no timers, no sleeps — the
// harness IS the wire.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, Refused } from '@yaks/graph'
import { at, client, comp, COOK, server } from './harness.ts'

let dal = (eid = 'r1'): Bundle => ({
  entity: { eid },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
})

Deno.test('a local apply lands on the server, minus what is local-tier', async () => {
  let srv = server()
  let c = client(srv)
  c.graph.apply([{ ...dal(), draft: { text: 'more cumin?' } }])

  // Local first: the page has it before anything crossed the wire.
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(c.graph, 'r1'), 'draft').text, 'more cumin?')

  await c.idle()
  assertEquals(comp(at(srv.graph, 'r1'), 'doc').title, 'Dal')
  assertEquals(comp(at(srv.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(srv.graph, 'r1'), 'draft'), {}) // never left the client
  assertEquals(c.trouble, [])
  c.wire.close()
})

Deno.test("the server's number and stamps land back on the client", async () => {
  let srv = server()
  // Two entities the client knows nothing about, so the two graphs would
  // otherwise number the same recipe differently.
  srv.graph.apply([{ entity: { eid: 'x1' } }, { entity: { eid: 'x2' } }])
  let c = client(srv)

  c.graph.apply([dal()])
  assertEquals(at(c.graph, 'r1')?.entity.num, 1) // the client's own guess
  assertEquals(comp(at(c.graph, 'r1'), 'created').by, undefined)

  await c.idle()
  let held = at(c.graph, 'r1')
  assertEquals(held?.entity.num, at(srv.graph, 'r1')?.entity.num)
  assertEquals(held?.entity.num, 3)
  // A stamp only the server could write: its door named the writer.
  assertEquals(comp(held, 'created').by, COOK)
  assert(comp(held, 'created').at)
  c.wire.close()
})

Deno.test('a second client sees the bundles, and a delete arrives as gone', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.course=dinner', 'dinners')
  await b.idle()

  a.graph.apply([dal()])
  await a.idle()
  assertEquals(comp(at(b.graph, 'r1'), 'doc').title, 'Dal')
  assertEquals(comp(at(b.graph, 'r1'), 'recipe').serves, 4)

  a.graph.apply([{ entity: { eid: 'r1' }, $delete: true }])
  await a.idle()
  // Gone from the set: the components are off it, and no query finds it.
  assertEquals(comp(at(b.graph, 'r1'), 'recipe'), {})
  assertEquals((b.graph.read('.course=dinner') as Bundle[]).length, 0)
  a.wire.close()
  b.wire.close()
})

Deno.test('a subscriber hears an edit that pushes an entity out of the set', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.course=dinner', 'dinners')
  await b.idle()

  a.graph.apply([dal()])
  await a.idle()
  assertEquals((b.graph.read('.course=dinner') as Bundle[]).length, 1)

  a.graph.apply([{ entity: { eid: 'r1' }, recipe: { course: 'pudding' } }])
  await a.idle()
  assertEquals((b.graph.read('.course=dinner') as Bundle[]).length, 0)
  a.wire.close()
  b.wire.close()
})

Deno.test('a server refusal reverts the client and is reported', async () => {
  let srv = server()
  srv.graph.use({
    name: 'the cook',
    hooks: {
      precondition: (bundles) => {
        for (let b of bundles) {
          let r = b.recipe as { serves?: number } | undefined
          if (r?.serves != null && r.serves > 12) {
            throw new Refused('a recipe serves at most 12')
          }
        }
        return bundles
      },
    },
  })
  let c = client(srv)
  c.graph.apply([dal()])
  await c.idle()

  c.graph.apply([{
    entity: { eid: 'r1' },
    doc: { body: 'for the whole street' },
    recipe: { serves: 40 },
  }])
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 40) // optimistic
  await c.idle()

  // Put back exactly as it stood: the column restored, the one this batch
  // introduced cleared.
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(c.graph, 'r1'), 'doc').body, null)
  assertEquals(comp(at(srv.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(c.trouble.length, 1)
  assertEquals(c.trouble[0].refused?.error, 'Refused')
  assertEquals(c.trouble[0].reverted, true)
  c.wire.close()
})

Deno.test('a refused write on an entity the server never had leaves it bare', async () => {
  let srv = server()
  srv.graph.use({
    name: 'the cook',
    hooks: {
      precondition: () => {
        throw new Refused('the box is closed')
      },
    },
  })
  let c = client(srv)
  c.graph.apply([dal()])
  await c.idle()
  assertEquals(comp(at(c.graph, 'r1'), 'recipe'), {})
  assertEquals(comp(at(c.graph, 'r1'), 'doc'), {})
  assertEquals((c.graph.read('.course=dinner') as Bundle[]).length, 0)
  assertEquals(c.trouble[0].reverted, true)
  c.wire.close()
})

Deno.test('a dropped socket resubscribes and catches up on what it missed', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.course=dinner', 'dinners')
  await b.idle()

  a.graph.apply([dal(), dal('r2')])
  await a.idle()
  assertEquals((b.graph.read('.course=dinner') as Bundle[]).length, 2)

  // The socket goes; the client is deaf and does not know it.
  b.socket()!.close()
  assertEquals(b.wire.connected(), false)
  a.graph.apply([{ entity: { eid: 'r2' }, $delete: true }])
  a.graph.apply([dal('r3')])
  await a.idle()
  assertEquals((b.graph.read('.course=dinner') as Bundle[]).length, 2) // stale

  b.fire() // the one reconnect the backoff scheduled
  await b.idle()
  assert(b.wire.connected())
  // The set as it now stands: the new one arrived, the deleted one left.
  assertEquals(
    (b.graph.read('.course=dinner') as Bundle[]).map((x) => x.entity.eid)
      .sort(),
    ['r1', 'r3'],
  )
  a.wire.close()
  b.wire.close()
})

Deno.test('what came from the server is never sent back to it', async () => {
  let srv = server()
  let c = client(srv)
  c.wire.subscribe(true, 'all')
  await c.idle()
  let posts = 0
  let sent = srv.handler
  let counted = client({
    ...srv,
    handler: (request) => {
      if (new URL(request.url).pathname == '/apply') posts++
      return sent(request)
    },
  })
  counted.graph.apply([dal()])
  await counted.idle()
  await c.idle()
  // The write went out once; neither client posted the echo it heard back.
  assertEquals(posts, 1)
  assertEquals(comp(at(c.graph, 'r1'), 'doc').title, 'Dal')
  c.wire.close()
  counted.wire.close()
})

Deno.test('a subscription refused by the server is reported, not applied', async () => {
  let srv = server()
  let c = client(srv)
  c.wire.subscribe('.nonsense=1', 'bad')
  await c.idle()
  assertEquals(c.trouble.length, 1)
  assert(c.trouble[0].refused)
  c.wire.close()
})

Deno.test('an unreachable server reverts nothing: the batch may have landed', async () => {
  let srv = server()
  let c = client(srv)
  let g = c.graph
  // A door that never answers is not a door that said no.
  let broken = client({
    ...srv,
    handler: () => Promise.reject(new Error('offline')),
  })
  broken.graph.apply([dal()])
  await broken.idle()
  assertEquals(comp(at(broken.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(broken.trouble[0].reverted, false)
  assert(broken.trouble[0].error)
  assertEquals(comp(at(g, 'r1'), 'recipe'), {})
  c.wire.close()
  broken.wire.close()
})
