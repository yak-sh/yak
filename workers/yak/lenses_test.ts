import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Frame } from '@yaks/api'
import type { Bundle, Comp } from '@yaks/graph'
import { versions } from '@yaks/lens'
import type { Objects } from '@yaks/blob'
import { driver } from '@yaks/durable-object'
import type { App, Directory, Space } from './directory.ts'
import { Store } from './graph.ts'
import { doorOf, IDEMPOTENCY } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import {
  latestSpeaks,
  lensDocAt,
  lensRule,
  pageSpeaks,
  retainedLenses,
} from './lenses.ts'

let name = 'throwaway/lens-recipes'
let old = {
  $defs: { recipe: { properties: { title: { type: 'string' } } } },
}
let next = {
  $defs: {
    recipe: { properties: {} },
    titles: {
      lens: true,
      step: 0,
      ops: [{ rename: { from: 'recipe.title', to: 'doc.title' } }],
    },
  },
}
let speaks = versions([lensDocAt(name, old)])
let headers = { ...KERNEL, 'x-yak-speaks': JSON.stringify(speaks) }
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = { read: { speaks } }
  return {
    readyState: 1,
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => held = v,
    deserializeAttachment: () => held,
  }
}

test('an app lens keeps old writes, reads and subscriptions through reload', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let meta = metaOf(door)
  let declare = (doc: unknown) =>
    door('/vocab', {
      method: 'POST',
      body: JSON.stringify(doc),
    }, KERNEL)
  assert((await declare(old)).ok)
  let deployed = await declare(next)
  assert(deployed.ok, await deployed.text())
  let row = { entity: { eid: 'cake' }, recipe: { title: 'Cake' } }
  await meta.apply([row], headers)
  let current = await meta.query('.recipe ?doc') as Bundle[]
  assertEquals(
    current.map((r) => [(r.recipe as Comp).title, (r.doc as Comp).title]),
    [[undefined, 'Cake']],
  )
  let held = await metaOf(door, headers).query(
    '.recipe.title~=Cake',
  ) as Bundle[]
  assertEquals((held[0].recipe as Comp).title, 'Cake')
  assertEquals((held[0].doc as Comp).title, 'Cake')

  let ws = wire()
  ctx.live.push(ws)
  store.webSocketMessage(
    ws,
    JSON.stringify({
      subscribe: '.recipe.title~=Cake',
      id: 'old',
    }),
  )
  assertEquals((ws.sent.at(-1)!.bundles![0].recipe as Comp).title, 'Cake')
  await meta.apply(
    [{ entity: row.entity, doc: { title: 'Cake again' } }],
    KERNEL,
  )
  assertEquals((ws.sent.at(-1)!.bundles![0].recipe as Comp).title, 'Cake again')

  // Rollback puts the old page vocabulary back, while retaining its bridge.
  assert((await declare(old)).ok)
  store = new Store(ctx)
  assertEquals(
    ((await metaOf(door, headers).query('.recipe.title~=again'))[0]
      .recipe as Comp)
      .title,
    'Cake again',
  )
  await meta.apply(
    [{ entity: row.entity, recipe: { title: 'Cake third' } }],
    headers,
  )
  assertEquals((ws.sent.at(-1)!.bundles![0].recipe as Comp).title, 'Cake third')
})

