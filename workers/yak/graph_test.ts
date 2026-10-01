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
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { stub } from '@std/testing/mock'
import type { Frame } from '@yaks/api'
import { type Bundle, type Rule, sha256 } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { doorOf, PLATFORM_STORE } from './door.ts'
import { grantEid, Store } from './graph.ts'
import { metaOf } from './meta.ts'
import type { Plugin } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { named as spoken, type Names } from './listing.ts'
import { col, isNull, tally } from '@yaks/sql'
import { db, slot, unclassified } from './testing.ts'

// A hibernatable socket, faked: what it was sent, and the attachment that is
// its only memory across an eviction.
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  let state = 1
  return {
    sent,
    get readyState() {
      return state
    },
    send: (data: string) => {
      if (state != 1) {
        throw new TypeError("Can't call WebSocket send() after close().")
      }
      sent.push(JSON.parse(data))
    },
    close: () => state = 2,
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
  kernel?: boolean
}

let headers = (v: Vouch = {}): Record<string, string> => ({
  'x-store': 'ada/cookbook',
  ...(v.app ? { 'x-yak-app': v.app } : {}),
  ...(v.access ? { 'x-yak-access': v.access } : {}),
  ...(v.person ? { 'x-yak-person': v.person } : {}),
  ...(v.role ? { 'x-yak-role': v.role } : {}),
  ...(v.title ? { 'x-yak-title': v.title } : {}),
  ...(v.kernel ? { 'x-yak-kernel': '1' } : {}),
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

test('each store response reports the SQL it ran for that fetch', async () => {
  let ctx = state()
  using _db = ctx.storage
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  let calls = 0
  ctx.storage.sql.exec = (query, ...bindings) => {
    calls++
    return exec(query, ...bindings)
  }
  let store = new Store(ctx)
  let first = await get(store, '/vocab')
  let measured = Number(first.headers.get('x-yak-stmts'))
  assert(measured > 0 && measured <= calls)
  let before = calls
  let second = await get(store, '/vocab')
  measured = Number(second.headers.get('x-yak-stmts'))
  assert(measured > 0 && measured <= calls - before)
})

test('a Store row profile attributes SQL to the HTTP route', async () => {
  let ctx = state()
  using _db = ctx.storage
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (query, ...bindings) => {
    let cursor = exec(query, ...bindings)
    let drained = false
    return {
      toArray: () => {
        let rows = cursor.toArray()
        drained = true
        return rows
      },
      [Symbol.iterator]: () => cursor[Symbol.iterator](),
      get rowsRead() {
        return drained ? 1 : 0
      },
      get rowsWritten() {
        return 0
      },
    }
  }
  let at = Date.now()
  using _clock = stub(Date, 'now', () => at)
  using logged = stub(console, 'log')
  let store = new Store(ctx)
  let vouch = { ...headers(owner), 'x-store': 'yourname/vale.f52dc2' }
  let request = (path: string, method = 'GET', body?: string) =>
    new Request(`http://store${path}`, { method, headers: vouch, body })

  assertEquals(
    (await store.fetch(request('/vocab', 'POST', SCHEMA))).status,
    200,
  )
  at++
  assertEquals((await store.fetch(request('/query?q=.recipe'))).status, 200)
  at += 60_000
  assertEquals((await store.fetch(request('/query?q=.recipe'))).status, 200)

  let reports = logged.calls
    .filter((call) => call.args[0] == 'yak store rows')
    .map((call) => JSON.parse(String(call.args[1])))
  let query = reports.flatMap((report) => report.operations)
    .find((operation) => operation.kind == 'GET /query')
  assert(query)
  assert(query.total.calls > 0)
  assert(query.total.rowsRead > 0)
  assertEquals(
    query.statements.every((entry: { shape: string }) =>
      !entry.shape.includes('yourname/vale.f52dc2')
    ),
    true,
  )
})

let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let CAKE = 'c0000000-0000-4000-8000-000000000003'

// The app every test here deploys: one component, one property, in the one
// format a vocab.json is written in.
let SCHEMA = JSON.stringify({
  $defs: {
    recipe: {
      component: true,
      properties: { serves: { type: 'number' } },
    },
  },
})

let owner: Vouch = { app: APP, person: ADA, role: 'owner', title: 'Ada' }

// The byline off a returned bundle. `Bundle` carries any component, so a test
// reading one names the shape it expects.
let by = (b: Bundle) => (b.created as { by?: string } | undefined)?.by ?? null

// A store with the app deployed into it, which is where every test starts.
let cookbook = async (ctx = state(), manifest = SCHEMA, v = owner) => {
  let store = new Store(ctx)
  assertEquals((await post(store, '/vocab', manifest, v)).status, 200)
  return store
}

test('erasing a Store closes its subscribers and serves the empty Store', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = await cookbook(ctx)
  let ws = wire()
  ctx.live.push(ws)
  store.webSocketMessage(ws, JSON.stringify({ subscribe: '.recipe', id: 'r' }))
  assertEquals(ws.sent.length, 1)

  let erased = await store.fetch(
    new Request('http://store/', {
      method: 'DELETE',
      headers: headers({ ...owner, kernel: true }),
    }),
  )
  assertEquals(erased.status, 200, await erased.text())
  assertEquals(ws.readyState, 2)
  assertEquals(ws.sent.length, 1)
  assertEquals((await get(store, '/vocab', owner)).status, 200)
})

test('a kernel apply dry run returns the patch without keeping it', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = new Store(ctx)
  let kernel = { kernel: true }
  let eid = crypto.randomUUID()
  let patch = [{ entity: { eid }, doc: { title: 'Draft' } }]
  let q = `/query?q=${encodeURIComponent(`.entity.eid=${eid}&.doc`)}`
  let checked = await post(store, '/apply?check=1', patch, kernel)
  assertEquals(checked.status, 200, await checked.clone().text())
  let applied = await checked.json()
  assertEquals(applied[0].doc.title, 'Draft')
  assertEquals(await (await get(store, q, kernel)).json(), [])
  let committed = await post(store, '/apply', patch, kernel)
  assertEquals(committed.status, 200, await committed.text())
  let [row] = await (await get(store, q, kernel)).json()
  assertEquals(row.doc.title, 'Draft')
})

