import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { api } from '@yaks/api'
import { graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { pair } from '../../packages/sync/testing.ts'
import { appVocab } from '../../workers/yak/vocab.ts'
import words from './vocab.json' with { type: 'json' }
import { parties } from './party.ts'
import { writer } from './chat.ts'
import { type Bundle, connect } from './net.ts'
import { asking, listed } from '../../workers/yak/listing.ts'
import { seedDesigns } from './designs_fixture.ts'
import type { Frame } from './play.ts'

test('two heroes invite and accept through their pages into one party', async () => {
  seedDesigns()
  let vocab = appVocab(words)
  let store = graph({ vocab, storage: ram(vocab) })
  let heroes = { a: crypto.randomUUID(), b: crypto.randomUUID() }
  for (let id of ['a', 'b'] as const) {
    store.apply(signed([{
      entity: { eid: heroes[id] },
      player: {},
    }], { by: `owner-${id}` }))
  }
  let fetchBefore = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    let request = url instanceof Request ? url : new Request(url, init)
    let asked = new URL(request.url).search.slice(1).split('&')
      .map(decodeURIComponent).join('&')
    return Response.json(listed(await store.read(asking(asked)), asked))
  }
  let close: (() => void)[] = []
  try {
    let pages: { party: ReturnType<typeof parties>; tick: () => unknown }[] = []
    for (let id of ['a', 'b'] as const) {
      let socket = pair()
      let handler = api({
        graph: store,
        authenticate: () => ({ by: `owner-${id}` }),
        socketTimer: () => {},
        upgrade: () => ({
          socket: socket.server,
          response: new Response(null, { status: 101 }),
        }),
      })
      await handler(
        new Request('http://party.test/ws', {
          headers: { upgrade: 'websocket' },
        }),
      )
      let page = connect(new URL('http://party.test/'), vocab, {
        fetch: handler,
        connect: () => socket.client,
        timer: () => {},
      })
      close.push(page.close)
      socket.server.emit('open')
      socket.client.emit('open')
      let net = page.world()
      net.choose(heroes[id])
      let party = parties(net)
      party.me({
        person: `owner-${id}`,
        name: id,
        role: null,
        reads: true,
        writes: true,
        signIn: null,
      })
      let frame = { body: null, sheet: { name: id } } as unknown as Frame
      pages.push({ party, tick: () => party.tick(frame) })
    }
    let [a, b] = pages
    let tick = () => pages.forEach((p) => p.tick())
    await until(() => (tick(), a.party.canJoin && b.party.canJoin))
    assertEquals(await a.party.invite(heroes.b), true)
    await until(() => (tick(), b.party.invites.length == 1))
    let invite = b.party.invites[0]
    assertEquals(await b.party.accept(invite), true)
    await until(
      () => (tick(),
        a.party.members.length == 2 && b.party.members.length == 2),
    )
    assertEquals(a.party.group, b.party.group)
    assertEquals(
      a.party.members.map((m) => m.eid).sort(),
      [heroes.a, heroes.b].sort(),
    )
    assertEquals(b.party.invites, [])
    let replies = await store.read('.party_reply&*') as Bundle[]
    assertEquals(replies.map((r) => [writer(r), r.party_reply]), [[
      'owner-b',
      {
        invite: invite.eid,
        to: heroes.b,
        accept: true,
      },
    ]])
  } finally {
    for (let stop of close) stop()
    globalThis.fetch = fetchBefore
  }
})