test('the app lens mover rehearses, consumes its source, and is idempotent', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let meta = metaOf(door)
  let declare = (doc: unknown) =>
    door('/vocab', {
      method: 'POST',
      body: JSON.stringify(doc),
    }, KERNEL)
  assert((await declare(old)).ok)
  await meta.apply([{
    entity: { eid: 'seed' },
    recipe: { title: 'Seed cake' },
  }], KERNEL)
  let deployed = await declare(next)
  assert(deployed.ok, await deployed.text())
  let rehearsal =
    await (await door('/move?rehearse=1', { method: 'POST' }, KERNEL)).json()
  assertEquals(
    rehearsal.rules.map((
      r: { rows: number; moved: number },
    ) => [r.rows, r.moved]),
    [[1, 1]],
  )
  assertEquals(
    ((await meta.query('.recipe.title'))[0].recipe as Comp).title,
    'Seed cake',
  )
  let columns = () =>
    driver(ctx.storage).query({
      t: 'pragma',
      name: 'table_info',
      arg: 'recipe',
    }).map((c) => c.name)
  assert(columns().includes('title'))
  let rule = lensRule(name, next)!
  store = new Store(ctx)
  await store.alarm()
  await assertRejects(() => meta.query('.recipe.title'))
  let [moved] = await meta.query('.recipe ?doc')
  assertEquals([(moved.recipe as Comp).title, (moved.doc as Comp).title], [
    undefined,
    'Seed cake',
  ])
  assertEquals(rule.move(moved), [])
  assert(!columns().includes('title'))
  assertEquals(
    ((await metaOf(door, headers).query('.recipe.title~=Seed'))[0]
      .recipe as Comp).title,
    'Seed cake',
  )
  assert((await declare(old)).ok)
  assert(!columns().includes('title'))
  store = new Store(ctx)
  assert(!columns().includes('title'))
  await meta.apply(
    [{ entity: moved.entity, recipe: { title: 'Seed again' } }],
    headers,
  )
  assertEquals(
    ((await meta.query('.recipe ?doc'))[0].doc as Comp).title,
    'Seed again',
  )
  assertEquals(
    (await (await door('/move?rehearse=1', { method: 'POST' }, KERNEL)).json())
      .rules[0].moved,
    0,
  )
})

test('a conflicting old lens write refuses the whole batch', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let deployed = await door('/vocab', {
    method: 'POST',
    body: JSON.stringify(next),
  }, KERNEL)
  assert(deployed.ok, await deployed.text())
  let response = await door('/apply', {
    method: 'POST',
    body: JSON.stringify([
      { entity: { eid: 'good' }, recipe: { title: 'Fine' } },
      {
        entity: { eid: 'bad' },
        recipe: { title: 'Old' },
        doc: { title: 'Different' },
      },
    ]),
  }, headers)
  assertEquals(response.status, 400)
  assertEquals(await metaOf(door).query('.recipe'), [])
})

test('a code rollback retains an empty destination schema and immutable steps', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let declare = (doc: unknown) =>
    door('/vocab', {
      method: 'POST',
      body: JSON.stringify(doc),
    }, KERNEL)
  let moved = {
    $defs: {
      recipe: { properties: {} },
      heading: { properties: { text: { type: 'string' } } },
      titles: {
        lens: true,
        step: 0,
        ops: [{ rename: { from: 'recipe.title', to: 'heading.text' } }],
      },
    },
  }
  assert((await declare(old)).ok)
  let deployed = await declare(moved)
  assert(deployed.ok, await deployed.text())
  assert((await declare(old)).ok)
  store = new Store(ctx)
  let meta = metaOf(door)
  await meta.apply(
    [{ entity: { eid: 'empty' }, recipe: { title: 'Cake' } }],
    headers,
  )
  assertEquals(
    ((await meta.query('.recipe ?heading'))[0].heading as Comp).text,
    'Cake',
  )
  let changed = {
    $defs: {
      ...moved.$defs,
      titles: {
        ...moved.$defs.titles,
        ops: [{ rename: { from: 'recipe.title', to: 'doc.title' } }],
      },
    },
  }
  assert((await declare(changed)).status >= 400)
  assertEquals(
    ((await metaOf(door, headers).query('.recipe'))[0].recipe as Comp).title,
    'Cake',
  )
})

