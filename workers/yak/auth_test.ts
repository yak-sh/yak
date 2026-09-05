/// <reference lib="deno.ns" />
// The auth path, end to end over the workerd stand-in (T-33813): three
// credentials verified at the kernel's edge, one vouch across the hop, and one
// `Authenticate` inside the object turning it into the `$actor` every door
// signs with.
//
// What each test pins down:
//
//   the vouch      the kernel's word becomes the actor, and the store writes
//                  down what it was told about them
//   the forgery    a bundle's own `$actor` never survives the door
//   the strip      a visitor's headers cannot ride into an object on a request
//                  the kernel forwards (door.ts `storeOf`, the /ws hop)
//   the grant      an app worker's sealed grant is admitted at the level it
//                  names, and is nothing at all once it has expired
//   the mount      @yaks/mcp over the same graph under the same seam
//
// The half NOT here is turning a cookie or an OAuth bearer into a person:
// that is identity.ts's `withAuth`, and identity_test.ts walks the whole OAuth
// flow in workerd to prove a bearer resolves to the same person the cookie
// does. From there on, every credential is a vouch, which is what this file
// starts from.
import { assert, assertEquals } from '@std/assert'
import type { Handler } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import { mcp } from '@yaks/mcp'
import { durable } from '../../packages/durable-object/harness.ts'
import { seal } from '../../src/token.ts'
import { GRANT, granted, granting } from './dispatch.ts'
import { Store } from './graph.ts'
import { vouchOf } from './graph.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { storeOf } from './door.ts'

let state = () => ({
  storage: durable(),
  acceptWebSocket: () => {},
  getWebSockets: () => [],
})

let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let CAKE = 'c0000000-0000-4000-8000-000000000003'
let MALLORY = 'd0000000-0000-4000-8000-000000000004'
let SECRET = 'a-probe-secret'
let STORE = 'ada/cookbook'

// The header set the kernel builds for one request to one store: what it holds
// (the app and the mode the directory says it is in) and who is asking.
let vouch = (
  who: Who,
  access?: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  'x-store': STORE,
  'x-yak-app': APP,
  ...(access ? { 'x-yak-access': access } : {}),
  ...vouched(who),
  ...extra,
})

let post = (store: Store, path: string, body: unknown, head: HeadersInit) =>
  store.fetch(
    new Request(`http://store${path}`, {
      method: 'POST',
      headers: head,
      body: typeof body == 'string' ? body : JSON.stringify(body),
    }),
  )

let get = (store: Store, path: string, head: HeadersInit) =>
  store.fetch(new Request(`http://store${path}`, { headers: head }))

let ada: Who = { person: ADA, role: 'owner' }

// A store holding one app, deployed the way the kernel deploys one.
let cookbook = async (access?: string) => {
  let store = new Store(state())
  let head = vouch(ada, access, { 'x-yak-title': 'Ada' })
  assertEquals((await post(store, '/vocab', '{}', head)).status, 200)
  return { store, head }
}

// A reference, whichever way the door said it: the eid a write carries, or the
// `{eid, name}` a READ speaks it as (graph.ts `#speak`).
let idOf = (v: unknown): string | null =>
  typeof v == 'string' ? v : (v as { eid?: string } | null)?.eid ?? null

let by = (b: Bundle) => idOf((b.created as { by?: unknown } | undefined)?.by)

Deno.test('the kernel vouched, so the batch is signed by that person', async () => {
  let { store, head } = await cookbook()
  let wrote = await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
  }], head)
  assertEquals(wrote.status, 200)
  assert((await wrote.json() as Bundle[]).some((b) => by(b) == ADA))

  // And the store wrote down what it was told about them: a person to resolve
  // a byline to, and the level the platform vouched, as a grant of its own.
  let [person] = await (await get(store, '/query?q=.person!', head)).json()
  assertEquals(person.entity.eid, ADA)
  let [grant] = await (await get(store, '/query?q=.grant!', head)).json()
  assertEquals(idOf(grant.grant.person), ADA)
  assertEquals(grant.grant.access, 'owner')
})

Deno.test('an instrument that named itself is attribution, never a level', () => {
  let said = vouchOf(
    new Request('http://store/apply', {
      headers: { 'x-via': MALLORY, 'x-yak-role': 'owner', 'x-yak-title': 'me' },
    }),
  )
  assertEquals(said, { person: MALLORY, level: null, title: null })
})

Deno.test('a bundle that signs itself is signed by the door instead', async () => {
  let { store, head } = await cookbook()
  let wrote = await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
    $actor: { by: MALLORY },
  }], head)
  assertEquals(wrote.status, 200)
  let applied = await wrote.json() as Bundle[]
  assert(applied.some((b) => by(b) == ADA), 'the door signed it')
  assert(!applied.some((b) => by(b) == MALLORY), 'and the bundle did not')
})

Deno.test('a visitor cannot ride their own vouch into a store', async () => {
  let seen: Request[] = []
  let ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: (req: Request) => {
        seen.push(req)
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    }),
  }
  // The /ws hop is the one that forwards the visitor's own request, because
  // the upgrade header rides on it. Everything only the kernel may say is
  // taken off it first.
  let forged = new Request('http://door/ws', {
    headers: {
      upgrade: 'websocket',
      'x-yak-person': MALLORY,
      'x-yak-role': 'owner',
      'x-yak-kernel': '1',
      'x-via': MALLORY,
    },
  })
  await storeOf(ns, STORE, { eid: APP, access: 'open' })('/ws', forged, {})
  let sent = seen[0].headers
  assertEquals(sent.get('upgrade'), 'websocket')
  assertEquals(sent.get('x-yak-person'), null)
  assertEquals(sent.get('x-yak-role'), null)
  assertEquals(sent.get('x-yak-kernel'), null)
  assertEquals(sent.get('x-via'), null)
  // And what the kernel itself says is on it: which store, which app, and the
  // mode the directory holds for it.
  assertEquals(sent.get('x-store'), STORE)
  assertEquals(sent.get('x-yak-app'), APP)
  assertEquals(sent.get('x-yak-access'), 'open')
})

