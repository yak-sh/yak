// The page graph's door (reach-door.ts): a signed-in tab reads and writes
// across every store its person reaches, as its own session, and a tab drawn
// for someone else writes nothing.
import { clock, equal, test, until } from '@yaks/testing'
import type { Frame } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { REACH, TAB_PERSON } from '@yaks/platform/routes'
import {
  UPDATE_WAITING,
  waitingCounts,
  waitingWords,
} from '@yaks/platform/update-waiting'
import { bindSide } from '@yaks/platform/side-browser'
import { section, sideParts, type SideView } from '@yaks/platform/side-parts'
import { SIDE_SPACES, sideApps, sideWords } from '@yaks/platform/side-rows'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { friendSide } from '@yaks/platform/friends'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { installPair, made, type Pair } from '../../packages/workerd/testing.ts'
import { parseHTML } from 'linkedom'
import { PAGE } from '@yaks/ui/navigate'
import { ADA, ADA_OWNS, as, platform, seeded } from './serving-probe.ts'
import { manage } from './manage.ts'
import { PLATFORM_OBJECT } from './door.ts'
import { KERNEL } from './meta.ts'
import { SPACE } from './build-door.ts'
import { kernel, seed, signIn } from './probe.ts'

let k = await kernel()
let ada = await seed(k, [{ slug: 'adas', apps: ['notes', 'lists'] }])
let bea = await signIn(k)

type Tab = { cookie: string; person: string }
let door = (
  who: Tab,
  path: string,
  init: RequestInit = {},
) =>
  k.at(k.host, `${REACH}${path}`, {
    ...init,
    headers: {
      cookie: who.cookie,
      [TAB_PERSON]: who.person,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
let query = async (who: Tab, q: string) => {
  let res = await door(who, `/query?q=${encodeURIComponent(q)}`)
  equal(res.status, 200, await res.clone().text())
  return (await res.json() as Bundle[]).map((b) => b.doc)
}

test('a tab reads and writes across its person’s stores, and only theirs', async () => {
  let eid = crypto.randomUUID()
  let wrote = await door(ada, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid },
      doc: { title: 'Soup' },
      $app: 'adas/notes',
    }]),
  })
  equal(wrote.status, 200, await wrote.clone().text())
  equal(await query(ada, `.entity.eid=${eid}`), [{ title: 'Soup' }])
  equal(await query(bea, `.entity.eid=${eid}`), [])
})

test('a tab drawn for someone else, or nobody signed in, is told to sign in again', async () => {
  let other = await door({ ...ada, person: bea.person }, '/query?q=.doc')
  equal(other.status, 401)
  let nobody = await k.at(k.host, `${REACH}/query?q=.doc`)
  equal(nobody.status, 401)
})

test('an Updates page loads the script that takes its card actions', async () => {
  let page = await k.at(
    k.host,
    `/${await k.dir.own(bea.person).then((s) => s.slug)}/updates`,
    {
      headers: { cookie: bea.cookie },
    },
  )
  let html = await page.text()
  equal(/<script[^>]*_inbox-actions[^>]*>/.test(html), true)
})

// Connect only the transport that the in-process platform lacks, including
// how the runtime dispatches frames on a hibernatable Durable Object socket.
let linked = (
  { 0: client, 1: server }: Pair,
  message = (data: string) => server.emit('message', data),
  close = () => server.emit('close'),
) => {
  client.send = (data) => message(data)
  server.send = (data) => client.emit('message', data)
  let end = (_code?: number) => {
    if (client.readyState == 3) return
    client.readyState = 3
    close()
    client.emit('close')
  }
  server.close = end
  return Object.assign(client, { close: end })
}

// The Operator's side of `view` as the server draws it before the page
// graph has said anything: no badges, no Updates across spaces.
let sideOf = (view: SideView) => {
  let parts = sideParts(view, [], [])
  return renderToString(
    h(
      'nav',
      { class: 'Sidebar', 'data-side-view': JSON.stringify(view) },
      h(
        'div',
        { class: 'Sidebar_Space' },
        h('div', { class: 'Sidebar_Whose' }, parts.picker),
        section(parts.apps!, false),
      ),
    ),
  )
}

