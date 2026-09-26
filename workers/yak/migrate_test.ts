/// <reference lib="deno.ns" />
// A Store's storage at each wake (migrate.ts), driven through the Store's own
// doors: what the object remembers rewritten into the one shape a deploy takes
// now, a schema that moves re-cut and refilled, and a schema that will not
// stand refused at every door and heard by Sentry.
import { assert, assertEquals } from '@std/assert'
import {
  createTransport,
  type ErrorEvent,
  ServerRuntimeClient,
  setCurrentClient,
} from '@sentry/core'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { at, fn, insert, lit, type Stmt } from '@yaks/sql'
import { objects as catalogue } from '@yaks/sqlite'
import { Store } from './graph.ts'
import { documented, respelled, unholed, unworded } from './migrate.ts'
import { PLATFORM_STORE } from './door.ts'
import { db, every, keep, slot } from './testing.ts'

// One object's whole state, kept across incarnations: its storage and the
// socket list the runtime holds.
let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

type State = ReturnType<typeof state>

let SPACE = 'c0000000-0000-4000-8000-0000000000c5'
let APP = 'd0000000-0000-4000-8000-0000000000ab'
let ONE = '10000000-0000-4000-8000-000000000001'
let TWO = '20000000-0000-4000-8000-000000000002'

// A Store over the object, as a new incarnation, driven through its own doors.
let newer = (ctx: State, name: string) => {
  let store = new Store(
    ctx as unknown as ConstructorParameters<typeof Store>[0],
    {} as never,
  )
  let door = (path: string, init: RequestInit = {}, app?: string) => {
    let req = new Request(`http://store${path}`, init)
    req.headers.set('x-store', name)
    if (app) req.headers.set('x-yak-app', app)
    return store.fetch(req)
  }
  return {
    store,
    door,
    // A write through the kernel's own door, trusted and unsigned.
    apply: (bundles: unknown[], app?: string) =>
      door('/apply', {
        method: 'POST',
        headers: { 'x-yak-kernel': '1' },
        body: JSON.stringify(bundles),
      }, app),
    query: async (line: string, app?: string) => {
      let r = await door(`/query?q=${encodeURIComponent(line)}`, {}, app)
      if (!r.ok) throw new Error(`query refused: ${await r.text()}`)
      return await r.json() as Bundle[]
    },
  }
}

let run = (ctx: State, ...statements: Stmt[]) => {
  let d = db(ctx)
  for (let s of statements) d.query(s)
}

// ---- what the object remembers ---------------------------------------------

// A store that last accepted the short type map remembers it that way. The
// short form is gone from every door, so the slot itself is rewritten as the
// document at the object's next open. The tools slot the same way: a manifest
// accepted while `{{arg}}` was the hole is rewritten with `$arg`.
Deno.test(
  'a store holding an old shape is rewritten at its next open',
  async () => {
    let ctx = state()
    await newer(ctx, 'ada/cookbook').query('.doc', APP)
    keep(ctx, 'vocab', '{"recipe":{"title":"text","serves":"number"}}')
    let now = newer(ctx, 'ada/cookbook')
    // The door answers the document, and the app's word reads and writes.
    let said = await (await now.door('/vocab')).json()
    assertEquals(said.$defs.recipe.properties, {
      title: { type: 'string' },
      serves: { type: 'number' },
    })
    let cake = { entity: { eid: ONE }, recipe: { title: 'Cake', serves: 8 } }
    assertEquals((await now.apply([cake], APP)).status, 200)
    assertEquals((await now.query('.recipe.serves=8', APP)).length, 1)
    // And what the object keeps is the document, so nothing reads a short map
    // again — including a later deploy, which would refuse one.
    let held = JSON.parse(slot(ctx, 'vocab') ?? '')
    assertEquals(Object.keys(held), ['$defs'])
    assertEquals(held.$defs.recipe.kind, true)

    keep(
      ctx,
      'tools',
      JSON.stringify({
        serving: {
          description: 'Recipes that serve so many',
          input: { n: 'number' },
          query: '.recipe!&.recipe.serves={{n}}&.doc?',
        },
      }),
    )
    let woke = newer(ctx, 'ada/cookbook')
    let tools = await (await woke.door('/tools')).json()
    // With its clauses in their one spelling (T-39341).
    assertEquals(tools.serving.query, '.recipe&.recipe.serves=$n&?doc')
    // And each argument as the JSON Schema it is now (T-38021).
    assertEquals(tools.serving.input, { n: { type: 'number' } })
    assertEquals(tools.serving.required, ['n'])
  },
)

