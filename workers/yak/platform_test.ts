/// <reference lib="deno.ns" />
// The DIRECTORY on the packages, end to end (T-33814): the meta space's store
// is the same Store class every app runs on, woken at the name `yak/platform`
// and so speaking the platform's own vocabulary — spaces, apps, members,
// hostnames, deploys, sign-ins, meters — instead of an app's `vocab.json`.
//
// Everything here goes through the code that runs in production: the directory
// part's own door (`over`), its typed client, signin.ts's whole code life,
// unseen.ts's `noted`, and erase's tombstone. Nothing is stubbed between the
// caller and the rows — the vocabulary is loaded, the tables and the platform's
// uniques are planted, the batch goes through @yaks/graph's apply(), and the
// answer comes back out of @yaks/sql's compiled read.
//
// What this proves is exactly what the DO export flip turns on: the wire every
// listed caller speaks is the graph's already, so the flip is deleting meta.ts's
// `legacy` (see the TODO there) and pointing `meta` at `metaOf`.
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { directory, META, over, storeName } from './directory.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf, minted } from './meta.ts'
import { mint, personOf, spend } from './signin.ts'
import type { Door } from './door.ts'
import { noted } from './unseen.ts'
import { PLATFORM_STORE } from './vocab.ts'

let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// One directory: a Store object at the platform's own address, the graph wire
// over it, and the part's door and typed client on top of that.
let platform = () => {
  let store = new Store(state())
  let door: Door = (path, init = {}, headers = {}) => {
    let req = new Request(`http://store${path}`, init)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', PLATFORM_STORE)
    return Promise.resolve(store.fetch(req))
  }
  let at = metaOf(door)
  return { at, dir: directory({ fetch: over(at) }, true) }
}

let SECRET = 'a probe secret'
let DANA = 'dana@yaks.app'

// The person the kernel vouches for on a write.
let as = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })

// A space and an app in it, written the way space_new and app_new write them.
let space = async (
  dir: ReturnType<typeof platform>['dir'],
  person: string,
  slug: string,
) => {
  await dir.apply({
    entities: [
      { entity: { eid: person }, person: {} },
      { entity: { eid: '$space' }, doc: { title: slug }, space: { slug } },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person, role: 'owner' },
      },
    ],
  }, as(person))
  return (await dir.space(slug))!
}

Deno.test('a space and an app are seeded, minted, and read back', async () => {
  let { dir } = platform()
  let ada = crypto.randomUUID()
  let s = await space(dir, ada, 'ada')
  assertEquals(s.slug, 'ada')
  assertEquals(s.title, 'ada')
  // The first write seeded the meta space itself, so the directory can
  // describe its own store.
  assert(await dir.space(META.space))

  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      doc: { title: 'Cookbook' },
      app: { slug: 'cookbook', space: s.eid, version: 0, access: 'public' },
      alias: { slug: 'ada/cookbook' },
    }],
  }, as(ada))

  let app = (await dir.app(s, 'cookbook'))!
  assertEquals(app.slug, 'cookbook')
  assertEquals(app.space, s.eid)
  assertEquals(app.access, 'public')
  assertEquals(app.title, 'Cookbook')
  // The store is named for where the app was BORN, which a rename never moves.
  assertEquals(storeName(s, app), 'ada/cookbook')
  assertEquals((await dir.apps(s)).map((a) => a.slug), ['cookbook'])
  // The roster reads back with the platform's own three seats.
  assertEquals(await dir.role(s, ada), 'owner')
  assertEquals(await dir.members(s), [ada])
  assertEquals(await dir.owners(s), 1)
})

Deno.test('the slug a space is taken by is taken once', async () => {
  let { dir } = platform()
  let one = crypto.randomUUID()
  await space(dir, one, 'ada')
  let two = crypto.randomUUID()
  let no = await space(dir, two, 'ada').then(() => null, (e) => e as Error)
  assert(no, 'a second space at the same slug was admitted')
})

