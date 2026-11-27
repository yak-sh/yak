import { whole } from '@yaks/query'
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { api } from '@yaks/api'
import { apiDoc } from '@yaks/api/vocab'
import { loadVocab } from '@yaks/vocab'
import { graph, signed } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { pair } from '../../packages/sync/testing.ts'
import { appVocab } from '../../workers/yak/vocab.ts'
import words from './vocab.json' with { type: 'json' }
import { parties } from './party.ts'
import { writer } from './chat.ts'
import { type Bundle, connect } from './net.ts'
import { asking, listed } from '@yaks/platform/listing'
import { seedDesigns } from './designs_fixture.ts'
import type { Frame } from './play.ts'

type Page = { party: ReturnType<typeof parties>; tick: () => unknown }

// One store in memory, and pages onto it: each plays one hero as its owner.
let world = async (
  fn: (
    page: (hero: string, owner: string, opts?: Opts) => Promise<Page>,
    store: ReturnType<typeof graph>,
  ) => Promise<void>,
) => {
  seedDesigns()
  let app = appVocab(words)
  let vocab = loadVocab([...app.docs, apiDoc], app.keywords)
  // SQLite in memory, whose connection keeps the write log a keyed write's
  // receipt is kept in.
  let db = open(':memory:')
  let rows = storage(db, vocab)
  rows.install()
  let store = graph({ vocab, storage: rows })
  let fetchBefore = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    let request = url instanceof Request ? url : new Request(url, init)
    let asked = new URL(request.url).search.slice(1).split('&')
      .map(decodeURIComponent).join('&')
    return Response.json(listed(await store.read(asking(whole(asked))), asked))
  }
  let close: (() => void)[] = []
  let page = async (hero: string, owner: string, opts: Opts = {}) => {
    if (!(await store.read(whole(`.entity.eid=${hero}&.player`))).length) {
      store.apply(signed([{ entity: { eid: hero }, player: {} }], {
        by: owner,
      }))
    }
    let socket = pair()
    let handler = api({
      graph: store,
      db,
      authenticate: () => ({ by: owner }),
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
    let opened = connect(new URL('http://party.test/'), vocab, {
      fetch: handler,
      connect: () => socket.client,
      timer: () => {},
    })
    close.push(opened.close)
    socket.server.emit('open')
    socket.client.emit('open')
    let net = opened.world()
    net.choose(hero)
    let party = parties(net, opts)
    party.me({
      person: owner,
      name: hero,
      role: null,
      reads: true,
      writes: true,
      signIn: null,
    })
    let frame = { body: null, sheet: { name: hero } } as unknown as Frame
    let p = { party, tick: () => party.tick(frame) }
    await until(() => (p.tick(), party.canJoin))
    return p
  }
  try {
    await fn(page, store)
  } finally {
    for (let stop of close) stop()
    globalThis.fetch = fetchBefore
  }
}
type Opts = Parameters<typeof parties>[1]

let both = (pages: Page[], done: () => boolean) =>
  until(() => (pages.forEach((p) => p.tick()), done()))

test('two heroes invite and accept through their pages into one party', () =>
  world(async (page, store) => {
    let heroes = { a: crypto.randomUUID(), b: crypto.randomUUID() }
    let owners = { a: crypto.randomUUID(), b: crypto.randomUUID() }
    let a = await page(heroes.a, owners.a), b = await page(heroes.b, owners.b)
    assertEquals(await a.party.invite(heroes.b), true)
    await both([a, b], () => b.party.invites.length == 1)
    let invite = b.party.invites[0]
    assertEquals(await b.party.accept(invite), true)
    await both(
      [a, b],
      () => a.party.members.length == 2 && b.party.members.length == 2,
    )
    assertEquals(a.party.group, b.party.group)
    assertEquals(
      a.party.members.map((m) => m.eid).sort(),
      [heroes.a, heroes.b].sort(),
    )
    assertEquals(b.party.invites, [])
    let replies = await store.read('.party_reply&*') as Bundle[]
    assertEquals(replies.map((r) => [writer(r), r.party_reply]), [[
      owners.b,
      {
        invite: invite.eid,
        to: heroes.b,
        accept: true,
      },
    ]])
  }))

test('a yaks.app friend is invited on every hero they play and by a link for a hero made later', () =>
  world(async (page) => {
    let heroes = {
      a: crypto.randomUUID(),
      b: crypto.randomUUID(),
      later: crypto.randomUUID(),
    }
    let owners = { a: crypto.randomUUID(), b: crypto.randomUUID() }
    let sent: [string, string | undefined][] = []
    let friendsOf = () => ({
      list: () => Promise.resolve({ kind: 'signed-out' as const }),
      invite: (to: string, path?: string) =>
        Promise.resolve(void sent.push([to, path])),
    })
    let a = await page(heroes.a, owners.a, { friendsOf })
    let b = await page(heroes.b, owners.b)
    assertEquals(await a.party.inviteFriend(owners.b), true)
    assertEquals(sent, [[owners.b, `?party=${heroes.a}`]])
    await both([a, b], () => b.party.invites.length == 1)
    assertEquals(b.party.invites[0].from, heroes.a)

    let later = await page(heroes.later, owners.b, { link: heroes.a })
    await both([a, later], () => later.party.invites.length == 1)
    let linked = later.party.invites[0]
    assertEquals([linked.from, linked.group], [heroes.a, a.party.group])
    assertEquals(await later.party.accept(linked), true)
    await both([a, later], () => a.party.members.length == 2)
    assertEquals(later.party.group, a.party.group)
    assertEquals(later.party.invites, [])
    assertEquals(a.party.together(owners.b), true)
  }))