test('a Store checks a large delete as one batch', async () => {
  let ctx = state()
  using _db = ctx.storage
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (sql, ...params) => {
    if (params.length > 100) throw new Error('too many SQL variables')
    return exec(sql, ...params)
  }
  let store = await cookbook(ctx)
  let ids = Array.from({ length: 230 }, (_, i) => `recipe-${i}`)
  let seed = await post(
    store,
    '/apply',
    ids.map((eid, i) => ({
      entity: { eid },
      recipe: { serves: i },
    })),
    owner,
  )
  assertEquals(seed.status, 200, await seed.text())

  let checked = await post(
    store,
    '/apply?check=1',
    ids.map((eid) => ({
      entity: { eid },
      $delete: true,
    })),
    owner,
  )
  assertEquals(checked.status, 200, await checked.text())
  let still = await get(store, '/query?q=.recipe%26.count', owner)
  assertEquals(await still.json(), { count: ids.length })
})

test('a Store commits a large delete within its operation budget', async () => {
  let ctx = state()
  using _db = ctx.storage
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  let budget = false
  let calls = 0
  ctx.storage.sql.exec = (sql, ...params) => {
    if (budget && ++calls > 1500) {
      throw new Error('storage operation exceeded timeout')
    }
    return exec(sql, ...params)
  }
  let store = await cookbook(
    ctx,
    JSON.stringify({
      $defs: {
        recipe: {
          component: true,
          properties: { serves: { type: 'number' } },
        },
        move: {
          component: true,
          properties: {
            reach: { type: 'number', minimum: 0, validate: true },
          },
        },
      },
    }),
  )
  let ids = Array.from({ length: 307 }, () => crypto.randomUUID())
  let seed = await post(
    store,
    '/apply',
    ids.map((eid, i) => ({
      entity: { eid },
      recipe: { serves: i },
    })),
    owner,
  )
  assertEquals(seed.status, 200, await seed.text())

  budget = true
  let deleted = await post(
    store,
    '/apply',
    ids.map((eid) => ({
      entity: { eid },
      $delete: true,
    })),
    owner,
  )
  budget = false
  assertEquals(deleted.status, 200, await deleted.text())
  let remaining = await get(store, '/query?q=.recipe%26.count', owner)
  assertEquals(await remaining.json(), { count: 0 })
})

test('an app store admits only values matching opted-in nested schemas', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = await cookbook(
    ctx,
    JSON.stringify({
      $defs: {
        move: {
          component: true,
          properties: {
            reach: { type: 'number', minimum: 0, maximum: 3, validate: true },
            effects: {
              type: 'array',
              validate: true,
              minItems: 1,
              allOf: [{
                contains: {
                  type: 'object',
                  properties: { kind: { const: 'damage' } },
                  required: ['kind'],
                },
                minContains: 0,
                maxContains: 1,
              }],
              items: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['kind', 'scale'],
                    additionalProperties: false,
                    properties: {
                      kind: { const: 'damage' },
                      scale: { type: 'number', exclusiveMinimum: 0 },
                    },
                  },
                  {
                    type: 'object',
                    required: ['kind', 'ms'],
                    additionalProperties: false,
                    properties: {
                      kind: { const: 'stun' },
                      ms: { type: 'number', minimum: 0 },
                    },
                  },
                ],
              },
            },
          },
          required: ['effects'],
        },
      },
    }),
  )
  let row = (effects: unknown) => [{
    entity: { eid: CAKE },
    move: { effects, reach: 2 },
  }]
  assertEquals(
    (await post(store, '/apply', row([{ kind: 'damage', scale: 2 }]), owner))
      .status,
    200,
  )
  for (
    let invalid of [
      [],
      [{ kind: 'damage', scale: -1 }],
      [{ kind: 'damage', scale: 2, ms: 50 }],
      [{ kind: 'damage', scale: 2 }, { kind: 'damage', scale: 1 }],
      [{ kind: 'other', scale: 2 }],
    ]
  ) {
    let refused = await post(store, '/apply', row(invalid), owner)
    assertEquals(refused.status, 400, await refused.text())
  }
  let missing = await post(store, '/apply', [{
    entity: { eid: APP },
    move: {},
  }], owner)
  let said = await missing.json()
  assertEquals(missing.status, 400, JSON.stringify(said))
  assertStringIncludes(said.message, 'move.effects is required')
  let far = await post(store, '/apply', [{
    entity: { eid: CAKE },
    move: { reach: 4 },
  }], owner)
  assertEquals(far.status, 400, await far.text())
  let saved = await get(store, '/query?q=.move', owner)
  assertEquals((await saved.json())[0].move.effects, [{
    kind: 'damage',
    scale: 2,
  }])
})

test('an app store bounds a derived value over the final patched row', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = await cookbook(
    ctx,
    JSON.stringify({
      $defs: {
        move: {
          component: true,
          properties: {
            effects: {
              type: 'array',
              validate: true,
              minItems: 1,
              items: {
                type: 'object',
                required: ['scale'],
                properties: { scale: { type: 'number', minimum: 0 } },
              },
            },
          },
          constraints: [{
            name: 'cost',
            value: {
              sum: [{
                each: 'effects',
                product: [{ field: 'scale' }],
              }],
            },
            maximum: 3,
            message: 'move exceeds its budget',
          }],
        },
      },
    }),
  )
  let row = (eid: string, scale: number) => ({
    entity: { eid },
    move: { effects: [{ scale }] },
  })
  assertEquals((await post(store, '/apply', [row(CAKE, 2)], owner)).status, 200)
  let denied = await post(store, '/apply', [row('too-strong', 4)], owner)
  assertEquals(denied.status, 400, await denied.text())
  denied = await post(store, '/apply', [row(CAKE, 4)], owner)
  assertEquals(denied.status, 400, await denied.text())
  // The invalid intermediate write cannot be hidden by a later patch.
  denied = await post(store, '/apply', [row(CAKE, 4), row(CAKE, 1)], owner)
  assertEquals(denied.status, 400, await denied.text())
  assertEquals(
    (await post(store, '/apply', [row(CAKE, 1), row(CAKE, 2)], owner))
      .status,
    200,
  )
  let saved = await get(store, '/query?q=.move', owner)
  assertEquals((await saved.json())[0].move.effects, [{ scale: 2 }])
})

