/// <reference lib="deno.ns" />
// Cross-app reach over two Store objects in one space (T-33816), driven
// through the workerd stand-in @yaks/durable-object ships. Nothing between the
// fan-out and the rows is stubbed: two real `Store` objects, each with its own
// `vocab.json`, behind a `STORE` namespace that hands out whichever one the
// kernel named. What is under test is the composition — the merge by eid, the
// order settled after it, and the dry run that keeps a refused half-batch from
// landing anywhere.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, identityEid } from '@yaks/graph'
import { CallError } from '@yaks/tools'
import { durable } from '../../packages/durable-object/testing.ts'
import { Store } from './graph.ts'
import {
  type App,
  appStore,
  draftStore,
  type Space,
  storeName,
} from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { type Reach, read, written } from './reach.ts'

let space = (slug: string): Space => ({
  eid: `space-${slug}`,
  slug,
  title: slug,
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
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
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
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

test('the app version selects its store declarations after preparation', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('release-switch')
  let page = app('page', here.eid)
  let door = (version: number) =>
    appStore(env.STORE, here, { ...page, version })
  let write = async (
    version: number,
    path: string,
    value: Record<string, unknown>,
    draft = false,
  ) => {
    let send = draft
      ? draftStore(env.STORE, here, page, String(version))
      : door(version)
    let r = await send(path, {
      method: 'POST',
      body: JSON.stringify(value),
    }, vouched(owner))
    assertEquals(r.status, 200, await r.text())
  }
  let read = async (version: number, path: string) =>
    await (await door(version)(path)).json()
  let props = async (version: number) =>
    Object.keys((await read(version, '/vocab')).$defs.note.properties)
  let old = {
    $defs: {
      note: {
        component: true,
        properties: { body: { type: 'string' } },
      },
    },
  }
  let next = {
    $defs: {
      note: {
        component: true,
        properties: {
          body: { type: 'string' },
          mood: { type: 'string' },
        },
      },
    },
  }

  await write(1, '/vocab', old)
  await write(1, '/uses', { neighbor: 'other' })
  let oldTool = { description: 'old', input: {}, query: '.note' }
  let newTool = { description: 'new', input: {}, query: '.note' }
  await write(1, '/tools', { old: oldTool })
  await write(2, '/vocab', next, true)
  await write(2, '/uses', { neighbor: 'new' }, true)
  await write(2, '/tools', { new: newTool }, true)

  let raw = storeOf(env.STORE, storeName(here, page))
  let between = await (await raw('/vocab')).json()
  assertEquals(Object.keys(between.$defs.note.properties), ['body'])

  assertEquals(await props(1), ['body'])
  assertEquals(await read(1, '/uses'), { neighbor: 'other' })
  assertEquals(await read(1, '/tools'), { old: oldTool })
  let change = [{
    entity: { eid: crypto.randomUUID() },
    note: { body: 'hello', mood: 'bright' },
  }]
  let apply = (version: number) =>
    door(version)('/apply', {
      method: 'POST',
      body: JSON.stringify(change),
    }, vouched(owner))
  assertEquals((await apply(1)).status, 400)
  assertEquals(await props(2), ['body', 'mood'])
  assertEquals(await read(2, '/uses'), { neighbor: 'new' })
  assertEquals(await read(2, '/tools'), { new: newTool })
  assertEquals((await apply(2)).status, 200)
})

test('the first release serves the vocabulary it prepared', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('first-release')
  let page = { ...app('page', here.eid), version: 0 }
  let old = appStore(env.STORE, here, page)
  let next = appStore(env.STORE, here, { ...page, version: 1 })
  let draft = draftStore(env.STORE, here, page, '1')
  let manifest = {
    $defs: {
      fire: { component: true, properties: { village: { type: 'string' } } },
    },
  }
  await old('/vocab')
  let planted = await draft('/vocab', {
    method: 'POST',
    body: JSON.stringify(manifest),
  }, vouched(owner))
  assertEquals(planted.status, 200)
  await planted.body?.cancel()
  await old('/vocab')
  let docs = await (await next('/vocab.json')).json()
  assertEquals(
    docs.some((doc: { $defs?: object }) => 'fire' in (doc.$defs ?? {})),
    true,
  )
})

