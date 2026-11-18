// A page's doors on a branch of an app store (graph.ts `#onBranch`): what a
// draft's preview reads and writes, the branch's words beside main's, and
// what a dropped branch leaves.
import { equal, ok, test } from '@yaks/testing'
import { ownedBy } from './directory-fixture.ts'
import { directory, fetch as directoryFetch, storeName } from './directory.ts'
import { within } from './defects.ts'
import { BRANCH, storeOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL } from './meta.ts'
import { vouched } from './session.ts'
import { declared, platform } from './testing.ts'

let p = platform('branch doors')
let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
let space = await ownedBy(dir, 'branch-doors', 'paging')
await dir.apply({
  entities: [{
    entity: { eid: '$app' },
    app: {
      slug: 'cards',
      version: 1,
      space: space.eid,
      store: 'paging/cards.123456',
      access: 'public',
    },
    doc: { title: 'Cards' },
  }],
})
let app = (await dir.app(space, 'cards'))!
await declared(p.env, space, app)
let name = storeName(space, app)
let served = { eid: app.eid, access: 'public' }
let main = storeOf(p.env.STORE, name, served)
let send = async (
  door: typeof main,
  path: string,
  init: RequestInit = {},
) => {
  let r = await door(path, init, KERNEL)
  let text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}
let post = (door: typeof main, path: string, body: unknown) =>
  send(door, path, { method: 'POST', body: JSON.stringify(body) })
let words = (defs: Record<string, Record<string, unknown>>) => ({
  $defs: Object.fromEntries(
    Object.entries(defs).map(([comp, properties]) => [comp, { properties }]),
  ),
})

let card = crypto.randomUUID(), note = crypto.randomUUID()
await post(main, '/vocab', words({ card: { name: { type: 'string' } } }))
await post(main, '/apply', [{ entity: { eid: card }, card: { name: 'live' } }])
let made = await post(main, '/branches', {})
let id = made.body.branch.id as number
let branch = storeOf(p.env.STORE, name, { ...served, branch: id })

let grown = await post(
  branch,
  '/vocab',
  words({
    card: { name: { type: 'string' }, color: { type: 'string' } },
    note: { text: { type: 'string' } },
  }),
)
let wrote = await post(branch, '/apply', [
  { entity: { eid: card }, card: { name: 'drafted', color: 'red' } },
  { entity: { eid: note }, note: { text: 'only here' } },
])
let onBranch = await send(branch, '/query?q=.card')
let notes = await send(branch, '/query?q=.note')
let onMain = await send(main, '/query?q=.card')
let mainNotes = await send(main, '/query?q=.note')
let mainWords = await send(main, '/vocab')
let retyped = await post(
  branch,
  '/vocab',
  words({ card: { name: { type: 'number' } } }),
)
let person = { ...KERNEL, ...vouched({ person: 'reader', role: 'owner' }) }
let kept = await branch('/storage', {
  method: 'POST',
  body: JSON.stringify({ set: { theme: 'dark' } }),
}, person).then(() => branch('/storage', {}, person)).then((r) => r.json())
let mainKept = await main('/storage', {}, person).then((r) => r.json())
// A new incarnation over the same object, as a deploy or an eviction makes.
let again = await new Store(p.states.get(name)!, p.env).fetch(
  new Request('https://store/query?q=.card', {
    headers: { ...KERNEL, 'x-store': name, [BRANCH]: String(id) },
  }),
).then((r) => r.json())
// A page's socket on the branch, closed: the runtime has let go of its tags
// by the time its close arrives, and main's pages still list it.
let socket = (() => {
  let held: unknown = null
  return {
    readyState: 1,
    send: () => {},
    serializeAttachment: (v: unknown) => void (held = structuredClone(v)),
    deserializeAttachment: () => held,
  }
})()
let factory = globalThis as { WebSocketPair?: unknown }
factory.WebSocketPair = function () {
  return { 0: {}, 1: socket }
}
await branch('/ws', { headers: { upgrade: 'websocket' } }, KERNEL)
  .catch(() => {})
delete factory.WebSocketPair
socket.readyState = 3
let reports: unknown[] = []
await within(
  { ERRORS: { send: (rows) => (reports.push(...rows), Promise.resolve()) } },
  { request: 'webSocketClose' },
  async () => {
    await p.object(name).webSocketClose(socket)
    await post(main, '/apply', [{
      entity: { eid: card },
      card: { name: 'on' },
    }])
  },
)
let dropped = await send(main, `/branches/${id}`, { method: 'DELETE' })
let gone = await send(branch, '/query?q=.card')
await post(main, `/branches/${id}/restore`, {})
let restoredNotes = await send(branch, '/query?q=.note')
let restoredKept = await branch('/storage', {}, person).then((r) => r.json())

test('a branch takes words main never declared, and main keeps its own', () => {
  equal(grown.status, 200, JSON.stringify(grown.body))
  equal(Object.keys(mainWords.body.$defs), ['card'])
})

test('a page on a branch writes and reads there, and main never sees it', () => {
  equal(wrote.status, 200, JSON.stringify(wrote.body))
  equal(onBranch.body.map((r: { card: unknown }) => r.card), [
    { name: 'drafted', color: 'red' },
  ])
  equal(notes.body.map((r: { note: unknown }) => r.note), [
    { text: 'only here' },
  ])
  equal(onMain.body.map((r: { card: unknown }) => r.card), [{ name: 'live' }])
  ok(mainNotes.status >= 400, JSON.stringify(mainNotes.body))
})

test('a later incarnation serves a branch under its own words', () =>
  equal(again.map((r: { card: unknown }) => r.card), [
    { name: 'drafted', color: 'red' },
  ]))

test('a branch refuses the words a deploy would', () =>
  ok(retyped.status >= 400 && retyped.status < 500, String(retyped.status)))

test('a branch keeps its pages’ storage apart from main’s', () => {
  equal(kept, { theme: 'dark' })
  equal(mainKept, {})
})

test('a closed socket on a branch closes and broadcasts without a report', () =>
  equal(reports, []))

test('a dropped branch answers nothing', () => {
  equal(dropped.status, 204)
  ok(gone.status >= 400, String(gone.status))
})

test('restore returns branch words and pages’ storage with its records', () => {
  equal(restoredNotes.status, 200, JSON.stringify(restoredNotes.body))
  equal(restoredNotes.body.map((r: { note: unknown }) => r.note), [{
    text: 'only here',
  }])
  equal(restoredKept, { theme: 'dark' })
})