test('a declared rule cannot write a value outside an app constraint', async () => {
  let ctx = state()
  using _db = ctx.storage
  let store = await cookbook(
    ctx,
    JSON.stringify({
      $defs: {
        move: {
          component: true,
          properties: { cost: { type: 'number' } },
          constraints: [{
            name: 'cost',
            value: { sum: [{ product: [{ field: 'cost' }] }] },
            maximum: 3,
            message: 'move exceeds its budget',
          }],
        },
        trigger: { component: true, properties: {} },
        inflate: { rule: true, match: '.trigger, +!move, +move.cost=4' },
      },
    }),
  )
  let denied = await post(store, '/apply', [{
    entity: { eid: CAKE },
    trigger: {},
  }], owner)
  assertEquals(denied.status, 400, await denied.text())
  let saved = await get(store, '/query?q=.trigger', owner)
  assertEquals(await saved.json(), [])
})

for (let aggregate of [false, true]) {
  test(`store ${aggregate ? 'aggregate' : 'listing'} query failures log the door and the request id`, async () => {
    let store = await cookbook()
    let error = new Error('query storage failed')
    using _broken = stub(store.door.graph, aggregate ? 'rows' : 'read', () => {
      throw error
    })
    using logged = stub(console, 'error')
    let response = await get(
      store,
      `/query?q=${aggregate ? '.count' : '.recipe'}`,
      owner,
    )
    assertEquals(response.status, 500)
    assertEquals(await response.json(), {
      error: 'Error',
      message: error.message,
    })
    let id = response.headers.get('x-request-id')
    assertEquals(logged.calls.map((c) => c.args), [[
      `GET /query (request ${id}) failed —`,
      error,
    ]])
  })
}

// A line that does not parse, or names a property its component does not
// declare, is the caller's mistake: a 400 in the store's own words, and
// nothing logged as the store's failure.
test('a malformed query is a 400 to the caller, not a failure', async () => {
  let store = await cookbook()
  using logged = stub(console, 'error')
  for (
    let [q, error, said] of [
      ['.recipe!', 'SyntaxError', '.recipe! is written .recipe'],
      ['.recipe&.doc?&.count', 'SyntaxError', '.doc? is written ?doc'],
      [
        '.recipe.nope=1',
        'Unknown',
        'unknown property: recipe.nope — recipe has',
      ],
    ]
  ) {
    let response = await get(store, `/query?q=${encodeURIComponent(q)}`, owner)
    assertEquals(response.status, 400, q)
    let body = await response.json()
    assertEquals(body.error, error)
    assertStringIncludes(body.message, said)
    // A property its component lacks is answered with that component's shape,
    // never with where a component of your own comes from.
    assertEquals(body.message.includes('vocab.json'), false, q)
    // And a door reading the store (apps.ts `/api/query`) hands the caller
    // that sentence as it came, not the envelope it travelled in.
    let e = await assertRejects(
      () =>
        metaOf(
          doorOf((req) =>
            get(
              store,
              new URL(req.url).pathname + new URL(req.url).search,
              owner,
            ), 'test'),
        ).query(q),
      Error,
    )
    assertEquals(
      [e.message, e.name, Reflect.get(e, 'status')],
      [body.message, error, 400],
    )
  }
  assertEquals(logged.calls.length, 0)
})

// The words a store declares, as it answers them.
let words = async (store: Store) =>
  (await (await get(store, '/vocab')).json()).$defs

// What a store keeps is the document, so a keyword a property declares is still
// on it when the kernel reads the manifest back (T-37546).
test("an app's vocab.json is read back as the document it means", async () => {
  assertEquals(
    (await words(await cookbook())).recipe.properties,
    { serves: { type: 'number' } },
  )
  let searched = await cookbook(
    state(),
    JSON.stringify({
      $defs: {
        recipe: {
          component: true,
          type: 'object',
          properties: { method: { type: 'string', search: true } },
        },
      },
    }),
  )
  assertEquals((await words(searched)).recipe.properties, {
    method: { type: 'string', search: true },
  })
})

test('stores holding different words each wake speaking their own', async () => {
  let kitchen = state(), yard = state()
  await cookbook(kitchen)
  await cookbook(
    yard,
    JSON.stringify({
      $defs: {
        plant: {
          component: true,
          properties: { height: { type: 'number' } },
        },
      },
    }),
  )
  // A freshly woken object, written one component.
  let wrote = async (ctx: ReturnType<typeof state>, words: object) =>
    (await post(
      new Store(ctx),
      '/apply',
      [{ ...words, entity: { eid: CAKE } }],
      owner,
    ))
      .status
  let recipe = { recipe: { serves: 2 } }
  let plant = { plant: { height: 3 } }
  for (let _ of [1, 2]) {
    assertEquals([await wrote(kitchen, recipe), await wrote(kitchen, plant)], [
      200,
      400,
    ])
    assertEquals([await wrote(yard, plant), await wrote(yard, recipe)], [
      200,
      400,
    ])
  }
})

test('a manifest the vocabulary refuses leaves the store as it was', async () => {
  let store = await cookbook()
  let was = await words(store)
  let no = await post(
    store,
    '/vocab',
    '{"$defs": {"doc": {"properties": {"headline": {"type": "string"}}}}}',
    owner,
  )
  assertEquals(no.status, 400)
  assert((await no.json()).message.includes('doc'))
  assertEquals(await words(store), was)
})