Deno.test('the {{arg}} hole, as the variable it became', () => {
  assertEquals(
    unholed('{"a":{"query":".r.t={{t}}&.r.n={{n_2}}","apply":"{{x}}!"}}'),
    '{"a":{"query":".r.t=$t&.r.n=$n_2","apply":"$x!"}}',
  )
  // Nothing to do: the variable already, `$$`, or braces that hold no name.
  assertEquals(unholed('{"a":{"query":".r.t=$t"}}'), null)
  assertEquals(unholed('{"a":{"query":".r.t=$$5 {{ }} {{T}}"}}'), null)
})

Deno.test('each query clause in its one spelling', () => {
  let cases: [string, string | null][] = [
    [`query('.recipe!&.doc?')`, `query('.recipe&?doc')`],
    [`'/query?.art_asset!&.doc?'`, `'/query?.art_asset&?doc'`],
    [`\`.comment.target=\${eid}&.did?\``, `\`.comment.target=\${eid}&?did\``],
    [
      '{"query":".created.by!","q":".guest&.rsvp?"}',
      '{"query":".created.by","q":".guest&?rsvp"}',
    ],
    [`'.edges[requires]!'`, `'.edges[requires]'`],
    // Nothing a query line holds: code, prose, a value, a concatenation.
    [`if (a.done?.x) b.c!`, null],
    [`values.any? &.present?`, null],
    [`'.fobtable.code=' + code + '&.doc'`, null],
    [`'.recipe&?doc'`, null],
  ]
  for (let [text, now] of cases) assertEquals(respelled(text), now, text)
})

Deno.test('a tools slot, each argument the JSON Schema it meant', () => {
  assertEquals(
    JSON.parse(
      unworded(JSON.stringify({
        mine: {
          description: 'm',
          input: { n: 'number', at: 'time' },
          query: 'x',
        },
        kind: {
          description: 'k',
          input: { title: 'text', ok: 'bool' },
          optional: ['ok'],
          drop: ['alias'],
          apply: {},
        },
        none: { description: 'n', input: {}, query: 'y' },
      }))!,
    ),
    {
      mine: {
        description: 'm',
        query: 'x',
        input: {
          n: { type: 'number' },
          at: {
            type: 'string',
            description: 'a time, like 2026-09-01 or 2026-09-01T10:00:00Z',
          },
        },
        required: ['n', 'at'],
      },
      kind: {
        description: 'k',
        drop: ['alias'],
        apply: {},
        input: { title: { type: 'string' }, ok: { type: 'boolean' } },
        required: ['title'],
      },
      none: { description: 'n', input: {}, query: 'y' },
    },
  )
  // Nothing to do: schemas already, or nothing a store could parse.
  assertEquals(unworded('{"a":{"input":{"n":{"type":"number"}}}}'), null)
  assertEquals(unworded('{}'), null)
  assertEquals(unworded('not json'), null)
})

Deno.test('the short type map, as the document it means', () => {
  assertEquals(
    JSON.parse(documented('{"recipe": {"serves": "number"}}')!),
    {
      $defs: {
        recipe: {
          component: true,
          type: 'object',
          kind: true,
          before: ['doc'],
          properties: { serves: { type: 'number' } },
        },
      },
    },
  )
  // Every word it could spell, and the manifest's one word about itself.
  assertEquals(
    JSON.parse(
      documented(
        '{"t": {"a": "text", "b": "number", "c": "bool", "d": "time", ' +
          '"e": "url"}, "tools": false}',
      )!,
    ).$defs.t.properties,
    {
      a: { type: 'string' },
      b: { type: 'number' },
      c: { type: 'boolean' },
      d: { type: 'string', format: 'date-time' },
      e: { type: 'string', format: 'uri' },
    },
  )
  assertEquals(
    JSON.parse(documented('{"t": {}, "tools": false}')!).tools,
    false,
  )
  // A document whose property says no type says the text it was stored as.
  assertEquals(
    JSON.parse(
      documented(
        '{"$defs": {"r": {"properties": {"a": {"enum": ["x"]}, ' +
          '"b": {"type": "number"}}}, "t": {"tool": true}}, "tools": false}',
      )!,
    ),
    {
      $defs: {
        r: {
          properties: {
            a: { type: 'string', enum: ['x'] },
            b: { type: 'number' },
          },
        },
        t: { tool: true },
      },
      tools: false,
    },
  )
  // Nothing to do: a typed document, an empty slot, or bytes nothing can read.
  assertEquals(documented('{"$defs": {"recipe": {}}}'), null)
  assertEquals(
    documented('{"$defs": {"r": {"properties": {"a": {"type": "string"}}}}}'),
    null,
  )
  assertEquals(documented('{}'), null)
  assertEquals(documented('not json'), null)
})

