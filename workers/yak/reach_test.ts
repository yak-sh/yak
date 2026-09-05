/// <reference lib="deno.ns" />
// Cross-app reach over two Store objects in one space (T-33816), driven
// through the workerd stand-in @yaks/durable-object ships. Nothing between the
// fan-out and the rows is stubbed: two real `Store` objects, each with its own
// `vocab.json`, behind a `STORE` namespace that hands out whichever one the
// kernel named. What is under test is the composition — the merge by eid, the
// order settled after it, and the dry run that keeps a refused half-batch from
// landing anywhere.
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { durable } from '../../packages/durable-object/harness.ts'
import { Store } from './graph.ts'
import { type App, appStore, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { type Reach, read, written } from './reach.ts'

let space = (slug: string): Space => ({
  eid: `space-${slug}`,
  slug,
  home: null,
  title: slug,
  tier: null,
  plan: null,
  meter: null,
  told: false,
})

let app = (slug: string, spaceEid: string): App => ({
  eid: `app-${slug}`,
  slug,
  space: spaceEid,
  version: 1,
  title: slug,
  access: 'private',
  store: null,
  slugs: [slug],
  first: [],
  meter: null,
  published: null,
  installed: null,
})

let ADA = 'b0000000-0000-4000-8000-000000000002'
let owner: Who = { person: ADA, role: 'owner' }

// The kernel's own namespace, made of Store objects: one per name, kept, so a
// second call reaches the object the first one wrote to. What the store is
// told about itself — which app it holds, what its access mode is — rides on
// each request already (directory.ts `appStore`).
let namespace = () => {
  let held = new Map<string, Store>()
  return {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      let name = String(id)
      let store = held.get(name)
      if (!store) {
        store = new Store({
          storage: durable(),
          acceptWebSocket: () => {},
          getWebSockets: () => [],
        })
        held.set(name, store)
      }
      return store
    },
  }
}

// One app deployed into its own store: the manifest, planted the way
// `app_deploy` plants it, through the same door with the same vouch.
let deploy = async (env: Env, r: Reach, manifest: Record<string, unknown>) => {
  let res = await appStore(env.STORE, r.space, r.app)('/vocab', {
    method: 'POST',
    body: JSON.stringify(manifest),
  }, vouched(r.who))
  assertEquals(res.status, 200)
  await res.body?.cancel()
}

// A space with a reading list and a lending app in it, each declaring one word
// of its own — the shape M-32311 describes: two apps, two stores, joined by
// eid.
let nora = space('nora')
let reading = app('reading', nora.eid)
let lending = app('lending', nora.eid)

let where = async () => {
  let env = { STORE: namespace() } as unknown as Env
  let reach: Reach[] = [
    { space: nora, app: reading, who: owner },
    { space: nora, app: lending, who: owner },
  ]
  await deploy(env, reach[0], { book: { pages: 'number', shelf: 'text' } })
  await deploy(env, reach[1], { loan: { to: 'text' } })
  return { env, reach }
}

let eid = () => crypto.randomUUID()

let bundles = (out: unknown) => out as Bundle[]

let comp = (b: Bundle, name: string) =>
  (b[name] ?? {}) as Record<string, unknown>

Deno.test('a spanning read merges the two stores into one bundle per eid', async () => {
  let { env, reach } = await where()
  let dune = eid()
  await written(env, reach, undefined, [
    { entity: { eid: dune }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ])
  await written(env, reach, undefined, [
    { entity: { eid: dune }, loan: { to: 'Ada' } },
  ])

  // Each word went to the app that declared it…
  let onlyBooks = bundles(await read(env, [reach[0]], '.book!'))
  assertEquals(onlyBooks.length, 1)
  assertEquals(onlyBooks[0].loan, undefined)

  // …and the read that names no app answers ONE bundle wearing both, saying
  // which store holds which component.
  let both = bundles(await read(env, reach, '.book!&.loan?'))
  assertEquals(both.length, 1)
  assertEquals(both[0].entity.eid, dune)
  assertEquals(comp(both[0], 'book').pages, 412)
  assertEquals(comp(both[0], 'loan').to, 'Ada')
  assertEquals((both[0]._stores as Record<string, string>).book, 'nora/reading')
  assertEquals(
    (both[0]._stores as Record<string, string>).loan,
    'nora/lending',
  )
})

Deno.test('an order holds across the merge, and its window cuts after it', async () => {
  let { env, reach } = await where()
  // Three books, each with a loan, written newest-last. The pages ascend the
  // opposite way from the creation order, so an answer in creation order and
  // an answer in `pages` order cannot be confused.
  let ids: string[] = []
  for (let [i, pages] of [300, 100, 200].entries()) {
    let one = eid()
    ids.push(one)
    await written(env, reach, undefined, [
      { entity: { eid: one }, doc: { title: `book ${i}` }, book: { pages } },
      { entity: { eid: one }, loan: { to: `reader ${i}` } },
    ])
  }

  let by = (line: string) =>
    read(env, reach, line).then((out) =>
      bundles(out).map((b) => comp(b, 'book').pages)
    )
  assertEquals(await by('.book!&.loan?&.book.pages>0&.order=book.pages'), [
    100,
    200,
    300,
  ])
  assertEquals(await by('.book!&.loan?&.book.pages>0&.order=-book.pages'), [
    300,
    200,
    100,
  ])
  // The window is of the ORDER, not of what each store happened to answer
  // first: the two smallest, not the two oldest.
  assertEquals(
    await by('.book!&.loan?&.book.pages>0&.order=book.pages&.limit=2'),
    [100, 200],
  )
})

Deno.test('a batch refused by one store lands in neither', async () => {
  let { env, reach } = await where()
  let dune = eid()
  await written(env, reach, undefined, [
    { entity: { eid: dune }, book: { pages: 412 }, loan: { to: 'Ada' } },
  ])

  // The lending half carries a precondition that has moved, so its store
  // refuses. The reading half was rehearsed, never committed.
  await assertRejects(() =>
    written(env, reach, undefined, [{
      entity: { eid: dune },
      book: { pages: 999 },
      loan: { to: 'Bea' },
      $was: { loan: { to: 'not what it holds' } },
    }])
  )

  let [now] = bundles(await read(env, reach, '.book!&.loan?'))
  assertEquals(comp(now, 'book').pages, 412)
  assertEquals(comp(now, 'loan').to, 'Ada')
})

Deno.test('the space speaks one vocabulary, and a word nobody declares is the platform’s', async () => {
  let { env, reach } = await where()
  let one = eid()
  // `doc` is nobody's own word, so it rides with the app whose word is in the
  // same bundle; `book` and `loan` each go to their declarer.
  let out = await written(env, reach, undefined, [
    { entity: { eid: one }, doc: { title: 'Emma' }, book: { pages: 474 } },
    { entity: { eid: '$borrowed' }, loan: { to: 'Ada' }, doc: { title: 'a' } },
  ])
  assertEquals(out.where, 'nora/reading and nora/lending')
  assert(out.aliases.$borrowed)
  assertEquals(
    bundles(await read(env, [reach[0]], '.doc!&.book?')).length,
    1,
  )
})