test('an app store refuses a malformed score declaration', async () => {
  let store = new Store(state())
  let manifest = JSON.stringify({
    $defs: {
      move: {
        component: true,
        properties: { cost: { type: 'number' } },
        constraints: [{
          name: 'cost',
          value: { sum: [{ product: [{ unknown: 'cost' }] }] },
          maximum: 3,
          message: 'move exceeds its budget',
        }],
      },
    },
  })
  let refused = await post(store, '/vocab', manifest, owner)
  assertEquals(refused.status, 400)
  assertStringIncludes((await refused.json()).message, 'move.constraints')
})

test('a property says its type', async () => {
  let store = await cookbook()
  let was = await words(store)
  let no = await post(
    store,
    '/vocab',
    '{"$defs": {"dish": {"properties": {"c": {"enum": ["a"]}}}}}',
    owner,
  )
  assertEquals(no.status, 400)
  assertStringIncludes((await no.json()).message, 'dish.c declares no type')
  assertEquals(await words(store), was)
})

// A query's answer from a store, whatever its status.
let asked = async (store: Store, q: string) => {
  let r = await get(store, `/query?q=${encodeURIComponent(q)}`, owner)
  return { status: r.status, body: await r.json() }
}

// An object, a list and a union are written and read back as themselves, and a
// filter asks only whether one is there (docs/components.md).
test('an app keeps objects and arrays, and asks only whether one is there', async () => {
  let store = await cookbook(
    state(),
    JSON.stringify({
      $defs: {
        dish: {
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
            makes: { type: 'object' },
            size: { type: ['string', 'number'] },
          },
        },
      },
    }),
  )
  let dish = {
    tags: ['bread', 'vegan'],
    makes: { amount: 1, unit: 'tray' },
    size: 'large',
  }
  let wrote = await post(store, '/apply', [
    { entity: { eid: CAKE }, dish },
    { entity: { eid: APP }, dish: { size: 4 } },
  ], owner)
  assertEquals(wrote.status, 200)
  let tagged = await asked(store, '.dish.tags')
  assertEquals(tagged.body.map((r: Bundle) => r.dish), [dish])
  assertEquals((await asked(store, '.dish.size')).body.length, 2)
  for (let q of ['.dish.tags=vegan', '.dish.makes~=tray', 'order=dish.tags']) {
    let no = await asked(store, q)
    assertEquals(no.status, 400, q)
    assertStringIncludes(no.body.message, 'holds a JSON value', q)
  }
  // The value is held to its type, and a list is not an object.
  let wrong = await post(store, '/apply', [
    { entity: { eid: CAKE }, dish: { makes: ['tray'] } },
  ], owner)
  assertEquals(wrong.status, 400)
  assertStringIncludes((await wrong.json()).message, 'dish.makes is an object')
})

// A property's type is kept by the values written under it: one that holds
// nothing takes a new type, and one that holds values keeps its own.
test('a property that holds nothing may change its type', async () => {
  let dish = (tags: object) =>
    JSON.stringify({
      $defs: { dish: { properties: { tags, n: { type: 'number' } } } },
    })
  let store = await cookbook(state(), dish({ type: 'string', format: 'json' }))
  let redeploy = await post(store, '/vocab', dish({ type: 'array' }), owner)
  assertEquals(redeploy.status, 200)
  assertEquals((await redeploy.json()).added, ['dish.tags'])
  let wrote = await post(store, '/apply', [
    { entity: { eid: CAKE }, dish: { tags: ['a'], n: 1 } },
  ], owner)
  assertEquals(wrote.status, 200)
  assertEquals((await asked(store, '.dish')).body[0].dish, {
    tags: ['a'],
    n: 1,
  })
  let no = await post(store, '/vocab', dish({ type: 'object' }), owner)
  assertEquals(no.status, 400)
  assertStringIncludes((await no.json()).message, 'dish.tags is already array')
})

{
  test('a bundle applies and queries back', async () => {
    let store = await cookbook()

    let wrote = await post(store, '/apply', [{
      entity: { eid: CAKE },
      doc: { title: 'Lemon drizzle', body: 'three lemons' },
      recipe: { serves: 8 },
    }], owner)
    assertEquals(wrote.status, 200)
    // The batch as applied, plus everything the graph synthesized: the byline
    // the stamp phase wrote, riding a bundle of its own. No number rides with
    // it — an app's store does not load @yaks/id, so the eid its client minted
    // is the whole of what an entity here is called (T-37831).
    let applied = await wrote.json() as Bundle[]
    assertEquals(applied[0].entity.eid, CAKE)
    assert(applied.every((b) => b.entity.num == null))
    assert(applied.some((b) => by(b) == ADA))

    // An answer carries the components the line names and no more, so the doc
    // is asked for beside the recipe (@yaks/graph `wanted`).
    let read = await (await get(
      store,
      `/query?q=${encodeURIComponent('.recipe&?doc')}`,
      owner,
    )).json()
    assertEquals(read.length, 1)
    assertEquals(read[0].recipe.serves, 8)
    assertEquals(read[0].doc.title, 'Lemon drizzle')
    // @yaks/blob swapped the body for its address on the way in and back on
    // the way out; neither `doc` nor the app was told.
    assertEquals(read[0].doc.body, 'three lemons')
  })
}

test('the writer the kernel vouched for is a person here, by name', async () => {
  let store = await cookbook()
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], owner)
  let [ada] = await (await get(
    store,
    `/query?q=${encodeURIComponent('.person&?doc')}`,
    owner,
  )).json()
  assertEquals(ada.entity.eid, ADA)
  assertEquals(ada.doc.title, 'Ada')
})

test('an edge is a sentence, and the relation is a word the store knows', async () => {
  let store = await cookbook()
  let wrote = await post(store, '/apply', [
    { entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } },
    { entity: { eid: APP }, doc: { title: 'Cookbook' } },
    { entity: { eid: '$link' }, edge: { from: APP, to: CAKE }, contains: {} },
  ], owner)
  assertEquals(wrote.status, 200)
  let links = await (await get(
    store,
    `/query?q=${encodeURIComponent('.contains&?edge')}`,
    owner,
  ))
    .json()
  assertEquals(links.length, 1)
  assertEquals(links[0].edge.from, APP)
  assertEquals(links[0].edge.to, CAKE)
})