Deno.test('a hostname resolves to the app it serves and the space it is in', async () => {
  let { at, dir } = platform()
  let ada = crypto.randomUUID()
  let s = await space(dir, ada, 'ada')
  let app = minted(
    await at.apply([{
      entity: { eid: '$app' },
      doc: { title: 'Cookbook' },
      app: { slug: 'cookbook', space: s.eid, version: 0, access: 'public' },
      alias: { slug: 'ada/cookbook' },
    }], as(ada)),
  ).$app

  assertEquals(await dir.serves('recipes.example.com'), null)
  await dir.apply({
    entities: [{
      entity: { eid: crypto.randomUUID() },
      hostname: {
        name: 'recipes.example.com',
        app,
        stage: 'pending',
        at: new Date().toISOString(),
      },
    }],
  }, as(ada))

  let served = (await dir.serves('recipes.example.com'))!
  assertEquals(served.app.eid, app)
  assertEquals(served.space.slug, 'ada')
  assertEquals(served.host.stage, 'pending')
  assertEquals((await dir.hosts(s)).map((h) => h.name), ['recipes.example.com'])
})

Deno.test('a sign-in code is minted, spent once, and gone', async () => {
  let { at } = platform()
  let code = await mint(at, SECRET, DANA)
  assert(code)
  // The row is server-stamped through and through, so the ordinary door would
  // refuse it — only the kernel's writes it, and the store keeps a mac and
  // never the digits.
  let [row] = await at.query(`.signin.email=${DANA}`)
  assert(row.signin)
  assertEquals((row.signin as { code: string }).code == code, false)

  assertEquals(await spend(at, SECRET, DANA, '000000'), false)
  assertEquals(await spend(at, SECRET, DANA, code), true)
  // Signing in ends the address's whole story.
  assertEquals((await at.query(`.signin.email=${DANA}`)).length, 0)
})

Deno.test('a person is found by their address, or minted at it', async () => {
  let { at } = platform()
  let one = await personOf(at, DANA)
  assertEquals(await personOf(at, DANA), one)
  let named = await personOf(at, 'ana@yaks.app', 'Ana')
  let [row] = await at.query(`.eid=${named}`)
  assertEquals((row.doc as { title: string }).title, 'Ana')
  assertEquals((row.email as { address: string }).address, 'ana@yaks.app')
})

Deno.test("a break the platform noted about itself is the meta store's", async () => {
  let { at } = platform()
  await noted((bundles) => at.apply(bundles, KERNEL), {
    request: 'billing POST /stripe',
    message: 'signature refused',
    stack: 'at verify',
  })
  let [broke] = await at.query('.exception!')
  let e = broke.exception as { request: string; message: string }
  assertEquals(e.request, 'billing POST /stripe')
  assertEquals(e.message, 'signature refused')
  // It wears no `doc`, so the platform's own crashes never show up in the
  // query a person's agent is taught as "everything you saved" (T-32533).
  assertEquals(broke.doc, undefined)
})

Deno.test("the meter and the plan are the platform's word, not a person's", async () => {
  let { at, dir } = platform()
  let ada = crypto.randomUUID()
  let s = await space(dir, ada, 'ada')
  let month = '2026-09'
  await at.apply([{
    entity: { eid: s.eid },
    meter: {
      month,
      requests: 12,
      rows_read: 3,
      rows_written: 4,
      bytes: 900,
      at: new Date().toISOString(),
    },
    plan: { tier: 'free' },
  }], KERNEL)
  let seen = (await dir.space('ada'))!
  assertEquals(seen.meter?.month, month)
  assertEquals(seen.meter?.requests, 12)
  assertEquals(seen.tier, 'free')
  // A person cannot lift their own ceiling: the columns are server-owned, so
  // the ordinary door drops them rather than writing them.
  await at.apply([{ entity: { eid: s.eid }, plan: { tier: 'plus' } }], as(ada))
  assertEquals((await dir.space('ada'))!.tier, 'free')
  // And the space that pays as a customer is found by it.
  await at.apply([{
    entity: { eid: s.eid },
    plan: { customer: 'cus_1', subscription: 'sub_1', status: 'active' },
  }], KERNEL)
  assertEquals((await dir.payer('cus_1'))!.slug, 'ada')
})

