/// <reference lib="deno.ns" />
// The one pass, end to end (T-33809): an object is seeded the way the store
// this replaces seeded one — its DDL, its own apply(), its own key-value
// slots — and then woken as the Store on the packages, which finds the old
// rows and moves them.
//
// The old store's writer went with the fleet server (T-37584), and what it
// wrote did not: {@link older} replays the SQL that writer executed for each
// fixture below, recorded while it still existed
// (./fixtures/legacy_store.json, keyed by the calls that produced it). A
// fixture with no recording is refused by name. The assertions read the new
// store through its own `/query` door.
//
// Slow tier: every one of these plants the fleet's whole schema to have
// something to migrate — the cost of the thing under test, not of the setup
// around it.
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  createTransport,
  type ErrorEvent,
  ServerRuntimeClient,
  setCurrentClient,
} from '@sentry/core'
import { blobSchema } from '@yaks/blob'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { edgeEid } from '@yaks/edge'
import {
  among,
  as,
  at,
  col,
  count,
  eq,
  fn,
  insert,
  lit,
  not,
  scan,
  select,
  type Stmt,
  sub,
  table,
  tally,
} from '@yaks/sql'
import { objects as catalogue, schema } from '@yaks/sqlite'
import { Store } from './graph.ts'
import {
  carry,
  documented,
  MARK,
  Refused as Unreconciled,
  respelled,
  unholed,
  unworded,
} from './migrate.ts'
import legacy from './fixtures/legacy_store.json' with { type: 'json' }
import { PLATFORM_STORE } from './door.ts'
import { appVocab } from './vocab.ts'
import { db, every, grow, id, keep, named, slot } from './testing.ts'