test('one page graph keeps its side live: spaces, apps, and Updates badges across seated Operators and directory requests', async () => {
  await using runtime = platform()
  let { env } = runtime
  let { dir, space: home, app: { eid: book } } = await seeded(env)
  let friend = crypto.randomUUID()
  let seat = crypto.randomUUID()
  let club = crypto.randomUUID()
  await dir.apply({
    entities: [
      { entity: { eid: friend }, person: {} },
      { entity: { eid: club }, space: { slug: 'club', store: 'club' } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { space: club, person: friend, role: 'owner' },
      },
      {
        entity: { eid: seat },
        member: { space: club, person: ADA, role: 'editor' },
      },
    ],
  }, ADA_OWNS)

  let sources: string[] = []
  let opened: ReturnType<typeof linked>[] = []
  let joined = new Set<Pair[1]>()
  let join = (name: string, res: Response, object: {
    webSocketMessage: (ws: Pair[1], data: string) => unknown
    webSocketClose: (
      ws: Pair[1],
      code: number,
      reason: string,
      clean: boolean,
    ) => unknown
  }) => {
    equal(res.status, 101)
    sources.push(name)
    // Several sockets open to one object at once: each takes its own.
    let pair = made.find((pair) =>
      runtime.sockets.get(name)?.includes(pair[1]) && !joined.has(pair[1])
    )!
    joined.add(pair[1])
    let server = pair[1]
    let wire = linked(
      pair,
      (data) => void object.webSocketMessage(server, data),
      () => void object.webSocketClose(server, 1000, '', true),
    )
    opened.push(wire)
    return Object.assign(res, { webSocket: wire })
  }
  let stores = env.STORE, builders = env.BUILDER
  env.STORE = {
    idFromName: stores.idFromName,
    get: (id, options) => ({
      fetch: async (req) => {
        let res = await stores.get(id, options).fetch(req)
        return res.status == 101
          ? join(String(id), res, runtime.object(String(id)))
          : res
      },
    }),
  }
  env.BUILDER = {
    idFromName: builders.idFromName,
    get: (id, options) => ({
      fetch: async (req) => {
        let res = await builders.get(id, options).fetch(req)
        return res.status == 101
          ? join(`builder ${id}`, res, runtime.builder(String(id)))
          : res
      },
    }),
  }
  let door = async (path: string, headers = {}) =>
    manage(
      new Request(`https://yaks.app${REACH}${path}`, {
        headers: { cookie: await as(ADA), ...headers },
      }),
      env,
    )
  let tell = async (space: string, to: string) => {
    let res = await runtime.builder(space).fetch(
      new Request('https://builder/operator/tell', {
        method: 'POST',
        headers: {
          ...KERNEL,
          [SPACE]: space,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ to, words: 'An update' }),
      }),
    )
    equal(res.ok, true, await res.text())
  }
  await tell(club, friend)
  await tell(home.eid, ADA)
  let undo = installPair()
  try {
    equal(
      (await door(`/ws?${TAB_PERSON}=${friend}`, { upgrade: 'websocket' }))
        .status,
      401,
    )
    equal((await door('/ws', { upgrade: 'websocket' })).status, 101)
    let socket = linked(made[0])
    socket.readyState = 0
    let frames: Frame[] = []
    socket.addEventListener('message', ({ data }) => {
      let packet = JSON.parse(String(data)) as Frame | { frames: Frame[] }
      frames.push(...('frames' in packet ? packet.frames : [packet])
        .filter((f) => f.bundles))
    })
    // The Updates badges' frames, which say each member's revision.
    let waits = () => frames.filter((f) => typeof f.revision == 'object')
    let pane = sideOf({
      person: ADA,
      here: { slug: 'ada', title: 'ada', owner: true, own: true },
      talk: {
        space: home.eid,
        open: 'new',
        all: false,
        at: 'https://ada.yaks.app',
      },
    })
    let { document, window } = parseHTML(`<html><body>${pane}</body></html>`)
    let next = socket
    let time = clock(Date.now())
    let page = client(loadVocab([waitingWords, sideWords]), [], {
      url: `https://yaks.app${REACH}`,
      connect: () => {
        let current = next
        queueMicrotask(() => {
          current.readyState = 1
          current.emit('open')
        })
        return current
      },
      timer: (fn, ms) => void time.after(ms, fn),
      time: time.now,
      vault: false,
      wireVault: false,
    })
    let stop = bindSide(document, () => page)
    let watch = page.watch(UPDATE_WAITING)
    let spaces = page.watch(SIDE_SPACES)
    let apps = page.watch(sideApps(home.eid))
    let badge = (slug = '') =>
      document.querySelector(`[data-across="${slug}"]`)!
    let counts = () => Object.fromEntries(waitingCounts(watch.value))
    let side = () => ({
      spaces: [...document.querySelectorAll('.Sidebar_Whose .Identity_Name')]
        .map((n) => n.textContent),
      apps: [
        ...document.querySelectorAll(
          '[data-side-part="side-apps"] a .SideNav_Label',
        ),
      ].map((n) => n.textContent),
      across: !!document.querySelector('[data-side-part="side-personal"]'),
    })
    try {
      await until(() => watch.ready || watch.refused !== undefined)
      equal(watch.refused, undefined)
      equal(counts(), { ada: 1, club: 0 })
      await until(() => spaces.ready && apps.ready)
      await until(() => side().apps.length == 1)
      equal(side(), {
        spaces: ['ada', 'ada', 'club'],
        apps: ['Cookbook'],
        across: true,
      })

      // An app made, renamed and put in the trash, each on the side as the
      // directory takes it.
      let jots = crypto.randomUUID()
      await dir.apply({
        entities: [{
          entity: { eid: jots },
          doc: { title: 'Jots' },
          app: {
            slug: 'jots',
            space: home.eid,
            version: 1,
            access: 'public',
            store: 'ada/jots',
          },
        }],
      }, ADA_OWNS)
      await until(() => side().apps.length == 2)
      equal(side().apps, ['Cookbook', 'Jots'])
      await dir.apply({
        entities: [{ entity: { eid: jots }, doc: { title: 'Jottings' } }],
      }, ADA_OWNS)
      await until(() => side().apps.includes('Jottings'))
      await dir.apply({
        entities: [{
          entity: { eid: jots },
          trashed: { at: new Date().toISOString(), by: ADA },
        }],
      }, ADA_OWNS)
      await until(() => side().apps.length == 1)
      equal(side().apps, ['Cookbook'])
      let initial = waits().at(-1)!.revision as Record<string, number>
      equal(
        Object.keys(initial).sort(),
        [
          PLATFORM_STORE,
          `operator/${home.eid}`,
          `operator/${club}`,
        ].sort(),
      )
      // The directory answers the spaces, the apps and its share of the
      // badges, each on its own socket; each seated Operator its count.
      equal(
        sources.toSorted(),
        [
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          `builder ${home.eid}`,
          `builder ${club}`,
        ].sort(),
      )

      await tell(club, ADA)
      await until(() => badge().textContent == '2')
      equal(counts(), { ada: 1, club: 1 })
      equal(waits().at(-1)!.since, initial)

      await dir.stamp({
        entities: [
          friendSide(friend, ADA, { decided: { verdict: 'approved' } }),
        ],
      })
      await until(() => badge().textContent == '3')
      equal(counts(), { ada: 2, club: 1 })

      let app = crypto.randomUUID(), transfer = crypto.randomUUID()
      await dir.apply({
        entities: [{
          entity: { eid: app },
          app: { space: club, slug: 'offered', store: 'club/offered' },
        }],
      })
      let transferTo = (request: Record<string, unknown>) =>
        dir.stamp({
          entities: [{
            entity: { eid: '$appTransfer' },
            $appTransfer: { at: new Date().toISOString(), ...request },
          }],
        })
      await transferTo({
        person: friend,
        eid: transfer,
        offer: { from: club, app, recipient: ADA, editor: false },
      })
      await until(() => badge().textContent == '4')
      equal(counts(), { ada: 3, club: 1 })
      await transferTo({
        person: ADA,
        space: home.eid,
        transfer,
        answer: 'decline',
      })
      await until(() => badge().textContent == '3')

      document.body.innerHTML = pane
      document.dispatchEvent(new window.Event(PAGE))
      equal(badge().textContent, '3')
      equal(side().apps, ['Cookbook'])
      equal(sources.length, 5)

      await dir.apply(
        { entities: [{ entity: { eid: seat }, $delete: true }] },
        ADA_OWNS,
      )
      // A seat taken away takes its space off the side, and Updates across
      // spaces with it, now there is one.
      await until(() => !side().across)
      equal(counts(), { ada: 2 })
      equal(side().spaces, ['ada'])
      equal(badge(), null)
      equal(watch.value.length, 1)
      equal(spaces.value.length, 1)

      socket.close()
      // What changes while the page is away is drawn once it is back.
      await dir.apply({
        entities: [{ entity: { eid: book }, doc: { title: 'Recipes' } }],
      }, ADA_OWNS)
      await dir.stamp({
        entities: [
          friendSide(ADA, friend, { decided: { verdict: 'approved' } }),
        ],
      })
      equal((await door('/ws', { upgrade: 'websocket' })).status, 101)
      next = linked(made.at(-1)!)
      next.readyState = 0
      await time.advance(250)
      await until(() => counts().ada == 1)
      await until(() => side().apps[0] == 'Recipes')
      equal(
        sources.slice(5).sort(),
        [
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          PLATFORM_OBJECT,
          `builder ${home.eid}`,
        ]
          .sort(),
      )

      let updates = await manage(
        new Request('https://yaks.app/ada/updates', {
          headers: { cookie: await as(ADA) },
        }),
        env,
      )
      equal(updates.status, 200)
      await updates.body?.cancel()
      await until(() => counts().ada == 0)
    } finally {
      stop()
      watch.close()
      spaces.close()
      apps.close()
      page.close()
    }
  } finally {
    for (let wire of opened) wire.close?.(1000)
    undo()
  }
})