test('a refused draft leaves the serving app store usable', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('refused-release')
  let page = app('page', here.eid)
  let serving = appStore(env.STORE, here, page)
  let draft = draftStore(env.STORE, here, page, '2')
  let vocab = (unique: boolean) => ({
    $defs: {
      ability_design: {
        component: true,
        ...unique ? { unique: [['kind']] } : {},
        properties: { kind: { type: 'string' } },
      },
    },
  })
  let put = (door: typeof serving, path: string, body: unknown) =>
    door(path, { method: 'POST', body: JSON.stringify(body) }, vouched(owner))
  assertEquals((await put(serving, '/vocab', vocab(false))).status, 200)
  let original = await (await serving('/vocab')).json()
  assertEquals(
    (await put(serving, '/apply', [
      {
        entity: { eid: crypto.randomUUID() },
        ability_design: { kind: 'same' },
      },
      {
        entity: { eid: crypto.randomUUID() },
        ability_design: { kind: 'same' },
      },
    ])).status,
    200,
  )

  let failed = await put(draft, '/vocab', vocab(true))
  assertEquals(failed.status, 503)
  assert(
    (await failed.text()).includes('skipped unique index ability_design_kind'),
  )
  let current = await serving('/vocab')
  assertEquals(current.status, 200)
  assertEquals(await current.json(), original)
  assertEquals(
    (await put(serving, '/apply', [{
      entity: { eid: crypto.randomUUID() },
      ability_design: { kind: 'same' },
    }])).status,
    200,
  )
})

let widget = (identity: string[]) => ({
  $defs: {
    widget: {
      component: true,
      identity,
      properties: {
        owner: { type: 'string' },
        match: { type: 'string' },
        variant: { type: 'string' },
      },
    },
  },
})

let put = (door: ReturnType<typeof appStore>, path: string, body: unknown) =>
  door(path, { method: 'POST', body: JSON.stringify(body) }, vouched(owner))

test('a changed draft identity leaves serving reads and writes alone', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('draft-identity')
  let page = app('page', here.eid)
  let serving = appStore(env.STORE, here, page)
  let draft = draftStore(env.STORE, here, page, '2')
  let row = (variant: string, match?: string) => ({
    entity: { eid: identityEid('widget', ['ada', variant]) },
    widget: { owner: 'ada', ...(match ? { match } : {}), variant },
  })

  assertEquals(
    (await put(serving, '/vocab', widget(['owner', 'variant']))).status,
    200,
  )
  assertEquals((await put(serving, '/apply', [row('one')])).status, 200)
  let staged = await put(draft, '/vocab', widget(['owner', 'match']))
  assertEquals(staged.status, 200, await staged.text())
  assertEquals(
    (await (await serving('/vocab')).json()).$defs.widget.identity,
    ['owner', 'variant'],
  )
  assertEquals(
    (await (await draft('/vocab')).json()).$defs.widget.identity,
    ['owner', 'match'],
  )
  // The later rows are distinct under the serving identity. A candidate index
  // over owner + match would reject the second if it touched the schema.
  assertEquals((await put(serving, '/apply', [row('two', 'same')])).status, 200)
  assertEquals(
    (await put(serving, '/apply', [row('three', 'same')])).status,
    200,
  )
  let rows = await (await serving('/query?q=.widget', {}, vouched(owner)))
    .json()
  assertEquals(rows.length, 3)
})

test('a changed identity replaces its index when the release moves', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('released-identity')
  let page = app('page', here.eid)
  let serving = appStore(env.STORE, here, page)
  let draft = draftStore(env.STORE, here, page, '2')
  assertEquals(
    (await put(serving, '/vocab', widget(['owner', 'variant']))).status,
    200,
  )
  assertEquals(
    (await put(serving, '/apply', [{
      entity: { eid: identityEid('widget', ['ada', 'one']) },
      widget: { owner: 'ada', variant: 'one' },
    }])).status,
    200,
  )
  let staged = await put(draft, '/vocab', widget(['owner', 'match', 'variant']))
  assertEquals(staged.status, 200, await staged.text())
  let released = appStore(env.STORE, here, { ...page, version: 2 })
  assertEquals(
    (await put(released, '/apply', [{
      entity: { eid: identityEid('widget', ['ada', 'two', 'one']) },
      widget: { owner: 'ada', match: 'two', variant: 'one' },
    }])).status,
    200,
  )
  let rows = await (await released('/query?q=.widget', {}, vouched(owner)))
    .json()
  assertEquals(rows.length, 2)
})

