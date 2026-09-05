/// <reference lib="deno.ns" />
// The Store on the packages, end to end (T-33810): a Durable Object over the
// workerd stand-in @yaks/durable-object ships, driven through its own doors.
// Nothing is stubbed between the request and the rows — the vocabulary is
// loaded, the tables are planted, the batch goes through @yaks/graph's apply(),
// and the answer comes back out of @yaks/sql's compiled read.
//
// The stand-in is what makes this fast rather than a workerd boot: it imitates
// the runtime exactly where the runtime is strict (narrow bindings, transaction
// SQL refused, blobs as ArrayBuffers), so a bug it cannot see is one the
// runtime would not have shown either. The one thing it cannot do is the 101
// upgrade — `WebSocketPair` and a 101 `Response` are the runtime's, not the
// web's — so a socket is driven the way the runtime drives a hibernated one,
// through `webSocketMessage`.
import { assert, assertEquals } from '@std/assert'
import type { Frame } from '@yaks/api'
import { type Bundle, sha256 } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { grantEid, Store } from './graph.ts'
import { RELATIONS } from './vocab.ts'

// A hibernatable socket, faked: what it was sent, and the attachment that is
// its only memory across an eviction.
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => {
      held = JSON.parse(JSON.stringify(v))
    },
    deserializeAttachment: () => held,
  }
}

// One object's whole state: storage that outlives an incarnation, and the
// socket list the runtime holds for it.
let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// The headers the kernel puts on a request to a store. A client never sends
// one: every request to an object is built from scratch by the Worker.
type Vouch = {
  app?: string
  access?: string
  person?: string
  role?: string
  title?: string
}

let headers = (v: Vouch = {}): Record<string, string> => ({
  'x-store': 'ada/cookbook',
  ...(v.app ? { 'x-yak-app': v.app } : {}),
  ...(v.access ? { 'x-yak-access': v.access } : {}),
  ...(v.person ? { 'x-yak-person': v.person } : {}),
  ...(v.role ? { 'x-yak-role': v.role } : {}),
  ...(v.title ? { 'x-yak-title': v.title } : {}),
})

let get = (store: Store, path: string, v?: Vouch) =>
  store.fetch(new Request(`http://store${path}`, { headers: headers(v) }))

let post = (store: Store, path: string, body: string | unknown[], v?: Vouch) =>
  store.fetch(
    new Request(`http://store${path}`, {
      method: 'POST',
      headers: headers(v),
      body: typeof body == 'string' ? body : JSON.stringify(body),
    }),
  )

let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let CAKE = 'c0000000-0000-4000-8000-000000000003'

// The same app in both spellings: the five-scalar short form every app deployed
// before JSON Schema, and the JSON Schema it means.
let SHORT = '{"recipe": {"serves": "number"}}'
let SCHEMA = JSON.stringify({
  $defs: {
    recipe: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { serves: { type: 'number' } },
    },
  },
})
let SPELLINGS: [string, string][] = [['short form', SHORT], [
  'JSON Schema',
  SCHEMA,
]]

let owner: Vouch = { app: APP, person: ADA, role: 'owner', title: 'Ada' }

// The byline off a returned bundle. `Bundle` carries any component, so a test
// reading one names the shape it expects.
let by = (b: Bundle) => (b.created as { by?: string } | undefined)?.by ?? null

// A store with the app deployed into it, which is where every test starts.
let cookbook = async (ctx = state(), manifest = SHORT, v = owner) => {
  let store = new Store(ctx)
  assertEquals((await post(store, '/vocab', manifest, v)).status, 200)
  return store
}

Deno.test("an app's vocab.json is read back as it was written", async () => {
  let store = await cookbook()
  assertEquals(await (await get(store, '/vocab')).json(), JSON.parse(SHORT))
})

Deno.test('a manifest the vocabulary refuses leaves the store as it was', async () => {
  let store = await cookbook()
  let no = await post(store, '/vocab', '{"doc": {"headline": "text"}}', owner)
  assertEquals(no.status, 400)
  assert((await no.json()).message.includes('doc'))
  assertEquals(await (await get(store, '/vocab')).json(), JSON.parse(SHORT))
})

for (let [spelling, manifest] of SPELLINGS) {
  Deno.test(`a bundle applies and queries back (${spelling})`, async () => {
    let store = await cookbook(state(), manifest)

    let wrote = await post(store, '/apply', [{
      entity: { eid: CAKE },
      doc: { title: 'Lemon drizzle', body: 'three lemons' },
      recipe: { serves: 8 },
    }], owner)
    assertEquals(wrote.status, 200)
    // The batch AS APPLIED, plus everything the graph synthesized: the number
    // storage minted, and the byline the stamp phase wrote, each riding a
    // bundle of its own.
    let applied = await wrote.json() as Bundle[]
    assertEquals(applied[0].entity.eid, CAKE)
    assert(applied.some((b) => (b.entity.num ?? 0) >= 1))
    assert(applied.some((b) => by(b) == ADA))

    let read = await (await get(store, '/query?q=.recipe!', owner)).json()
    assertEquals(read.length, 1)
    assertEquals(read[0].recipe.serves, 8)
    assertEquals(read[0].doc.title, 'Lemon drizzle')
    // @yaks/blob swapped the body for its address on the way in and back on
    // the way out; neither `doc` nor the app was told.
    assertEquals(read[0].doc.body, 'three lemons')
  })
}