test('a current pinned page omits the bridge, while a rollback keeps its old version', async () => {
  let lookups = 0
  let reads = 0
  let app = {
    eid: crypto.randomUUID(),
    slug: 'recipes',
    store: name,
    version: 2,
    lenses: latestSpeaks(name, next),
  } as App
  let space = { slug: 'throwaway' } as Space
  let dir = {
    deploys: () => {
      lookups++
      return Promise.resolve([
        { version: 1, files: { 'vocab.json': 'old' } },
        { version: 2, files: { 'vocab.json': 'next' } },
      ])
    },
  } as unknown as Directory
  let blobs = {
    read: (key: string) => {
      reads++
      let bytes = new TextEncoder().encode(JSON.stringify(
        key.endsWith('/next') ? next : old,
      ))
      return Promise.resolve(bytes)
    },
  } as Objects
  let head = (version: number) =>
    pageSpeaks(
      new Request('https://throwaway.yaks.app/recipes/api/query', {
        headers: { 'x-yak-version': String(version) },
      }),
      dir,
      blobs,
      space,
      app,
      (source) => JSON.parse(source),
    )
  assertEquals(await head(2), {})
  assertEquals(await head(2), {})
  assertEquals([lookups, reads], [1, 1])
  app.version = 1
  app.lenses = latestSpeaks(name, old, app.lenses)
  assertEquals(await head(1), { 'x-yak-speaks': JSON.stringify(speaks) })
  assertEquals(await head(2), {})
})

test('a later step gets its own mover stamp after the first step finished', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let meta = metaOf(door)
  let declare = (doc: unknown) =>
    door('/vocab', {
      method: 'POST',
      body: JSON.stringify(doc),
    }, KERNEL)
  await declare(old)
  await meta.apply(
    [{ entity: { eid: 'two' }, recipe: { title: 'Cake' } }],
    KERNEL,
  )
  await declare(next)
  store = new Store(ctx)
  await store.alarm()
  let twice = {
    $defs: {
      ...next.$defs,
      heading: { properties: { text: { type: 'string' } } },
      heading_step: {
        lens: true,
        step: 1,
        ops: [{ rename: { from: 'doc.title', to: 'heading.text' } }],
      },
    },
  }
  let deployed = await declare(twice)
  assert(deployed.ok, await deployed.text())
  store = new Store(ctx)
  await store.alarm()
  assertEquals(
    ((await meta.query('.recipe ?heading'))[0].heading as Comp).text,
    'Cake',
  )
  assertEquals(await meta.query('.recipe .doc.title'), [])
})

test('timestamp steps append in landing order and survive rollback', () => {
  let first = {
    $defs: {
      ...next.$defs,
      titles: { ...next.$defs.titles, step: 20261003140000 },
    },
  }
  let second = {
    $defs: {
      ...first.$defs,
      heading_step: {
        lens: true,
        step: 20261004102000,
        ops: [{ rename: { from: 'doc.title', to: 'heading.text' } }],
      },
    },
  }
  let latest = latestSpeaks(name, second)!
  assertEquals(Object.values(latest), [20261004102000])
  assertEquals(latestSpeaks(name, first, latest), latest)
  let rollback = retainedLenses(second, old)
  assertEquals(Object.values(versions([lensDocAt(name, rollback)])), [
    20261004102000,
  ])
  let refused = false
  try {
    retainedLenses(second, {
      $defs: {
        ...second.$defs,
        late_branch: { ...first.$defs.titles, step: 20261003150000 },
      },
    })
  } catch {
    refused = true
  }
  assert(refused)
})

test('old apply replies and keyed resends speak the caller vocabulary', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let door = doorOf((r) => store.fetch(r), name)
  let renamed = {
    $defs: {
      recipe: { properties: { heading: { type: 'string' } } },
      title_step: {
        lens: true,
        step: 20261003140000,
        ops: [{ rename: { from: 'recipe.title', to: 'recipe.heading' } }],
      },
    },
  }
  assert(
    (await door(
      '/vocab',
      { method: 'POST', body: JSON.stringify(renamed) },
      KERNEL,
    )).ok,
  )
  let entity = { eid: crypto.randomUUID() }
  let body = JSON.stringify([{ entity, recipe: { title: 'Cake' } }])
  let sent = { ...headers, [IDEMPOTENCY]: crypto.randomUUID() }
  let apply = () => door('/apply', { method: 'POST', body }, sent)
  let first = await (await apply()).json()
  let resent = await (await apply()).json()
  assertEquals(first, resent)
  assertEquals(first.find((r: Bundle) => r.entity.eid == entity.eid).recipe, {
    title: 'Cake',
  })
  assertEquals((await metaOf(door).query('.recipe'))[0].recipe as Comp, {
    heading: 'Cake',
  })
})