// One object's whole state, kept across incarnations: its storage, the key-value
// slots the old store remembered everything in, and the socket list the runtime
// holds. `blockConcurrencyWhile` is the runtime's; here an object is driven one
// call at a time, so its absence is honest.
let state = () => {
  let live: Wire[] = []
  let slots = new Map<string, unknown>()
  return {
    storage: Object.assign(durable(), {
      kv: {
        get: (k: string) => slots.get(k),
        put: (k: string, v: unknown) => void slots.set(k, v),
      },
    }),
    live,
    slots,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

type State = ReturnType<typeof state>

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BEN = 'b0000000-0000-4000-8000-0000000000be'
let SPACE = 'c0000000-0000-4000-8000-0000000000c5'
let APP = 'd0000000-0000-4000-8000-0000000000ab'
let ONE = '10000000-0000-4000-8000-000000000001'
let TWO = '20000000-0000-4000-8000-000000000002'
let GONE = '30000000-0000-4000-8000-000000000003'

// The old store's birth and its writes, over one object's storage, as the
// recording says they went: the fleet's whole schema, the slots the object
// remembered its name and its schema stamp in, and apply() in server-writer
// mode — which is what every request the kernel made carried (`x-yak-kernel`).
// A write is the calls so far, and the recording under them is exactly the
// statements the old writer ran for them.
type Tape = Record<string, { sql: [string, unknown[]][]; vocab?: string }>
let tape = legacy as unknown as Tape

let bytes = (v: unknown) => {
  let o = v as { $bytes?: string; $bigint?: string } | null
  return o?.$bytes != null
    ? Uint8Array.from(atob(o.$bytes), (c) => c.charCodeAt(0))
    : o?.$bigint != null
    ? BigInt(o.$bigint)
    : v
}

let older = (ctx: State, name: string) => {
  let calls: unknown[] = [name]
  let play = (call: unknown) => {
    calls.push(call)
    let key = JSON.stringify(calls)
    let got = tape[key]
    if (!got) {
      throw new Error(
        `no recording of the old writer for ${key.slice(0, 160)} — record ` +
          'it from a commit that still has src/db.ts',
      )
    }
    for (let [q, args] of got.sql) {
      ctx.storage.sql.exec(q, ...(args.map(bytes) as never[]))
    }
    return got
  }
  play('open')
  ctx.slots.set('name', name)
  ctx.slots.set('schema', tape.schema.vocab)
  return {
    apply: (entities: Record<string, unknown>[]) =>
      void play(['apply', entities]),
    // The app's own vocab.json, as the `/vocab` door planted it: the tables and
    // columns it names, then the manifest itself in the slot the object woke
    // with. A fresh store has nothing to grow from, so this is the whole of it.
    vocab: (manifest: unknown) =>
      void ctx.slots.set('vocab', play(['vocab', manifest]).vocab),
  }
}

// The new store over the same object, driven through its own doors.
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

// Why a store refused its pass, in the words its door says to every caller.
let why = async (now: ReturnType<typeof newer>, app?: string) => {
  let r = await now.door('/query?q=.doc', {}, app)
  assertEquals(r.status, 503)
  return (await r.json() as { message: string }).message
}

// ---- an app's store --------------------------------------------------------

// Everything an app's store can be holding, written the old way: a person, a
// document with prose in the old blob backend, a task, a comment aimed at it,
// two edges (one under each name of the relation), a dead entity, and a
// component the app declared in its own vocab.json.
let seedApp = async (ctx: State) => {
  let old = older(ctx, 'ada/cookbook')
  await old.vocab({ recipe: { title: 'text', serves: 'number' } })
  await old.apply([
    { entity: { eid: ADA }, person: {}, doc: { title: 'Ada' } },
    {
      entity: { eid: ONE },
      doc: { title: 'Lemon cake', body: '3 lemons' },
      task: {},
      filed: { priority: 2 },
      recipe: { title: 'Lemon cake', serves: 8 },
    },
    {
      entity: { eid: TWO },
      doc: { title: 'Notes', body: 'nice' },
      comment: { target: ONE },
    },
    { entity: { eid: GONE }, doc: { title: 'Scratch' } },
  ])
  // Two edges, said the way the fleet says one: the entity is the sentence's
  // own address, and the tag is the nature — `references` in the present tense,
  // which is the one word this pass renames.
  let requires = edgeEid(TWO, 'requires', ONE)
  let refs = edgeEid(TWO, 'references', ADA)
  await old.apply([
    { entity: { eid: requires }, edge: { from: TWO, to: ONE }, requires: {} },
    { entity: { eid: refs }, edge: { from: TWO, to: ADA }, references: {} },
  ])
  await old.apply([{ entity: { eid: GONE }, tombstone: {} }])
  return { requires, refs }
}

Deno.test('an app store carries every row across, and reconciles', async () => {
  let ctx = state()
  let said = await seedApp(ctx)

  let now = newer(ctx, 'ada/cookbook')
  let docs = await now.query(`.doc.title="Lemon cake"&?doc`, APP)
  assertEquals(docs.length, 1)

  // The prose came across the blob move: the column holds the address now, and
  // the read inflates it, so a page asking for the body gets the body.
  assertEquals((docs[0].doc as { title: string }).title, 'Lemon cake')
  assertEquals((docs[0].doc as { body: string }).body, '3 lemons')

  // And the search index holds the prose, not the address (T-33978): the blob
  // row is written before the row that addresses it, so the trigger that fills
  // the index resolves a body the same way a read does.
  let found = await now.query('lemons', APP)
  assertEquals(found.length, 1)
  assertEquals(found[0].entity.eid, ONE)

  // The app's own word, planted from the vocab.json the old object remembered.
  let cakes = await now.query('.recipe.serves=8', APP)
  assertEquals(cakes.length, 1)
  assertEquals((cakes[0].recipe as { title: string }).title, 'Lemon cake')

  // The task, the comment and the person.
  assertEquals((await now.query('.task', APP)).length, 1)
  assertEquals((await now.query('.comment.target=' + ONE, APP)).length, 1)
  assertEquals((await now.query('.person', APP)).length, 1)

  // The edge said under the old name wears the new tag and the address that
  // name derives; the one whose word never moved kept its own.
  let kept = await now.query('.requires&?edge', APP)
  assertEquals(kept.length, 1)
  assertEquals(kept[0].entity.eid, said.requires)
  let moved = await now.query('.referenced&?edge', APP)
  assertEquals(moved.length, 1)
  assertEquals(moved[0].entity.eid, edgeEid(TWO, 'referenced', ADA))
  assert(moved[0].entity.eid != said.refs, 'the address moved with the word')

  // The dead stay dead, and every pass is done.
  assertEquals(tally(db(ctx), 'tombstone'), 1)
  assertEquals(marker(ctx), MARK)

  // The fleet's other words have no table on the packages, the journal among
  // them.
  let tables = named(ctx, { type: 'table' })
  assert(!tables.some((t) => t.startsWith('journal_')), tables.join(', '))
})

Deno.test("the runtime's own table is not the object's to move", async () => {
  let ctx = state()
  await seedApp(ctx)

  // What every deployed object carries and no probe ever had (T-34019): the
  // table behind `ctx.storage.kv`, which the old store kept everything it
  // remembered in. `sqlite_master` lists it like any other and the authorizer
  // then refuses to read it, so a pass that enumerated tables and selected from
  // each threw before a row moved — and the object served 503 for its lifetime.
  ctx.storage.beneath({
    t: 'create table',
    name: '_cf_KV',
    cols: [
      { name: 'key', type: 'text', pk: true },
      { name: 'value', type: 'blob' },
    ],
  })
  ctx.storage.beneath(insert('_cf_KV', { key: 'name', value: 'ada/cookbook' }))
  assertThrows(() => scan(db(ctx), '_cf_KV'), Error, 'SQLITE_AUTH')

  let now = newer(ctx, 'ada/cookbook')
  assertEquals((await now.query('.doc', APP)).length, 3)
  assertEquals(marker(ctx), MARK)

  // And it is standing where the runtime left it, with its row — proof the pass
  // neither dropped it nor renamed it aside.
  let [held] = ctx.storage.beneath(
    select({ cols: [as(count(), 'n')], from: table('_cf_KV') }),
  )
  assertEquals(Number(held.n), 1)
})

// ---- the slots (T-37546) ---------------------------------------------------

// A store that last accepted the short type map remembers it that way. The
// short form is gone from every door, so the slot itself is rewritten as the
// document at the object's next open — and `seedApp` writes one the old way,
// which is what `older().vocab()` still does. The tools slot the same way: a
// manifest accepted while `{{arg}}` was the hole is rewritten with `$arg`.
Deno.test(
  'a store holding an old shape is rewritten at its next open',
  async () => {
    let ctx = state()
    await seedApp(ctx)
    assertEquals(
      ctx.slots.get('vocab'),
      '{"recipe":{"title":"text","serves":"number"}}',
    )
    let now = newer(ctx, 'ada/cookbook')
    // The door answers the document, and the app's word still reads.
    let said = await (await now.door('/vocab')).json()
    assertEquals(said.$defs.recipe.properties, {
      title: { type: 'string' },
      serves: { type: 'number' },
    })
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

Deno.test('the second boot is a no-op', async () => {
  let ctx = state()
  await seedApp(ctx)
  let first = newer(ctx, 'ada/cookbook')
  assertEquals((await first.query('.doc', APP)).length, 3)
  assertEquals(marker(ctx), MARK)

  // A fresh incarnation over the same storage: the marker is written, the
  // journal is gone, so nothing runs a second time.
  let again = newer(ctx, 'ada/cookbook')
  assertEquals((await again.query('.doc', APP)).length, 3)

  // And a write still lands, which is the proof the schema the second boot
  // raised is the one the rows are in.
  let r = await again.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: BEN }, doc: { title: 'Ben' }, person: {} },
    ]),
  }, APP)
  assertEquals(r.status, 200)
  assertEquals((await again.query('.doc', APP)).length, 4)
})