Deno.test('the writer the kernel vouched for is a person here, by name', async () => {
  let store = await cookbook()
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], owner)
  let [ada] = await (await get(store, '/query?q=.person!', owner)).json()
  assertEquals(ada.entity.eid, ADA)
  assertEquals(ada.doc.title, 'Ada')
})

Deno.test('an edge is a sentence, and the relation is a word the store knows', async () => {
  let store = await cookbook()
  let wrote = await post(store, '/apply', [
    { entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } },
    { entity: { eid: APP }, doc: { title: 'Cookbook' } },
    { entity: { eid: '$link' }, edge: { from: APP, to: CAKE }, contains: {} },
  ], owner)
  assertEquals(wrote.status, 200)
  let links = await (await get(store, '/query?q=.contains!', owner)).json()
  assertEquals(links.length, 1)
  assertEquals(links[0].edge.from, APP)
  assertEquals(links[0].edge.to, CAKE)
})

Deno.test('/ws without an upgrade is not a door', async () => {
  let store = await cookbook()
  assertEquals((await get(store, '/ws', owner)).status, 405)
})

Deno.test('a subscription is answered, and a commit reaches the socket', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  let ws = wire()
  ctx.live.push(ws)

  store.webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.recipe!', id: 'r' }),
  )
  assertEquals(ws.sent, [{ id: 'r', bundles: [] }])

  await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
    recipe: { serves: 8 },
  }], owner)
  assertEquals(ws.sent.length, 2)
  let pushed = ws.sent[1] as {
    id: string
    bundles: { entity: { eid: string } }[]
  }
  assertEquals(pushed.id, 'r')
  assertEquals(pushed.bundles[0].entity.eid, CAKE)
})

Deno.test('a woken object serves the same app, and the same sockets', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], owner)
  let ws = wire()
  ctx.live.push(ws)
  store.webSocketMessage(ws, JSON.stringify({ subscribe: '.recipe!', id: 'r' }))

  // The object is evicted; its storage and its sockets are not.
  let woken = new Store(ctx)
  let read = await (await get(woken, '/query?q=.recipe!', owner)).json()
  assertEquals(read.length, 1)
  assertEquals(read[0].recipe.serves, 8)
  // The wake re-opened what the socket held, and answered it with the set.
  assertEquals(ws.sent.length, 2)
  assertEquals((ws.sent[1] as { id: string }).id, 'r')
})

Deno.test('a stranger is refused on a private app', async () => {
  let mine: Vouch = { ...owner, access: 'private' }
  let store = await cookbook(state(), SHORT, mine)
  // The owner writes: the kernel vouched for the level, and the store wrote
  // that down as a grant of its own.
  assertEquals(
    (await post(store, '/apply', [{
      entity: { eid: CAKE },
      recipe: { serves: 8 },
    }], mine)).status,
    200,
  )

  // A stranger with the link — nobody at all — is refused at the door: a
  // private app is not readable by nobody, and the way in is to sign in.
  let no = await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 1 },
  }], { app: APP })
  assertEquals(no.status, 401)
  assertEquals((await no.json()).error, 'Unauthorized')
  // And nothing landed.
  let [cake] = await (await get(store, '/query?q=.recipe!', mine)).json()
  assertEquals(cake.recipe.serves, 8)
})

Deno.test('an open app is written by nobody', async () => {
  let open: Vouch = { app: APP, access: 'open' }
  let store = await cookbook(state(), SHORT, open)
  let wrote = await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], open)
  assertEquals(wrote.status, 200)
  // Unattributed: nobody signed it, so nothing claims they did.
  let applied = await wrote.json() as Bundle[]
  assert(applied.every((b) => by(b) == null))
})

// The whole point of the cut (V-33553): a customer's Durable Object holds one
// app's tables, not the fleet's 83.
Deno.test('the object plants core + member + edge + the app, and nothing else', async () => {
  let ctx = state()
  await cookbook(ctx)
  let tables = ctx.storage.sql
    .exec("select name from sqlite_master where type = 'table'")
    .toArray()
    .map((r) => String((r as { name: unknown }).name))
    .filter((n) => !n.startsWith('doc_fts') && !n.startsWith('sqlite_'))
    .sort()
  assertEquals(
    tables,
    [
      // the object's own memory, and @yaks/blob's store
      'yak_kv',
      'blob_text',
      // the spine
      'entity',
      'tombstone',
      // core
      'doc',
      'person',
      'created',
      'updated',
      // @yaks/member
      'member',
      'grant',
      'access',
      // @yaks/edge, and the verbs an edge may wear
      'edge',
      ...RELATIONS,
      // the app's own
      'recipe',
    ].sort(),
  )
})

// The separator inside a grant id is a NUL BYTE, and it is load-bearing: it is
// what keeps grantEid of ('a\x00b', 'c') from colliding with ('a', 'b\x00c').
// It was once written as a raw 0x00 in the source, which made git call the
// file binary and refuse to merge it (T-33946); the escape spells the same
// byte. This pins the id both ways — against the bytes, built here without the
// escape, and against a frozen hex — so the separator cannot quietly become a
// space and silently move every grant.
Deno.test('a grant id is the sha of app and person joined by a NUL', () => {
  let nul = String.fromCharCode(0)
  assertEquals(
    grantEid('cookbook', 'P-1'),
    sha256(`grant${nul}cookbook${nul}P-1`),
  )
  assertEquals(
    grantEid('cookbook', 'P-1'),
    '297f143239d7da3decf8ba2f25bb142403be985fb12d029d4e9f172127061df8',
  )
})