Deno.test('a private app answers a stranger nothing, and its owner everything', async () => {
  let { store, head } = await cookbook('private')
  await post(
    store,
    '/apply',
    [{ entity: { eid: CAKE }, doc: { title: 'x' } }],
    head,
  )

  let no = await get(
    store,
    '/query?q=.doc.title=x',
    vouch({ person: null, role: null }),
  )
  assertEquals(no.status, 401)
  assertEquals((await no.json()).error, 'Unauthorized')

  // Signed in and holding nothing is a different sentence and a different
  // status: the app is somebody's, and they are the one who may grant it.
  let stranger = await get(
    store,
    '/query?q=.doc.title=x',
    vouch({ person: MALLORY, role: null }),
  )
  assertEquals(stranger.status, 403)
  assertEquals((await stranger.json()).error, 'Denied')

  assertEquals(
    (await (await get(store, '/query?q=.doc.title=x', head)).json()).length,
    1,
  )
})

Deno.test('a socket onto a private app passes the same door', async () => {
  let { store } = await cookbook('private')
  let upgrade = { upgrade: 'websocket' }
  let no = await get(
    store,
    '/ws',
    vouch({ person: null, role: null }, undefined, upgrade),
  )
  assertEquals(no.status, 401)
})

// ── The sealed grant (dispatch.ts): an app's own worker, acting as the
// visitor it is answering, for one minute.

Deno.test('a sealed grant is admitted at the level it names', async () => {
  let { store, head } = await cookbook('private')
  await post(
    store,
    '/apply',
    [{ entity: { eid: CAKE }, doc: { title: 'x' } }],
    head,
  )

  // The kernel seals who is looking; the app's worker sends it back and the
  // kernel opens it. What comes out is a `Who` like any other, so the vouch
  // the store sees is the vouch a page's own request would have made.
  let sealed = await granting(SECRET, STORE, ada)
  let who = await granted(
    new Request('http://app/api/query', { headers: { [GRANT]: sealed } }),
    SECRET,
    STORE,
  )
  assertEquals(who, { person: ADA, role: 'owner' })
  let read = await get(store, '/query?q=.doc.title=x', vouch(who!, 'private'))
  assertEquals(read.status, 200)
  assertEquals((await read.json()).length, 1)
})

Deno.test('an expired grant is nobody, and nobody reads a private app', async () => {
  let { store, head } = await cookbook('private')
  await post(
    store,
    '/apply',
    [{ entity: { eid: CAKE }, doc: { title: 'x' } }],
    head,
  )

  // A minute ago, said in the grant's own shape (dispatch.ts `granting`).
  let stale = await seal({
    store: STORE,
    person: ADA,
    role: 'owner',
    exp: Math.floor(Date.now() / 1000) - 1,
  }, SECRET)
  let who = await granted(
    new Request('http://app/api/query', { headers: { [GRANT]: stale } }),
    SECRET,
    STORE,
  )
  assertEquals(who, null)
  // A grant for ANOTHER store is the same nothing, however fresh it is.
  let elsewhere = await granting(SECRET, 'ada/notes', ada)
  assertEquals(
    await granted(
      new Request('http://app/api/query', { headers: { [GRANT]: elsewhere } }),
      SECRET,
      STORE,
    ),
    null,
  )
  // So the request the app's worker makes is an anonymous one, and a private
  // app answers it the way it answers any stranger.
  let no = await get(
    store,
    '/query?q=.doc.title=x',
    vouch({ person: null, role: null }),
  )
  assertEquals(no.status, 401)
})

// ── The agent door: @yaks/mcp over the same graph, under the same seam.

let call = (
  door: Handler,
  name: string,
  args: unknown,
  head: HeadersInit,
) =>
  door(
    new Request('http://store/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...Object.fromEntries(new Headers(head)),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  )

Deno.test('the agent door signs with the same actor the page door does', async () => {
  let { store, head } = await cookbook()
  let door = mcp(store.door)

  let out = await call(door, 'graph_apply', {
    change: [{ entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } }],
  }, { ...head, authorization: 'Bearer what-the-edge-already-checked' })
  assertEquals(out.status, 200)
  let reply = await out.json() as { result: { isError?: boolean } }
  assert(!reply.result.isError, JSON.stringify(reply))

  // The write landed under the person the kernel vouched, through a door that
  // was handed no identity of its own — only the seam.
  let [cake] = await (await get(store, `/query?q=.entity.eid=${CAKE}`, head))
    .json()
  assertEquals(by(cake), ADA)
})

Deno.test('the agent door refuses what the page door refuses', async () => {
  let { store } = await cookbook('private')
  let out = await call(
    mcp(store.door),
    'graph_query',
    { q: '.doc!' },
    vouch({ person: null, role: null }),
  )
  assertEquals(out.status, 401)
  assertEquals((await out.json()).error, 'Unauthorized')
})