test('/ws without an upgrade is not a door', async () => {
  let store = await cookbook()
  assertEquals((await get(store, '/ws', owner)).status, 405)
})

test('a Store live query sees only connected peer positions', async () => {
  let ctx = state()
  let manifest = JSON.stringify({
    $defs: {
      recipe: { component: true, properties: { serves: { type: 'number' } } },
      position: {
        component: true,
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' }, z: { type: 'number' } },
      },
    },
  })
  let store = await cookbook(ctx, manifest)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], owner)
  let ws = wire()
  ctx.live.push(ws)
  let path = `/query?live=1&q=${
    encodeURIComponent(`.entity.eid=${CAKE}&.position`)
  }`
  let positions = async () =>
    await (await get(store, path, owner)).json() as Bundle[]
  assertEquals(await positions(), [])
  await store.webSocketMessage(
    ws,
    JSON.stringify({
      relay: [{ entity: { eid: CAKE }, position: { x: 4, z: 7 } }],
    }),
  )
  assertEquals((await positions())[0].position, { x: 4, z: 7 })
  let count = await get(
    store,
    `/query?live=1&q=${encodeURIComponent('.position&.count')}`,
    owner,
  )
  assertEquals(await count.json(), { count: 1 })
  await store.webSocketClose(ws)
  assertEquals(await positions(), [])
})

test('a subscription is answered, and a commit reaches the socket', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  let ws = wire()
  ctx.live.push(ws)

  store.webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.recipe', id: 'r' }),
  )
  assertEquals(ws.sent, [{ id: 'r', bundles: [], transientReset: [] }])

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

test("a page's subscription leaves out the platform's rows unless it names one", async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
  }], owner)
  let ws = wire()
  ctx.live.push(ws)
  let eids = (line: string) => {
    ws.sent.length = 0
    store.webSocketMessage(ws, JSON.stringify({ subscribe: line, id: line }))
    return (ws.sent[0] as { bundles: Bundle[] }).bundles.map((b) =>
      b.entity.eid
    )
  }
  // The store minted Ada a person row wearing her name as a `doc` title.
  assertEquals(eids('.doc'), [CAKE])
  assertEquals(eids('.person&?doc'), [ADA])
})

// `*` is the grammar's widest projection, so one reading of the line serves
// both doors: it used to be cut out of `/query`'s line by hand and handed to
// `subs.open` whole, where it reached @yaks/match as a full-text term nothing
// matches — the subscription answered empty and stayed silent forever (T-34070).
test('a subscription asking `*` answers what /query answers', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  let ws = wire()
  ctx.live.push(ws)
  let line = '.recipe&*'

  store.webSocketMessage(ws, JSON.stringify({ subscribe: line, id: 'r' }))
  assertEquals(ws.sent, [{ id: 'r', bundles: [], transientReset: [] }])

  await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { title: 'Lemon drizzle' },
    recipe: { serves: 8 },
  }], owner)
  assertEquals(ws.sent.length, 2)
  let pushed = ws.sent[1] as Frame & Names & { bundles: Bundle[] }
  assertEquals(pushed.id, 'r')
  // The row in the store's own words, so a page's @yaks/client lands it as it
  // is, and who that is said beside it.
  assertEquals(by(pushed.bundles[0]), ADA)
  assertEquals(pushed.names, { [ADA]: 'Ada' })
  // Every component of the row, not just the one the filter named.
  assertEquals(pushed.bundles.length, 1)
  assertEquals(pushed.bundles[0].entity.eid, CAKE)
  assertEquals((pushed.bundles[0].recipe as { serves: number }).serves, 8)
  assertEquals(
    (pushed.bundles[0].doc as { title: string }).title,
    'Lemon drizzle',
  )

  // The same line over the other door answers the same rows, named.
  let read = await (await get(
    store,
    `/query?q=${encodeURIComponent(line)}`,
    owner,
  )).json() as Bundle[]
  assertEquals(read, spoken(pushed.bundles, pushed))

  // A later byline keeps the person's current name after an earlier frame
  // has already asked for it.
  let renamed = await post(store, '/apply', [{
    entity: { eid: ADA },
    doc: { title: 'Adele' },
  }], owner)
  assertEquals(renamed.status, 200)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 12 },
  }], owner)
  let changed = ws.sent.at(-1) as Frame & Names
  assertEquals(changed.names, { [ADA]: 'Adele' })
  let queried = await (await get(
    store,
    `/query?q=${encodeURIComponent(line)}`,
    owner,
  )).json() as Bundle[]
  assertEquals(
    (queried[0].created as { by: { name: string } }).by.name,
    'Adele',
  )
})

test('a woken object serves the same app, and the same sockets', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], owner)
  let ws = wire()
  ctx.live.push(ws)
  store.webSocketMessage(ws, JSON.stringify({ subscribe: '.recipe', id: 'r' }))

  // The object is evicted; its storage and its sockets are not.
  let woken = new Store(ctx)
  let read = await (await get(woken, '/query?q=.recipe', owner)).json()
  assertEquals(read.length, 1)
  assertEquals(read[0].recipe.serves, 8)
  // The wake re-opened what the socket held, and answered it with the set.
  assertEquals(ws.sent.length, 2)
  assertEquals((ws.sent[1] as { id: string }).id, 'r')
})

// A wake plants what the platform ships before any door answers (`#sow`), so a
// row it rewrites for nothing makes every read wait on a durable write.
test('a woken object rewrites nothing it already holds', async () => {
  let ctx = state()
  using _db = ctx.storage
  await get(await cookbook(ctx), '/query?q=.model', owner)
  let woken = new Store(ctx)
  let moved = await (await get(woken, '/query?q=.updated', owner)).json()
  assertEquals(moved, [])
})

