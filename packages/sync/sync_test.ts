/// <reference lib="deno.ns" />
// A client graph and a server graph in one process, with the transports
// pointed at each other: a write on one appears on the other, the server's
// answer reconciles the client, a refusal puts the client back, and a dropped
// socket catches up on what it missed. No network, no timers, no sleeps — the
// harness is the wire.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, dead, Refused } from '@yaks/graph'
import { at, boxGraph, client, comp, COOK, pair, server } from './testing.ts'
import { Dropped, wire } from './socket.ts'

let dal = (eid = 'r1'): Bundle => ({
  entity: { eid },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
})

test('a local apply lands on the server, minus what is local-tier', async () => {
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

// Capture the HTTP integrations at module load; cases check both the
// optimistic image and the authoritative answer without timing server boot.
let numberedServer = server()
// Two entities the client knows nothing about: a number the client guessed
// for the recipe would be one of theirs.
numberedServer.graph.apply([{ entity: { eid: 'x1' } }, {
  entity: { eid: 'x2' },
}])
let numberedClient = client(numberedServer)

numberedClient.graph.apply([dal()])
let optimisticNumber = at(numberedClient.graph, 'r1')?.entity.num
let optimisticWriter = comp(at(numberedClient.graph, 'r1'), 'created').by
await numberedClient.wire.idle()

test("the server's number and stamps land back on the client", () => {
  let srv = numberedServer
  let c = numberedClient
  assertEquals(optimisticNumber, undefined) // none until told
  assertEquals(optimisticWriter, undefined)
  let held = at(c.graph, 'r1')
  assertEquals(held?.entity.num, at(srv.graph, 'r1')?.entity.num)
  assertEquals(held?.entity.num, 3)
  // A stamp only the server could write: its door named the writer.
  assertEquals(comp(held, 'created').by, COOK)
  assert(comp(held, 'created').at)
  c.wire.close()
})

test('a second client sees the bundles, and a delete arrives as gone', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.recipe.course=dinner&?doc', 'dinners')
  await b.idle()

  a.graph.apply([dal()])
  await a.idle()
  assertEquals(comp(at(b.graph, 'r1'), 'doc').title, 'Dal')
  assertEquals(comp(at(b.graph, 'r1'), 'recipe').serves, 4)

  a.graph.apply([{ entity: { eid: 'r1' }, $delete: true }])
  await a.idle()
  // Gone from the set: the components are off it, and no query finds it.
  assertEquals(comp(at(b.graph, 'r1'), 'recipe'), {})
  assertEquals((b.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 0)
  a.wire.close()
  b.wire.close()
})

test('a subscriber hears an edit that pushes an entity out of the set', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.recipe.course=dinner', 'dinners')
  await b.idle()

  a.graph.apply([dal()])
  await a.idle()
  assertEquals((b.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 1)

  a.graph.apply([{ entity: { eid: 'r1' }, recipe: { course: 'pudding' } }])
  await a.idle()
  assertEquals((b.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 0)
  a.wire.close()
  b.wire.close()
})

test('a server refusal reverts the client and is reported', async () => {
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

  // Put back exactly as it stood: the property restored, the one this batch
  // introduced cleared.
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(c.graph, 'r1'), 'doc').body, undefined)
  assertEquals(comp(at(srv.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(c.trouble.length, 1)
  assertEquals(c.trouble[0].refused?.error, 'Refused')
  assertEquals(c.trouble[0].reverted, true)
  c.wire.close()
})

test('a refused store write keeps local and relayed values', async () => {
  let srv = server()
  srv.graph.use({
    name: 'the cook',
    hooks: {
      precondition: (bundles) => {
        if (
          bundles.some((b) =>
            (b.recipe as { serves?: number } | undefined)?.serves == 40
          )
        ) throw new Refused('a recipe serves at most 12')
        return bundles
      },
    },
  })
  let a = client(srv)
  let b = client(srv)
  a.wire.subscribe('.recipe.course=dinner', 'dinners')
  b.wire.subscribe('.recipe.course=dinner', 'dinners')
  a.graph.apply([dal()])
  await a.idle()
  await b.idle()

  a.graph.apply([{
    entity: { eid: 'r1' },
    recipe: { serves: 40 },
    pointing: { x: 3 },
    draft: { text: 'more cumin?' },
  }])
  await a.idle()

  assertEquals(comp(at(a.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(a.graph, 'r1'), 'pointing').x, 3)
  assertEquals(comp(at(b.graph, 'r1'), 'pointing').x, 3)
  assertEquals(comp(at(a.graph, 'r1'), 'draft').text, 'more cumin?')
  assertEquals(comp(at(srv.graph, 'r1'), 'pointing'), {})
  assertEquals(a.trouble[0].reverted, true)
  a.wire.close()
  b.wire.close()
})

let refusedNewEntity = (() => {
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
  return c
})()

refusedNewEntity.graph.apply([dal()])
await refusedNewEntity.wire.idle()

test('a refused write on an entity the server never had leaves it bare', () => {
  let c = refusedNewEntity
  assertEquals(comp(at(c.graph, 'r1'), 'recipe'), {})
  assertEquals(comp(at(c.graph, 'r1'), 'doc'), {})
  assertEquals((c.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 0)
  assertEquals(c.trouble[0].reverted, true)
  c.wire.close()
})

let refusedDelete = await (async () => {
  let srv = server()
  srv.graph.use({
    name: 'the cook',
    hooks: {
      precondition: (bundles) => {
        if (bundles.some(dead)) throw new Refused('recipes are forever')
        return bundles
      },
    },
  })
  let c = client(srv)
  c.graph.apply([dal()])
  await c.idle()

  return { srv, c }
})()

test('a delete waits for the server, and a refused one leaves the entity', async () => {
  let { srv, c } = refusedDelete
  c.graph.apply([{ entity: { eid: 'r1' }, $delete: true }])
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 4) // not optimistic
  await c.idle()
  assertEquals(comp(at(c.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(comp(at(srv.graph, 'r1'), 'recipe').serves, 4)
  assertEquals(c.trouble.length, 1)
  assertEquals(c.trouble[0].refused?.error, 'Refused')
  assertEquals(c.trouble[0].reverted, false)
  c.wire.close()
})

let stored = (() => {
  let g = boxGraph()
  g.apply([dal()])
  return g.storage.read('*') as Bundle[]
})()

let deletedServer = server()
deletedServer.graph.storage.tx((tx) => tx.patch(stored))
let deletedClient = client(deletedServer)
deletedClient.graph.storage.tx((tx) => tx.patch(stored))

deletedClient.graph.apply([{ entity: { eid: 'r1' }, $delete: true }])
let optimisticDeleted = comp(at(deletedClient.graph, 'r1'), 'recipe').serves
await deletedClient.wire.idle()

test("an accepted delete lands from the server's answer", () => {
  let srv = deletedServer
  let c = deletedClient
  assertEquals(optimisticDeleted, 4) // one round trip
  assertEquals(comp(at(c.graph, 'r1'), 'recipe'), {})
  assertEquals(comp(at(srv.graph, 'r1'), 'recipe'), {})
  assertEquals(c.trouble, [])
  c.wire.close()
})

test('a dropped socket resubscribes and catches up on what it missed', async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  b.wire.subscribe('.recipe.course=dinner', 'dinners')
  await b.idle()

  a.graph.apply([dal(), dal('r2')])
  await a.idle()
  assertEquals((b.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 2)

  // The socket goes; the client is deaf and does not know it.
  b.socket()!.close()
  assertEquals(b.wire.connected(), false)
  a.graph.apply([{ entity: { eid: 'r2' }, $delete: true }])
  a.graph.apply([dal('r3')])
  await a.idle()
  assertEquals((b.graph.read('.recipe.course=dinner&*') as Bundle[]).length, 2) // stale

  b.fire() // the one reconnect the backoff scheduled
  await b.idle()
  assert(b.wire.connected())
  assertEquals(b.trouble, []) // recovered, so nothing to say
  // The set as it now stands: the new one arrived, the deleted one left.
  assertEquals(
    (b.graph.read('.recipe.course=dinner&*') as Bundle[]).map((x) =>
      x.entity.eid
    )
      .sort(),
    ['r1', 'r3'],
  )
  a.wire.close()
  b.wire.close()
})

test('a connection that held is reopened at once, one that did not backs off', async () => {
  let srv = server()
  let c = client(srv)
  let reopened = async (ms: number) => {
    let before = srv.sockets.length
    c.pass(ms)
    await c.idle()
    return srv.sockets.length > before
  }
  c.wire.open()
  await c.idle()
  c.pass(1000)
  srv.sockets[0].close() // its server hands over to a replacement
  assert(await reopened(0))
  srv.sockets[1].close() // hung up as soon as it answered
  assert(!await reopened(249))
  assert(await reopened(1))
  c.wire.close()
})

test('what came from the server is never sent back to it', async () => {
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

test('a subscription refused by the server is reported, not applied', async () => {
  let srv = server()
  let c = client(srv)
  c.wire.subscribe('.nonsense=1', 'bad')
  await c.idle()
  assertEquals(c.trouble.length, 1)
  assert(c.trouble[0].refused)
  c.wire.close()
})

// A wire over sockets driven by hand, so its server can stay away, or take a
// connection and never answer on it, and its machine can lose its network.
// It holds one query, answered and held a second before each script begins.
let drops = () => {
  let now = 0
  let due: { at: number; fn: () => void }[] = []
  let sockets: ReturnType<typeof pair>[] = []
  let away = false
  let online = true
  let backs = new Set<() => void>()
  let said: unknown[] = []
  wire({
    url: 'http://drop.test',
    connect: () => sockets[sockets.push(pair()) - 1].client,
    time: () => now,
    timer: (fn, ms) => {
      due.push({ at: now + ms, fn })
      due.sort((a, b) => a.at - b.at)
    },
    network: {
      online: () => online,
      back: (fn) => (backs.add(fn), () => backs.delete(fn)),
    },
    land: () => {},
    report: (e) => said.push(e),
  }).subscribe('.recipe', 'q')
  let last = () => sockets[sockets.length - 1]
  let tell = (frame: object) =>
    last().server.send(JSON.stringify({ id: 'q', ...frame }))
  // A connection made while the server is away fails at once.
  let fail = () => {
    if (away && last().client.readyState == 0) last().client.close(1006)
  }
  let fire = () => {
    let next = due.shift()!
    now = Math.max(now, next.at)
    next.fn()
    fail()
  }
  let pass = (ms: number) => {
    let until = now + ms
    while (due.length && due[0].at <= until) fire()
    now = until
  }
  let steps: Record<string, (n: number) => void> = {
    drop: (code) => last().server.close(code),
    away: (ms) => {
      away = true
      fail()
      pass(ms)
      away = false
    },
    back: () => {
      while (last().client.readyState != 0) fire()
      last().client.emit('open')
    },
    // No network: every attempt fails, as the server being away does.
    offline: () => {
      online = false
      away = true
      fail()
    },
    online: () => {
      online = true
      away = false
      for (let fn of backs) fn()
    },
    answer: () => tell({ bundles: [] }),
    refuse: () => tell({ refused: { error: 'Refused', message: 'no word' } }),
    pass,
  }
  let run = (script: string) => {
    for (let step of script.split(' ')) {
      let [verb, n] = step.split(':')
      steps[verb](Number(n))
    }
    return said
  }
  run('back answer pass:1000')
  return run
}

// A drop is said only when the wire has not resumed from it `most` (30 s)
// after it began: open again, with every query answered again. A refusal is
// an answer, said on its own path. Each outage is said once, while it lasts,
// and none while the machine has no network: when it comes back the wire
// reopens at once, and only what follows is timed.
for (
  let [script, times] of [
    ['drop:1001 back answer', 0], // a restart
    ['drop:1006 back answer', 0], // a proxy, a laptop waking
    ['drop:1001 back refuse', 0], // a page that outlived a deploy
    ['drop:1006 away:10000 back answer', 0],
    ['drop:1006 away:120000', 1],
    ['drop:1001 back', 1],
    ['drop:1006 away:120000 back answer drop:1006 away:120000', 2],
    ['drop:1006 offline', 0], // a laptop with no network
    ['drop:1006 offline pass:60000 online back answer', 0],
    ['drop:1006 offline pass:60000 online', 1], // back, and the server is not
  ] as const
) {
  test(`a wire that does "${script}" is said dropped ${times} times`, () => {
    let said = drops()(`${script} pass:120000`)
    assertEquals(said.map((e) => e instanceof Dropped), Array(times).fill(true))
  })
}

// A Dropped's cause says what the wire was waiting on.
for (
  let [script, cause] of [
    ['drop:1006 away:120000', 'it has not reopened: 7 attempts'],
    [
      'drop:1006 offline pass:60000 online',
      'it has not reopened: 1 attempt, the last still connecting',
    ],
    [
      'drop:1001 back',
      'it reopened after 0.0 s, and 1 of 1 queries are not answered again: .recipe',
    ],
  ] as const
) {
  test(`a wire that does "${script}" says "${cause}"`, () => {
    let [said] = drops()(`${script} pass:120000`)
    assertEquals((said as Error).cause, cause)
  })
}

test('an oversized subscribe refuses once, never reopens, and does not erase painted rows', async () => {
  let srv = server()
  srv.graph.apply([{ entity: { eid: 'r1' }, recipe: { serves: 2 } }])
  let c = client(srv)
  try {
    c.wire.subscribe('.recipe', 'good')
    await c.idle()
    assert((await c.graph.get(['r1'])).length)
    c.wire.subscribe('.doc.title=' + 'x'.repeat(65536), 'large')
    await c.idle()
    c.pass(8000)
    await c.idle()
    assertEquals(srv.sockets.length, 1)
    assertEquals(c.socket()?.readyState, 1)
    assertEquals(c.trouble.length, 1)
    assertEquals(c.wire.refusal('large')?.error, 'Refused')
    assert((await c.graph.get(['r1'])).length)

    // A genuine later loss reopens healthy asks, at once since it held, not
    // the terminal refusal.
    srv.sockets[0].close()
    await c.idle()
    assertEquals(srv.sockets.length, 2)
    assertEquals(c.trouble.length, 1) // recovered: nothing more to say
    assertEquals(
      c.socket()?.sent.filter((m) => (m as { id?: string }).id == 'large'),
      [],
    )

    // Explicitly correcting the request is allowed on the same id.
    c.wire.subscribe('.recipe', 'large')
    await c.idle()
    assertEquals(c.wire.refusal('large'), undefined)
    assert(c.wire.ready('large'))
  } finally {
    c.wire.close()
  }
})

test('a malformed uncorrelated socket request is reported without reconnecting', async () => {
  let srv = server()
  let c = client(srv)
  try {
    c.wire.subscribe('.recipe', 'good')
    await c.idle()
    srv.sockets[0].emit('message', '{')
    await c.idle()
    assertEquals(c.trouble.length, 1)
    assertEquals((c.trouble[0].error as Error).name, 'SyntaxError')
    c.pass(8000)
    assertEquals(srv.sockets.length, 1)
    assertEquals(c.socket()?.readyState, 1)
  } finally {
    c.wire.close()
  }
})

test('an unreachable server reverts nothing: the batch may have landed', async () => {
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

// Two cooks watching dinners, the recipe already there, and `a` about to
// point at it.
let pointing = async () => {
  let srv = server()
  let a = client(srv)
  let b = client(srv)
  a.wire.subscribe('.recipe.course=dinner', 'dinners')
  b.wire.subscribe('.recipe.course=dinner', 'dinners')
  a.graph.apply([dal()])
  await a.idle()
  await b.idle()
  let finger = () => comp(at(b.graph, 'r1'), 'pointing')
  let point = async (xy: Record<string, number>) => {
    a.graph.apply([{ entity: { eid: 'r1' }, pointing: xy }])
    await a.idle()
  }
  return { srv, a, b, finger, point }
}

test("a peer's value reaches the others, and is stored nowhere", async () => {
  let { srv, a, b, finger, point } = await pointing()
  await point({ x: 3, y: 9 })
  assertEquals(finger(), { x: 3, y: 9 })
  await point({ y: 1 })
  assertEquals(finger(), { x: 3, y: 1 })
  assertEquals(comp(at(srv.graph, 'r1'), 'pointing'), {})
  // A stored write to the same entity leaves the finger where it was.
  a.graph.apply([{ entity: { eid: 'r1' }, recipe: { serves: 6 } }])
  await a.idle()
  assertEquals(comp(at(b.graph, 'r1'), 'recipe').serves, 6)
  assertEquals(finger(), { x: 3, y: 1 })
  a.wire.close()
  b.wire.close()
})

test("a peer's value goes with its connection", async () => {
  let { a, b, finger, point } = await pointing()
  await point({ x: 3, y: 9 })
  a.socket()!.close()
  await b.idle()
  assertEquals(finger(), {})
  a.wire.close()
  b.wire.close()
})

test('a late subscriber hears what is already being said', async () => {
  let { srv, a, b, point } = await pointing()
  await point({ x: 3, y: 9 })
  let c = client(srv)
  c.wire.subscribe('.recipe.course=dinner', 'dinners')
  await c.idle()
  assertEquals(comp(at(c.graph, 'r1'), 'pointing'), { x: 3, y: 9 })
  for (let x of [a, b, c]) x.wire.close()
})

test('a reconnect clears a value that stopped while it was away', async () => {
  let { a, b, finger, point } = await pointing()
  await point({ x: 3, y: 9 })
  b.socket()!.close() // deaf: the clearing below never reaches it
  a.socket()!.close()
  assertEquals(finger(), { x: 3, y: 9 })
  b.fire()
  await b.idle()
  assertEquals(finger(), {})
  a.wire.close()
  b.wire.close()
})

test('a reconnect keeps what this page is saying, and the others hear it again', async () => {
  let { a, b, finger, point } = await pointing()
  await point({ x: 3, y: 9 })
  a.socket()!.close()
  a.fire()
  await a.idle()
  await b.idle()
  assertEquals(comp(at(a.graph, 'r1'), 'pointing'), { x: 3, y: 9 })
  assertEquals(finger(), { x: 3, y: 9 })
  a.wire.close()
  b.wire.close()
})

// `a` scrolling through the recipe `b` is watching: `reading` is paced at
// 100ms. `said()` counts the relay messages `a` has sent, and `heard()` is
// where `b` last heard `a` was.
let reading = async () => {
  let { a, b } = await pointing()
  let read = (n: number | null) =>
    a.graph.apply([{
      entity: { eid: 'r1' },
      reading: n == null ? null : { line: n },
    }])
  let said = () =>
    a.socket()!.sent.filter((m) => (m as { relay?: unknown }).relay).length
  let heard = async () => {
    await a.idle()
    await b.idle()
    return comp(at(b.graph, 'r1'), 'reading')
  }
  let done = () => [a, b].forEach((x) => x.wire.close())
  return { a, read, said, heard, done }
}

test('a paced value is sent about once a pace, and the last always arrives', async () => {
  let { a, read, said, heard, done } = await reading()
  for (let n = 0; n < 60; n++) {
    read(n)
    assertEquals(comp(at(a.graph, 'r1'), 'reading'), { line: n }) // here, at once
    a.pass(1000 / 60)
  }
  a.pass(100)
  assert(said() >= 10 && said() <= 11, `${said()} sent in a second at 100ms`)
  assertEquals(await heard(), { line: 59 }) // stopped, and heard there
  done()
})

test('a clear is sent at once, and what it cleared never follows', async () => {
  let { a, read, said, heard, done } = await reading()
  read(1)
  read(2) // inside the pace: waiting
  assertEquals(await heard(), { line: 1 })
  read(null)
  assertEquals(await heard(), {})
  let sent = said()
  a.pass(1000)
  assertEquals([said(), await heard()], [sent, {}])
  done()
})

// Explicit submission of an already selected answer is also a public write seam.
let submitted = client(server())
let submittedAnswer = await submitted.wire.submit([dal()])
test('submit returns the authoritative selected bundles', () => {
  assertEquals(submittedAnswer[0].entity.eid, 'r1')
  assertEquals(comp(submittedAnswer[0], 'recipe').serves, 4)
  submitted.wire.close()
})