test('a candidate seed waits for release and lands once', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('candidate-seed')
  let page = app('page', here.eid)
  let serving = appStore(env.STORE, here, page)
  let draft = draftStore(env.STORE, here, page, '2')
  let vocab = (component: string) => ({
    $defs: {
      [component]: {
        component: true,
        properties: { title: { type: 'string' } },
      },
    },
  })
  let eid = crypto.randomUUID()
  let seed = [{ entity: { eid }, card: { title: 'seeded' } }]
  assertEquals((await put(serving, '/vocab', vocab('note'))).status, 200)
  assertEquals((await put(draft, '/vocab', vocab('card'))).status, 200)
  assertEquals(
    (await put(draft, '/seed', [
      { entity: { eid: crypto.randomUUID() }, missing: { title: 'bad' } },
    ])).status,
    400,
  )
  assertEquals(
    (await put(serving, '/apply', [
      {
        entity: { eid: crypto.randomUUID() },
        note: { title: 'still serving' },
      },
    ])).status,
    200,
  )
  let staged = await put(draft, '/seed', seed)
  assertEquals(staged.status, 200, await staged.text())
  assertEquals(
    (await serving('/query?q=.card', {}, vouched(owner))).status,
    400,
  )
  assertEquals(
    (await (await serving('/vocab')).json()).$defs.card,
    undefined,
  )
  let released = appStore(env.STORE, here, { ...page, version: 2 })
  let rows = await (await released('/query?q=.card', {}, vouched(owner))).json()
  assertEquals(rows.map((row: { card: { title: string } }) => row.card.title), [
    'seeded',
  ])
  assertEquals(
    (await put(released, '/apply', [
      { entity: { eid }, card: { title: 'edited' } },
    ])).status,
    200,
  )
  let next = draftStore(env.STORE, here, { ...page, version: 2 }, '3')
  assertEquals((await put(next, '/vocab', vocab('card'))).status, 200)
  assertEquals((await put(next, '/seed', seed)).status, 200)
  let again = appStore(env.STORE, here, { ...page, version: 3 })
  let kept = await (await again('/query?q=.card', {}, vouched(owner))).json()
  assertEquals(kept.map((row: { card: { title: string } }) => row.card.title), [
    'edited',
  ])
})

test('a first release seeds its candidate words', async () => {
  let env = { STORE: namespace() } as unknown as Env
  let here = space('first-seed')
  let page = { ...app('page', here.eid), version: 0 }
  let draft = draftStore(env.STORE, here, page, '1')
  let result = await put(draft, '/vocab', {
    $defs: {
      card: { component: true, properties: { title: { type: 'string' } } },
    },
  })
  assertEquals(result.status, 200, await result.text())
  let seeded = await put(draft, '/seed', [{
    entity: { eid: crypto.randomUUID() },
    card: { title: 'hello' },
  }])
  assertEquals(seeded.status, 200, await seeded.text())
  let serving = appStore(env.STORE, here, { ...page, version: 1 })
  let rows = await (await serving('/query?q=.card', {}, vouched(owner))).json()
  assertEquals(rows.map((row: { card: { title: string } }) => row.card.title), [
    'hello',
  ])
})

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
  await deploy(env, reach[0], {
    $defs: {
      book: {
        component: true,
        properties: { pages: { type: 'number' }, shelf: { type: 'string' } },
      },
      catalog: {
        component: true,
        properties: { code: { type: 'string', identity: true } },
      },
    },
  })
  await deploy(env, reach[1], {
    $defs: {
      loan: {
        component: true,
        properties: {
          to: { type: 'string' },
          of: { type: 'string', ref: 'book', death: 'detach' },
        },
      },
    },
  })
  return { env, reach }
}

let eid = () => crypto.randomUUID()

let bundles = (out: unknown) => out as Bundle[]

let comp = (b: Bundle, name: string) =>
  (b[name] ?? {}) as Record<string, unknown>