// A wake whose planting throws (`#sow`), here the runtime's alarm failing,
// still serves, and plants again once its backoff has passed: each try that
// throws is one note in the break log, and a store that planted is done.
test('a store whose planting threw serves, and plants again after a wait', async () => {
  let ctx = state()
  using _db = ctx.storage
  let alarm = ctx.storage.getAlarm
  let down = true
  ctx.storage.getAlarm = () =>
    down ? Promise.reject(new Error('the alarm is down')) : alarm()
  let now = Date.now()
  using _clock = stub(Date, 'now', () => now)
  let store = await cookbook(ctx)
  let notes = async () => {
    let answer = await get(store, '/query?q=.exception', owner)
    assertEquals(answer.status, 200)
    return (await answer.json()).length
  }
  assertEquals(await notes(), 1)
  assertEquals(await notes(), 1, 'tried again before its wait')
  now += 60 * 60_000
  assertEquals(await notes(), 2)
  down = false
  now += 60 * 60_000
  assertEquals(await notes(), 2)
  down = true
  now += 60 * 60_000
  assertEquals(await notes(), 2, 'planted again after it had planted')
})

test('a stranger is refused on a private app', async () => {
  let mine: Vouch = { ...owner, access: 'private' }
  let store = await cookbook(state(), SCHEMA, mine)
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
  let [cake] = await (await get(store, '/query?q=.recipe', mine)).json()
  assertEquals(cake.recipe.serves, 8)
})

test('a stranger is refused on an app made private after it was written', async () => {
  // Public at first: the owner's write names the app, so its own entity is
  // born and classified before the directory says a mode (T-59268).
  let store = await cookbook(state(), SCHEMA, owner)
  let write = (v: Vouch, serves: number) =>
    post(store, '/apply', [{ entity: { eid: CAKE }, recipe: { serves } }], v)
  assertEquals((await write(owner, 8)).status, 200)
  let mine: Vouch = { ...owner, access: 'private' }
  assertEquals((await get(store, '/query?q=.recipe', mine)).status, 200)
  // The mode reaches this store's own rows, so nobody is refused by the store
  // itself, as well as by the kernel in front of it.
  assertEquals((await get(store, '/query?q=.recipe', { app: APP })).status, 401)
  assertEquals((await write({ app: APP }, 1)).status, 401)
})

test('an open app is written by nobody', async () => {
  let open: Vouch = { app: APP, access: 'open' }
  let store = await cookbook(state(), SCHEMA, open)
  let wrote = await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 8 },
  }], open)
  assertEquals(wrote.status, 200)
  // Unattributed: nobody signed it, so nothing claims they did.
  let applied = await wrote.json() as Bundle[]
  assert(applied.every((b) => by(b) == null))
})

// An open app takes a visitor's rows and keeps everybody else's (T-37881,
// T-37896): the shop's prices are its editors', what was sold is the
// platform's, and a row the owner wrote is the owner's.
test('a visitor to an open app adds, and touches no price, order or row of the owner’s', async () => {
  let own: Vouch = { ...owner, access: 'open' }
  let open: Vouch = { app: APP, access: 'open' }
  let store = await cookbook(state(), SCHEMA, own)
  let P = 'd0000000-0000-4000-8000-000000000004'
  let O = 'e0000000-0000-4000-8000-000000000005'
  let status = async (v: Vouch, b: unknown) =>
    (await post(store, '/apply', [b], v)).status
  assertEquals(
    await status(own, { entity: { eid: CAKE }, recipe: { serves: 8 } }),
    200,
  )
  assertEquals(
    await status(own, { entity: { eid: P }, product: { price_cents: 2800 } }),
    200,
  )
  for (
    let b of [
      { entity: { eid: P }, product: { price_cents: 1 } },
      { entity: { eid: crypto.randomUUID() }, product: { price_cents: 1 } },
      { entity: { eid: O }, order: {} },
      { entity: { eid: CAKE }, recipe: { serves: 1 } },
      { entity: { eid: CAKE }, $delete: true },
    ]
  ) assertEquals(await status(open, b), 403, JSON.stringify(b))
  assertEquals(
    await status(open, {
      entity: { eid: crypto.randomUUID() },
      recipe: { serves: 2 },
    }),
    200,
  )
  // What was sold is written by the platform, and nobody else moves it: an
  // order's properties are server-owned, so a page's say-so lands nothing at
  // all.
  assertEquals(
    await status(open, {
      entity: { eid: O },
      order: { status: 'paid', total_cents: 1 },
    }),
    200,
  )
  assertEquals(
    await (await get(store, `/query?q=.entity.eid=${O}`, own)).json(),
    [],
  )
  let platform: Vouch = { app: APP, person: APP, role: 'editor', kernel: true }
  assertEquals(
    await status(platform, { entity: { eid: O }, order: { status: 'paid' } }),
    200,
  )
  assertEquals(
    await status(own, { entity: { eid: O }, order: { status: 'refunded' } }),
    200,
  )
  let rows = await (await get(store, `/query?q=.entity.eid=${P},${O}`, own))
    .json()
  let of = (eid: string) => rows.find((r: Bundle) => r.entity.eid == eid)
  assertEquals(of(P).product.price_cents, 2800)
  assertEquals(of(O).order.status, 'paid')
  let [cake] = await (await get(store, `/query?q=.entity.eid=${CAKE}`, own))
    .json()
  assertEquals(cake.recipe.serves, 8)
})