// ---- the definitions, when the schema moves under them ---------------------

Deno.test('a schema that moves re-cuts its definitions and refills', async () => {
  // No old rows here: this is a store already on the packages, whose schema
  // moves — a deploy that grew its vocabulary. `create ... if not exists` says
  // nothing about a trigger or a full-text index that is already standing, so
  // both are dropped and raised again and the index is rebuilt (T-33978).
  let ctx = state()
  let now = newer(ctx, 'ada/cookbook')
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: ONE }, doc: { title: 'Cake', body: 'three lemons' } },
    ]),
  }, APP)
  assertEquals((await now.query('lemons', APP)).length, 1)

  // The pre-fix definition, put back by hand: a trigger that indexes the column
  // as it is stored, which for a body is its address. A document written under
  // it is findable by its title and not by a word of its prose.
  let fresh = at('new')
  run(ctx, { t: 'drop', kind: 'trigger', name: 'doc_fts_insert' }, {
    t: 'create trigger',
    name: 'doc_fts_insert',
    timing: 'after',
    event: 'insert',
    on: 'doc',
    body: [{
      t: 'insert',
      into: 'doc_fts',
      cols: ['rowid', 'title', 'body'],
      rows: [[
        fresh('entity'),
        ...['title', 'body'].map((c) => fn('coalesce', fresh(c), lit(''))),
      ]],
    }],
  })
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: TWO }, doc: { title: 'Tart', body: 'four limes' } },
    ]),
  }, APP)
  assertEquals((await now.query('limes', APP)).length, 0)

  // A deploy that adds a word: the stamp moves, so the definitions are dropped
  // and raised again at the current shape, and the index is rebuilt off the
  // content — which resolves a body. Both documents are findable by their prose.
  let grew = await now.door('/vocab', {
    method: 'POST',
    body: JSON.stringify(
      {
        $defs: {
          recipe: {
            component: true,
            properties: { serves: { type: 'number' } },
          },
        },
      },
    ),
  }, APP)
  assertEquals(grew.status, 200)
  assertEquals((await now.query('limes', APP)).length, 1)
  assertEquals((await now.query('lemons', APP)).length, 1)
})

Deno.test('a kind the vocabulary stopped listing is written beside the rows it kept', async () => {
  // The table was made when the vocabulary listed kinds, and holds that list
  // as its check; a deploy that lets any word be a kind raises it again.
  let now = newer(state(), 'ada/vale')
  let deploy = (kind: Record<string, unknown>) =>
    now.door('/vocab', {
      method: 'POST',
      body: JSON.stringify({
        $defs: {
          creature: {
            component: true,
            properties: { kind: { type: 'string', ...kind } },
          },
        },
      }),
    }, APP)
  let born = (eid: string, kind: string) =>
    now.apply([{ entity: { eid }, creature: { kind } }], APP)
  assertEquals((await deploy({ enum: ['fox', 'owl'] })).status, 200)
  assertEquals((await born(ONE, 'fox')).status, 200)
  assertEquals((await deploy({})).status, 200)
  assertEquals((await born(TWO, 'hen')).status, 200)
  let kinds = (await now.query('.creature', APP))
    .map((b) => (b.creature as Record<string, unknown>).kind).sort()
  assertEquals(kinds, ['fox', 'hen'])
})