// ---- the directory ---------------------------------------------------------

Deno.test('the directory keeps its three seats', async () => {
  let ctx = state()
  let old = older(ctx, PLATFORM_STORE)
  await old.apply([
    { entity: { eid: SPACE }, space: { slug: 'ada' }, doc: { title: 'Ada' } },
    { entity: { eid: ADA }, person: {} },
    { entity: { eid: BEN }, person: {} },
    { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
    {
      entity: { eid: ONE },
      member: { space: SPACE, person: ADA, role: 'owner' },
    },
    {
      entity: { eid: TWO },
      member: { space: SPACE, person: BEN, role: 'editor' },
    },
  ])
  let now = newer(ctx, PLATFORM_STORE)

  // Three seats, unsplit: the platform's own `member` declares them, so an
  // editor is still an editor.
  let seats = await now.query('.member')
  assertEquals(seats.length, 2)
  assertEquals(
    seats.map((s) => (s.member as { role: string }).role).sort(),
    ['editor', 'owner'],
  )
  // Nor does one become a grant. The directory has that word too now — it is
  // the other rung of its ladder, one app rather than a space (T-37615) — but
  // it is written by an invitation that names an app and never minted out of a
  // roster, so the table crosses empty.
  assertEquals((await now.query('.grant')).length, 0)
  assertEquals((await now.query('.space.slug=ada')).length, 1)
  assertEquals((await now.query('.app.slug=cookbook')).length, 1)
})

Deno.test('an app store splits the seat from the level', async () => {
  let ctx = state()
  let old = older(ctx, 'ada/cookbook')
  await old.apply([
    { entity: { eid: ADA }, person: {} },
    { entity: { eid: BEN }, person: {} },
    { entity: { eid: SPACE }, space: { slug: 'ada' } },
    {
      entity: { eid: ONE },
      member: { space: SPACE, person: ADA, role: 'owner' },
    },
    {
      entity: { eid: TWO },
      member: { space: SPACE, person: BEN, role: 'editor' },
    },
  ])
  let now = newer(ctx, 'ada/cookbook')
  // The app is named on the request, which is what a grant is on.
  let seats = await now.query('.member', APP)
  assertEquals(seats.length, 2)
  assertEquals(
    seats.map((s) => (s.member as { role: string }).role).sort(),
    ['member', 'owner'],
  )
  let grants = await now.query('.grant', APP)
  assertEquals(grants.length, 1)
  assertEquals((grants[0].grant as { access: string }).access, 'editor')
  assertEquals((grants[0].grant as { person: string }).person, BEN)
  assertEquals((grants[0].grant as { app: string }).app, APP)
})

// ---- `space.home` → `home{}` (T-34227) -------------------------------------

// A directory that carries with the front page still named in the
// fleet-shaped `space` table.
let seedHomes = async (ctx: State) => {
  let old = older(ctx, PLATFORM_STORE)
  await old.apply([
    { entity: { eid: ADA }, person: {} },
    { entity: { eid: SPACE }, space: { slug: 'ada' }, doc: { title: 'Ada' } },
    { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
    { entity: { eid: ONE }, app: { slug: 'garden', space: SPACE } },
    { entity: { eid: TWO }, space: { slug: 'ben' } },
  ])
  // The space names its front page once the app it names exists.
  await old.apply([{ entity: { eid: SPACE }, space: { home: APP } }])
  return old
}

// Which apps wear `home`, by slug, read through the store's own door.
let wearing = async (now: ReturnType<typeof newer>) =>
  (await now.query('.home&.app'))
    .map((r) => (r.app as { slug: string }).slug)

// The marker this object wrote when its pass reconciled, out of its own
// memory.
let marker = (ctx: State) => slot(ctx, 'migrated')

// A directory already on the packages, carried and marked.
let carriedOne = async (ctx: State) => {
  let now = newer(ctx, PLATFORM_STORE)
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' }, doc: { title: 'Ada' } },
      { entity: { eid: TWO }, space: { slug: 'ben' } },
    ]),
  })
  keep(ctx, 'migrated', MARK)
  return now
}