// A component of the app's own may say who writes it and how often (T-40650):
// a chat line only someone signed in says, each of them once a pace. The store
// holds it at its own door, so every door in front of it does too.
test('a line is said by someone signed in, once a pace each', async () => {
  let own: Vouch = { ...owner, access: 'open' }
  let open: Vouch = { app: APP, access: 'open' }
  let kim: Vouch = { ...open, person: 'f0000000-0000-4000-8000-000000000006' }
  let chat = (floor: string) =>
    JSON.stringify({
      $defs: {
        line: {
          floor,
          pace: '1h',
          properties: { text: { type: 'string' } },
        },
      },
    })
  let store = await cookbook(state(), chat('person'), own)
  let said = async (v: Vouch) => {
    let eid = crypto.randomUUID()
    let r = await post(store, '/apply', [{ entity: { eid }, line: {} }], v)
    return [r.status, r.ok ? 'ok' : (await r.json()).error]
  }
  assertEquals(await said(open), [403, 'Denied'])
  assertEquals(await said(kim), [200, 'ok'])
  assertEquals(await said(kim), [429, 'Paced'])
  assertEquals(await said(own), [200, 'ok'])
  assertEquals(await said(own), [429, 'Paced'])
  let r = await post(store, '/vocab', chat('admin'), own)
  assertStringIncludes((await r.json()).message, 'line is floored "admin"')
})

// A name outlives the batch (T-34390): @yaks/key carries it, @yaks/alias
// resolves it, and both are composed into every store — so the same seed
// written twice is one entity, and the name stands where an eid does.
test('a named row written twice is one entity, and answers to its name', async () => {
  let store = await cookbook()
  let seed = async (title: string) => {
    let out = await post(store, '/apply', [{
      entity: { eid: '$r' },
      alias: { name: 'recipe:lemon-cakes' },
      doc: { title },
      recipe: { serves: 8 },
    }], owner)
    assertEquals(out.status, 200)
    return (await out.json() as Bundle[])
      .find((b) => b.$alias == '$r')!.entity.eid
  }
  let once = await seed('Lemon cakes')
  assertEquals(await seed('Lemon cakes, better'), once)
  let all = await (await get(store, '/query?q=.recipe', owner))
    .json() as Bundle[]
  assertEquals(all.map((b) => b.entity.eid), [once])
  // and a reference written by name lands on that entity
  let said = await post(store, '/apply', [{
    entity: { eid: CAKE },
    doc: { body: 'too sweet' },
    comment: { target: 'recipe:lemon-cakes' },
  }], owner)
  assertEquals(said.status, 200)
  assertEquals(
    ((await said.json() as Bundle[])
      .find((b) => b.entity.eid == CAKE)!.comment as { target: string }).target,
    once,
  )
})

// An app's store answers its own vocabulary and refuses a directory-only
// component without disturbing an accepted row.
test("an app's store keeps its words apart from the directory's", async () => {
  let store = await cookbook()
  let wrote = await post(store, '/apply', [
    { entity: { eid: CAKE }, recipe: { serves: 8 } },
  ], owner)
  assertEquals(wrote.status, 200)
  let refused = await post(store, '/apply', [
    { entity: { eid: CAKE }, space: { slug: 'ada' } },
  ], owner)
  assertEquals(refused.status, 400)
  assertEquals(
    (await asked(store, '.recipe')).body.map((b: Bundle) => b.entity.eid),
    [CAKE],
  )
})