Deno.test('a doc_value-backed legacy index upgrades to the composed FTS schema', async () => {
  let ctx = state()
  let now = newer(ctx, 'ada/cookbook')
  let write = (store: ReturnType<typeof newer>, body: string) =>
    store.door('/apply', {
      method: 'POST',
      headers: { 'x-yak-kernel': '1' },
      body: JSON.stringify([
        { entity: { eid: ONE }, doc: { title: 'Cake', body } },
      ]),
    }, APP)
  assertEquals((await write(now, 'three lemons')).status, 200)
  // The retired sqlite DDL read external content through doc_value. Its
  // resolved triggers have the same mirror rule as FTS's, so leave them in
  // place to prove boot replaces the index without losing the stored prose.
  run(
    ctx,
    { t: 'drop', kind: 'table', name: 'doc_fts' },
    { t: 'drop', kind: 'view', name: 'doc_text' },
    {
      t: 'create virtual table',
      name: 'doc_fts',
      using: 'fts5',
      args: [
        'title',
        'body',
        ['content', 'doc_value'],
        ['content_rowid', 'entity'],
      ],
    },
    insert('doc_fts', { doc_fts: 'rebuild' }),
  )
  keep(ctx, 'schema', 'legacy sqlite FTS')

  let upgraded = newer(ctx, 'ada/cookbook')
  let hits = await upgraded.query('lemons', APP)
  assertEquals(hits.length, 1)
  assertEquals(hits[0].entity.eid, ONE)
  let [definition] = catalogue(db(ctx), { name: 'doc_fts' })
  assert(String(definition.sql).includes("content='doc_text'"))
  // New writes use the new triggers, removing the old words and adding prose
  // rather than a blob address. Another wake keeps those results intact.
  assertEquals((await write(upgraded, 'four limes')).status, 200)
  assertEquals((await upgraded.query('lemons', APP)).length, 0)
  assertEquals((await upgraded.query('limes', APP)).length, 1)
  assertEquals((await newer(ctx, 'ada/cookbook').query('limes', APP)).length, 1)
})

// ---- a schema that will not stand ----------------------------------------

let refused = async (now: ReturnType<typeof newer>, message: string) => {
  for (
    let path of [
      '/query?q=.app',
      '/apply',
      '/ws',
      '/vocab',
      '/uses',
      '/tools',
      '/restore',
      '/tick',
      '/graph',
      '/',
    ]
  ) {
    let response = await now.door(path)
    assertEquals(response.status, 503, path)
    assertEquals(response.headers.get('x-yak-migration'), 'refused', path)
    let body = await response.json()
    assertEquals(body.error, 'Refused')
    assert(body.message.includes(message), body.message)
  }
}

// A directory whose rows break a unique index its vocabulary declares, with
// the index gone and a schema stamp older than the code: the next boot raises
// the index, and cannot.
let unsatisfiable = async () => {
  let ctx = state()
  let now = newer(ctx, PLATFORM_STORE)
  let r = await now.apply([
    { entity: { eid: SPACE }, space: { slug: 'ada' }, doc: { title: 'Ada' } },
    { entity: { eid: TWO }, space: { slug: 'ben' } },
  ])
  assertEquals(r.status, 200)
  run(
    ctx,
    { t: 'drop', kind: 'index', name: 'space_slug' },
    every('space', { slug: 'same' }),
  )
  keep(ctx, 'schema', 'older schema')
  return ctx
}

Deno.test('a declared index the rows cannot satisfy refuses the boot', async () => {
  let ctx = await unsatisfiable()
  await refused(newer(ctx, PLATFORM_STORE), 'skipped unique index space_slug')
  assertEquals(slot(ctx, 'schema'), 'older schema')
})

Deno.test('a raw index creation failure still refuses an empty store', async () => {
  let ctx = state()
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (query, ...params) => {
    if (query.startsWith('create unique index if not exists "space_slug"')) {
      throw new Error('index creation failed')
    }
    return exec(query, ...params)
  }
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'index creation failed')
})

Deno.test('a refused boot reaches Sentry, tagged with its store', async () => {
  let seen: ErrorEvent[] = []
  let client = new ServerRuntimeClient({
    dsn: 'https://key@example.ingest.sentry.io/1',
    integrations: [],
    stackParser: () => [],
    transport: (o) => createTransport(o, () => Promise.resolve({})),
    beforeSend: (e) => {
      seen.push(e)
      return null
    },
  })
  setCurrentClient(client)
  client.init()
  let ctx = await unsatisfiable()
  await refused(newer(ctx, PLATFORM_STORE), 'skipped unique index')
  await client.flush(1000)
  assertEquals(seen.length, 1)
  assertEquals(seen[0].tags, { request: 'schema', store: PLATFORM_STORE })
})