test('a spanning read merges the two stores into one bundle per eid', async () => {
  let { env, reach } = await where()
  let dune = eid()
  await written(env, reach, undefined, [
    { entity: { eid: dune }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ])
  await written(env, reach, undefined, [
    { entity: { eid: dune }, loan: { to: 'Ada' } },
  ])

  // Each word went to the app that declared it…
  let onlyBooks = bundles(await read(env, [reach[0]], '.book'))
  assertEquals(onlyBooks.length, 1)
  assertEquals(onlyBooks[0].loan, undefined)

  // …and the read that names no app answers one bundle wearing both, saying
  // which store holds which component.
  let both = bundles(await read(env, reach, '.book&?loan'))
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

test('an order holds across the merge, and its window cuts after it', async () => {
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
  assertEquals(await by('.book&?loan&.book.pages>0&.order=book.pages'), [
    100,
    200,
    300,
  ])
  assertEquals(await by('.book&?loan&.book.pages>0&.order=-book.pages'), [
    300,
    200,
    100,
  ])
  // The window is of the order, not of what each store happened to answer
  // first: the two smallest, not the two oldest.
  assertEquals(
    await by('.book&?loan&.book.pages>0&.order=book.pages&.limit=2'),
    [100, 200],
  )
  // An order by a word the line never names, kept in the other store, is
  // gathered to sort by and left off the answer, as one store leaves it.
  let ordered = await read(env, reach, '.book&.order=loan.to')
  assertEquals(bundles(ordered).map((b) => comp(b, 'book').pages), [
    300,
    100,
    200,
  ])
  assert(bundles(ordered).every((b) => !b.loan && !b._stores))
  // An order the space's words cannot settle is the caller's line refused,
  // as one store refuses it, and never a failure of ours.
  await assertRejects(
    () => read(env, reach, '.book&?loan&.order=created'),
    CallError,
    'a component where a property belongs: created — try created.',
  )
})

test('a batch refused by one store lands in neither', async () => {
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

  let [now] = bundles(await read(env, reach, '.book&?loan'))
  assertEquals(comp(now, 'book').pages, 412)
  assertEquals(comp(now, 'loan').to, 'Ada')
})

// The door mints every `$alias` itself, so the alias has to ride to the store
// that writes the part — it is what tells a store's mint phase an id this door
// picked from one the caller wrote down. Dropped in the split, a named row
// written twice was refused as a clash instead of patching its holder.
test('a name written twice through the door is one entity', async () => {
  let { env, reach } = await where()
  let seed = async (pages: number) => {
    let out = await written(env, reach, reach[0], [{
      entity: { eid: '$r' },
      alias: { name: 'book:dune' },
      book: { pages },
    }])
    return out.aliases.$r
  }
  let once = await seed(412)
  assertEquals(await seed(500), once)
  let all = bundles(await read(env, reach, '.book'))
  assertEquals(all.map((b) => b.entity.eid), [once])
  assertEquals(comp(all[0], 'book').pages, 500)
})

test('a declared identity is minted before the door hands it to a store', async () => {
  let { env, reach } = await where()
  let out = await written(env, reach, reach[0], [{
    entity: { eid: '$catalog' },
    catalog: { code: 'dune' },
  }])
  assertEquals(out.aliases.$catalog, identityEid('catalog', ['dune']))
  assertEquals(
    bundles(await read(env, reach, '.catalog.code=dune')).map((b) =>
      b.entity.eid
    ),
    [identityEid('catalog', ['dune'])],
  )
})

test('the space speaks one vocabulary, and a word nobody declares is the platform’s', async () => {
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
    bundles(await read(env, [reach[0]], '.doc&?book')).length,
    1,
  )
})

test('a projection answers what it names, and what its paths reach across the stores', async () => {
  let { env, reach } = await where()
  let dune = eid(), lent = eid()
  await written(env, reach, undefined, [
    { entity: { eid: dune }, doc: { title: 'Dune' }, book: { pages: 412 } },
  ])
  await written(env, reach, undefined, [
    { entity: { eid: lent }, loan: { to: 'Ada', of: dune } },
  ])
  let asked = async (line: string, where = reach) =>
    bundles(await read(env, where, line))
  // One store narrows its own rows.
  assertEquals(await asked('.book&.fields=book.pages', [reach[0]]), [
    { kind: 'book', entity: { eid: dune }, book: { pages: 412 } },
  ])
  // The loan is one app's and the title of the book it names another's.
  assertEquals(await asked('.loan&.fields=loan.to,loan.of.doc.title'), [
    { kind: 'loan', entity: { eid: lent }, loan: { to: 'Ada', of: dune } },
    { kind: 'book', entity: { eid: dune }, doc: { title: 'Dune' } },
  ])
  // A stamp the projection names is answered, as a filter naming it is.
  let [stamped] = await asked('.book&.fields=book.pages,created.at')
  assertEquals(Object.keys(stamped), ['kind', 'entity', 'book', 'created'])
})