// The separator inside a grant id is a NUL byte, and it is load-bearing: it is
// what keeps grantEid of ('a\x00b', 'c') from colliding with ('a', 'b\x00c').
// It was once written as a raw 0x00 in the source, which made git call the
// file binary and refuse to merge it (T-33946); the escape spells the same
// byte. This pins the id both ways — against the bytes, built here without the
// escape, and against a frozen hex — so the separator cannot quietly become a
// space and silently move every grant.
test('a grant id is the sha of app and person joined by a NUL', () => {
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

// ---- the rules slot (T-34619) ----
//
// A plugin says what it does about a write as data, and the host hands every
// plugin's rules to the store it builds (plugin.ts `rulesOf`, graph.ts
// `#boot`). What these pin is the arrival — a fixture plugin on the list, a
// store built after it, and the rule firing on a batch that store applied —
// because the seam is the wiring and the rule engine itself is @yaks/graph's
// (rules_test.ts). The list is a module value, so it is put back afterwards.
let ruling = async (rules: Rule[], body: () => Promise<void>) => {
  let plugin: Plugin = { name: 'fixture', rules }
  PLUGINS.push(plugin)
  try {
    await body()
  } finally {
    PLUGINS.splice(PLUGINS.indexOf(plugin), 1)
  }
}

test("a plugin's rule reaches the store the host built", async () => {
  await ruling([{
    name: 'fixture/titled',
    phase: 'stamp',
    match: '.recipe, +!doc, *doc',
    produce: { doc: { title: 'named by a rule' } },
  }], async () => {
    let store = await cookbook()
    let wrote = await post(store, '/apply', [{
      entity: { eid: CAKE },
      recipe: { serves: 8 },
    }], owner)
    assertEquals(wrote.status, 200)
    let read = await (await get(
      store,
      `/query?q=${encodeURIComponent('.recipe&?doc')}`,
      owner,
    )).json()
    assertEquals(read[0].doc.title, 'named by a rule')
  })
})

test('a rule writing outside its *write set takes the batch with it', async () => {
  await ruling([{
    name: 'fixture/stray',
    phase: 'stamp',
    match: '*recipe',
    run: () => ({ doc: { title: 'stray' } }),
  }], async () => {
    let store = await cookbook()
    let no = await post(store, '/apply', [{
      entity: { eid: CAKE },
      recipe: { serves: 8 },
    }], owner)
    // A rule that breaks is the platform's fault, not the caller's: the write
    // is kept for code that works (writes.ts), and none of it lands now.
    assertEquals(no.status, 202)
    assertStringIncludes((await no.json()).message, 'write set')
    // The refusal is a rollback: the batch it fired on is not in the store.
    let read = await (await get(store, '/query?q=.recipe', owner)).json()
    assertEquals(read.length, 0)
  })
})

// The one rule this Worker ships (trash.ts): the caller asks for the trash and
// the store dates it and signs it, the way it dates a birth.
test('the store dates the trash mark, and signs it', async () => {
  let store = new Store(state())
  let at = (body: unknown[]) =>
    store.fetch(
      new Request('http://store/apply', {
        method: 'POST',
        headers: { 'x-store': PLATFORM_STORE, 'x-yak-person': ADA },
        body: JSON.stringify(body),
      }),
    )
  let wrote = await at([{ entity: { eid: APP }, trashed: {} }])
  assertEquals(wrote.status, 200)
  let mark = (await wrote.json() as Bundle[])
    .map((b) => b.trashed as { at?: string; by?: string } | undefined)
    .find((t) => t?.at)
  assert(mark, 'the store wrote no date')
  assert(Date.now() - Date.parse(mark.at!) < 60_000)
  assertEquals(mark.by, ADA)

  // Asking again leaves the first date where it is: the days a row has left
  // are counted off it, and a second delete must not hand back thirty more.
  let again = await at([{ entity: { eid: APP }, trashed: {} }])
  assertEquals(again.status, 200)
  let [row] = await (await store.fetch(
    new Request(
      `http://store/query?q=${encodeURIComponent('.trashed')}`,
      { headers: { 'x-store': PLATFORM_STORE, 'x-yak-person': ADA } },
    ),
  )).json()
  assertEquals(row.trashed.at, mark.at)
})

test('app archetypes classify writes and migrate old rows only on schema changes', async () => {
  let ctx = state()
  let store = await cookbook(ctx)
  let added = await post(store, '/apply', [
    { entity: { eid: CAKE }, recipe: { serves: 4 }, doc: { title: 'Cake' } },
  ], owner)
  assertEquals(added.status, 200)
  let read = async (s: Store) =>
    await (await get(s, '/query?q=.recipe%26%3Fdoc', owner)).json() as Bundle[]
  let rows = await read(store)
  let original = rows[0].entity.archetype
  assert(typeof original == 'string')
  let descriptors = await (await get(store, '/query?q=.archetype', owner))
    .json() as Bundle[]
  assert(descriptors.some((b) => b.entity.eid == original))
  // A returned pointer is not a writable classification.
  await post(store, '/apply', [{
    entity: { eid: CAKE, archetype: 'forged' },
    recipe: { serves: 5 },
  }], owner)
  let updated = (await read(store))[0].entity.archetype
  assert(updated != 'forged')
  original = updated
  // Simulate a pre-feature store whose data and blob values already exist.
  unclassified(ctx, 'previous-schema')
  store = new Store(ctx)
  rows = await read(store)
  assertEquals(rows[0].entity.archetype, original)
  assertEquals((rows[0].doc as { title: string }).title, 'Cake')
  assertEquals((rows[0].recipe as { serves: number }).serves, 5)
  assertEquals(tally(db(ctx), 'entity', isNull(col('archetype'))), 0)
  // Schema stamp prevents the next wake from rescanning/backfilling rows.
  let stamp = slot(ctx, 'schema')
  store = new Store(ctx)
  assertEquals((await read(store))[0].entity.archetype, original)
  assertEquals(slot(ctx, 'schema'), stamp)
  await post(store, '/apply', [{ entity: { eid: CAKE }, recipe: null }], owner)
  assertEquals((await read(store)).length, 0)
  let without = await (await get(store, '/query?q=.doc', owner))
    .json() as Bundle[]
  assert(
    without.find((b) => b.entity.eid == CAKE)?.entity.archetype != original,
  )
})

test('app archetype descriptors are read-only and vocabulary extension tracks new shapes', async () => {
  let ctx = state(), store = await cookbook(ctx)
  let vocab = await post(
    store,
    '/vocab',
    '{"archetype":{"tables":"text"}}',
    owner,
  )
  assertEquals(vocab.status, 400)
  await post(store, '/apply', [{
    entity: { eid: CAKE },
    recipe: { serves: 2 },
  }], owner)
  let descriptors = await (await get(store, '/query?q=.archetype', owner))
    .json() as Bundle[]
  let before = JSON.stringify(descriptors)
  await post(store, '/apply', [{
    entity: descriptors[0].entity,
    archetype: { tables: '["recipe"]' },
  }], owner)
  assertEquals(
    JSON.stringify(
      await (await get(store, '/query?q=.archetype', owner)).json(),
    ),
    before,
  )
  let extended = await post(
    store,
    '/vocab',
    '{"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}, ' +
      '"specialty": {}}}',
    owner,
  )
  assertEquals(extended.status, 200)
  await post(store, '/apply', [{ entity: { eid: CAKE }, specialty: {} }], owner)
  let got = await (await get(store, '/query?q=.recipe%26.specialty', owner))
    .json() as Bundle[]
  assertEquals(got.length, 1)
  assert(got[0].entity.archetype)
  store = new Store(ctx)
  assertEquals(
    (await (await get(store, '/query?q=.recipe%26.specialty', owner)).json())
      .length,
    1,
  )
})
// Append to graph_test.ts after the Worker supplier lands. These stores use
// the existing Durable Object stand-in and ordinary fixture requests only.
test('a Store anatomy supplier observes its own conditional composition without reads', async () => {
  let held = state()
  let store = new Store(held)
  await get(store, '/query?query=.entity')
  let app = store.anatomy()
  assertEquals(app.scope, 'worker')
  assertEquals(app.observed?.commands, true)
  assertEquals(app.observed?.secrets, false)
  assertEquals(app.skills, [])
  assertEquals(app.views, [])
  assertEquals(app.routes, [])
  assert(app.rules.some((r) => r.name == 'yak/rules'))
  assert(app.rules.some((r) => r.name == 'yak/weigh'))
  assert(!app.packages.some((p) => p.name == '@yaks/visualize'))
  let meta = new Store(state())
  await meta.fetch(
    new Request('http://store/query?query=.entity', {
      headers: { 'x-store': PLATFORM_STORE },
    }),
  )
  let directory = meta.anatomy()
  assert(!directory.rules.some((r) => r.name == 'yak/weigh'))
  assert(directory.rules.some((r) => r.name == 'yak/rules'))
  assertEquals(app.comps.length, store.anatomy().comps.length)
})