Deno.test(
  'a store carrying now arrives with the front page on the app',
  async () => {
    let ctx = state()
    await seedHomes(ctx)
    let now = newer(ctx, PLATFORM_STORE)
    // One row per space that named one — `ben` named none and gets none.
    assertEquals(await wearing(now), ['cookbook'])
    assertEquals(tally(db(ctx), 'home'), 1)
    assertEquals(marker(ctx), MARK)
  },
)

Deno.test(
  'two spaces naming one app refuses, and the column keeps the fact',
  async () => {
    let ctx = state()
    let old = await seedHomes(ctx)
    await old.apply([{ entity: { eid: TWO }, space: { home: APP } }])
    let now = newer(ctx, PLATFORM_STORE)
    let said = await why(now)
    assert(said.includes('2 spaces named a front page'), said)
  },
)

// ---- the refusals ----------------------------------------------------------

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

Deno.test('a declared index failure refuses constructor boot', async () => {
  let ctx = state()
  await carriedOne(ctx)
  run(
    ctx,
    { t: 'drop', kind: 'index', name: 'space_slug' },
    every('space', { slug: 'same' }),
  )
  keep(ctx, 'schema', 'older schema')
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'skipped unique index space_slug')
  assertEquals(marker(ctx), MARK)
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
  assertEquals(marker(ctx), null)
})