Deno.test('erasing a space buries everything that named it', async () => {
  let { at, dir } = platform()
  let ada = crypto.randomUUID()
  let s = await space(dir, ada, 'ada')
  let app = minted(
    await at.apply([{
      entity: { eid: '$app' },
      doc: { title: 'Cookbook' },
      app: { slug: 'cookbook', space: s.eid, version: 0, access: 'public' },
      alias: { slug: 'ada/cookbook' },
    }], as(ada)),
  ).$app
  await at.apply([
    {
      entity: { eid: '$host' },
      hostname: {
        name: 'recipes.example.com',
        app,
        stage: 'active',
        at: new Date().toISOString(),
      },
    },
    {
      entity: { eid: '$deploy' },
      deploy: { app, version: 1, files: '{}', worker: '' },
    },
  ], as(ada))
  assertEquals((await at.query('.app!')).length, 2) // ada's, and the platform's

  // The one tombstone erase.ts writes. Death cascades in the store to every
  // app, deploy, hostname and membership that named the space.
  await dir.apply({
    entities: [{ entity: { eid: s.eid }, tombstone: {} }],
  }, as(ada))

  assertEquals(await dir.space('ada'), null)
  assertEquals((await at.query(`.app.space=${s.eid}`)).length, 0)
  assertEquals((await at.query(`.deploy.app=${app}`)).length, 0)
  assertEquals((await at.query('.hostname!')).length, 0)
  assertEquals((await at.query(`.member.space=${s.eid}`)).length, 0)
  // The slug is free for somebody else to take.
  let other = crypto.randomUUID()
  assertEquals((await space(dir, other, 'ada')).slug, 'ada')
})

Deno.test('the directory plants the platform, and not one app word', async () => {
  let ctx = state()
  let store = new Store(ctx)
  await store.fetch(
    new Request('http://store/query?q=.space!', {
      headers: { 'x-store': PLATFORM_STORE },
    }),
  )
  let tables = ctx.storage.sql
    .exec("select name from sqlite_master where type = 'table'")
    .toArray()
    .map((r) => String((r as { name: unknown }).name))
    .filter((n) => !n.startsWith('doc_fts') && !n.startsWith('sqlite_'))
  // @yaks/member's roster is NOT here: the platform declares its own `member`,
  // with three seats instead of two, and the kernel is the directory's guard.
  assertEquals(tables.includes('grant'), false)
  assertEquals(tables.includes('access'), false)
  for (
    let name of [
      'space',
      'app',
      'alias',
      'member',
      'email',
      'hostname',
      'deploy',
      'published',
      'installed',
      'plan',
      'meter',
      'notified',
      'signin',
      'report',
      'exception',
    ]
  ) assert(tables.includes(name), `no ${name} table`)
  // And the uniques the directory's races are decided by.
  let uniques = ctx.storage.sql
    .exec("select name from sqlite_master where type = 'index'")
    .toArray()
    .map((r) => String((r as { name: unknown }).name))
  assert(uniques.includes('space_slug'))
  assert(uniques.includes('hostname_name'))
})

// The one bundle the app half writes to its own store today, proving the
// header that picks a vocabulary picks the OTHER one when the name is an app's.
Deno.test('a store that is not the directory is still an app', async () => {
  let store = new Store(state())
  let no = await store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { 'x-store': 'ada/cookbook' },
      body: JSON.stringify(
        [{ entity: { eid: crypto.randomUUID() }, space: { slug: 'ada' } }],
      ),
    }),
  )
  // `space` is not a word an app's store has, and an app's store says where a
  // word of its own would come from rather than dropping it (graph.ts
  // `#teaching`).
  assertEquals(no.status, 400)
  let why = (await no.json()).message as string
  assertEquals(why.startsWith('unknown component: space'), true)
  assertEquals(why.includes('vocab.json'), true)
  let read = await (await store.fetch(
    new Request('http://store/query?q=.doc%3F', {
      headers: { 'x-store': 'ada/cookbook' },
    }),
  )).json() as Bundle[]
  assertEquals(read.length, 0)
})