Deno.test('a marker write failure rolls back the pass, even for a thrown value', async () => {
  let ctx = state()
  await seedHomes(ctx)
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (query, ...params) => {
    if (query.startsWith('insert into "yak_kv"') && params[1] == MARK) {
      throw 'marker unavailable'
    }
    return exec(query, ...params)
  }
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'marker unavailable')
  assertEquals(marker(ctx), null)
  // The fleet's tables are standing as they were.
  assertEquals(named(ctx, { name: 'journal_tx' }), ['journal_tx'])
})

for (let door of ['constructor', 'vocab']) {
  Deno.test(`a ${door} schema failure preserves vocabulary and metadata`, async () => {
    let ctx = state()
    let now = newer(ctx, 'ada/cookbook')
    assertEquals(
      (await now.door('/vocab', {
        method: 'POST',
        body: JSON.stringify(
          {
            $defs: {
              recipe: {
                component: true,
                properties: { title: { type: 'string' } },
              },
            },
          },
        ),
      })).status,
      200,
    )
    if (door == 'constructor') keep(ctx, 'schema', 'older schema')
    let slots = () =>
      db(ctx).query(select({ from: table('yak_kv'), order: [col('k')] }))
    let before = slots()
    ctx.slots.set('vocab', '{}')
    let sql = ctx.storage.sql
    let exec = sql.exec.bind(sql)
    sql.exec = (query, ...params) => {
      if (
        query.startsWith(
          `create table if not exists "${
            door == 'constructor' ? 'recipe' : 'menu'
          }"`,
        )
      ) {
        throw new Error('fixture schema failure')
      }
      return exec(query, ...params)
    }
    if (door == 'constructor') {
      now = newer(ctx, 'ada/cookbook')
    } else {
      let response = await now.door('/vocab', {
        method: 'POST',
        body: JSON.stringify(
          {
            $defs: {
              menu: {
                component: true,
                properties: { title: { type: 'string' } },
              },
            },
          },
        ),
      })
      assertEquals(response.status, 503)
      assertEquals(response.headers.get('x-yak-migration'), 'refused')
    }
    await refused(now, 'fixture schema failure')
    assertEquals(slots(), before)
    assertEquals(tally(db(ctx), 'recipe'), 0)
    assertEquals(named(ctx, { name: 'menu' }), [])
    // The slot keeps the document the manifest means (graph.ts `#vocabDoor`),
    // whichever format the deploy was written in.
    assertEquals(slot(ctx, 'name'), 'ada/cookbook')
    assertEquals(JSON.parse(slot(ctx, 'vocab') ?? '').$defs.recipe.properties, {
      title: { type: 'string' },
    })
  })
}

for (
  let [label, error, message] of [
    ['error', new Error('identity write failed'), 'identity write failed'],
    ['empty error', new Error(''), 'the migration refused'],
    ['unprintable value', Object.create(null), 'the migration refused'],
  ] as [string, unknown, string][]
) {
  Deno.test(`an identity write throwing an ${label} is a persistent refusal`, async () => {
    let ctx = state()
    let now = newer(ctx, PLATFORM_STORE)
    let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
    ctx.storage.sql.exec = (query, ...params) => {
      if (query.startsWith('insert into "yak_kv"') && params[0] == 'name') {
        throw error
      }
      return exec(query, ...params)
    }
    await refused(now, message)
    assertEquals(marker(ctx), null)
  })
}

Deno.test('a re-addressing that collides rolls the whole pass back', async () => {
  let ctx = state()
  let old = older(ctx, 'ada/cookbook')
  let refs = edgeEid(TWO, 'references', ADA)
  // The address that edge takes under the relation's new name — already
  // spoken for here, so re-addressing it cannot land. This is the one condition
  // in a customer's own rows that can make the pass refuse.
  let taken = edgeEid(TWO, 'referenced', ADA)
  await old.apply([
    { entity: { eid: ADA }, doc: { title: 'Ada' } },
    { entity: { eid: TWO }, doc: { title: 'Notes' } },
    { entity: { eid: taken }, doc: { title: 'in the way' } },
    { entity: { eid: refs }, edge: { from: TWO, to: ADA }, references: {} },
  ])
  let now = newer(ctx, 'ada/cookbook')

  // The rows are exactly what they were: the pass ran in one transaction and it
  // unwound. The object says so rather than serving half a graph.
  let read = await now.door('/query?q=.doc', {}, APP)
  assertEquals(read.status, 503)
  assertEquals(tally(db(ctx), 'doc'), 3)
  assertEquals(tally(db(ctx), 'references'), 1)
  let said = await why(now, APP)
  assert(/unique/i.test(said), said)
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  // A write is kept for the store to apply once it can (writes.ts).
  assertEquals(write.status, 202)
})

Deno.test('counts that do not reconcile refuse the pass', async () => {
  let ctx = state()
  await seedApp(ctx)
  // The rule itself, at its own seam. It guards the code, not the data — a copy
  // that quietly loses or gains a row — so `plant` stands in for one that went
  // wrong: the schema is raised the way the object raises it, and then one row
  // too many lands in a table the pass is about to fill.
  let vocab = appVocab({
    $defs: {
      recipe: {
        component: true,
        properties: { title: { type: 'string' }, serves: { type: 'number' } },
      },
    },
  })
  let before = tally(db(ctx), 'doc')
  let raised: unknown = null
  try {
    ctx.storage.transactionSync(() =>
      carry(ctx.storage, {
        store: 'ada/cookbook',
        app: APP,
        vocab,
        plant: () => {
          let d = db(ctx)
          for (let stmt of [...schema(vocab), ...blobSchema()]) d.query(stmt)
          let kept = select({
            cols: [col('entity')],
            from: table('yak_old_person'),
          })
          d.query({
            t: 'insert',
            into: 'person',
            cols: ['entity'],
            q: select({
              cols: [col('id')],
              from: table('entity'),
              where: not(among(col('id'), kept)),
              limit: lit(1),
            }),
          })
        },
        grantEid: (app, person) => `${app}:${person}`,
      })
    )
  } catch (e) {
    raised = e
  }
  assert(raised instanceof Unreconciled, String(raised))
  assert(/person/.test(raised.report.message ?? ''), raised.report.message)
  assertEquals(raised.report.ok, false)
  // And it unwound: the old tables are standing with the rows they had.
  assertEquals(tally(db(ctx), 'doc'), before)
})

Deno.test('a body nothing holds refuses the pass', async () => {
  let ctx = state()
  await seedApp(ctx)
  // The blob a doc addresses, gone. Nothing can read that body, and a body that
  // cannot be read is what this pass may not quietly turn into a null.
  run(ctx, {
    t: 'delete',
    from: 'blob_text',
    where: eq(
      col('entity'),
      sub(
        select({
          cols: [col('body')],
          from: table('doc'),
          where: eq(col('entity'), id(ONE)),
        }),
      ),
    ),
  })
  let now = newer(ctx, 'ada/cookbook')
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  // A write is kept for the store to apply once it can (writes.ts).
  assertEquals(write.status, 202)
  let said = await why(now, APP)
  assert(/address a body/.test(said), said)
  assertEquals(tally(db(ctx), 'doc'), 3)
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

Deno.test(
  'a fleet-shaped app carries filing from the former task columns',
  async () => {
    let ctx = state()
    let was = older(ctx, 'ada/cookbook')
    was.apply([
      { entity: { eid: ONE }, doc: { title: 'Old chore' }, task: {} },
    ])
    // Restore the layout that deployed before the fleet split; no filed row
    // exists. The carry must read these values before dropping the old table.
    run(
      ctx,
      ...grow('task', { name: 'priority', type: 'real' }, {
        name: 'domain',
        type: 'text',
      }),
      every('task', { priority: 2, domain: 'Garden' }),
    )
    let now = newer(ctx, 'ada/cookbook')
    let [row] = await now.query('.task&?filed')
    assertEquals((row.filed as { priority: number }).priority, 2)
    assertEquals((row.filed as { domain: string }).domain, 'Garden')
    assertEquals(marker(ctx), MARK)
  },
)

Deno.test('a refused migration reaches Sentry, tagged with its store', async () => {
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
  let ctx = state()
  await seedApp(ctx)
  // A body the blob table no longer holds is one the pass refuses to lose.
  run(ctx, { t: 'delete', from: 'blob_text' })
  let now = newer(ctx, 'ada/cookbook')
  await refused(now, 'address a body')
  await client.flush(1000)
  assertEquals(seen.length, 1)
  assertEquals(seen[0].tags, {
    request: 'migration',
    store: 'ada/cookbook',
    mark: MARK,
  })
  assertEquals(marker(ctx), null)
})
