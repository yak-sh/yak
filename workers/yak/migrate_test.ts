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
import { slow } from '../../bin/testing.ts'
import { blobSchema } from '@yaks/blob'
import { type Bundle, derivedEid } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { driver, type Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { edgeEid } from '@yaks/edge'
import { entryEid, objects } from '@yaks/git'
import { schema } from '@yaks/sqlite'
import { Store } from './graph.ts'
import {
  carry,
  documented,
  ENTERED,
  FILED,
  FORMER,
  HANDLED,
  handled,
  HOMED,
  MARK,
  MARKS,
  Refused as Unreconciled,
  type Report,
  respelled,
  SANDBOXED,
  SENT,
  SERVES,
  TOOLED,
  unholed,
  unworded,
} from './migrate.ts'
import legacy from './fixtures/legacy_store.json' with { type: 'json' }
import { GIT_STORE, PLATFORM_STORE } from './door.ts'
import { appVocab } from './vocab.ts'
import { slugsOf } from './directory.ts'

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
let THREE = '33000000-0000-4000-8000-000000000033'
let FOUR = '44000000-0000-4000-8000-000000000044'
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

let columns = (ctx: State, table: string): string[] =>
  ctx.storage.sql.exec(`pragma table_info("${table}")`).toArray()
    .map((row) => String((row as { name: string }).name))

let count = (ctx: State, table: string): number =>
  Number(
    (ctx.storage.sql.exec(`select count(*) as n from "${table}"`)
      .toArray()[0] as { n: number }).n,
  )

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

slow('an app store carries every row across, and reconciles', async () => {
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
  assertEquals(count(ctx, 'tombstone'), 1)
  assertEquals(marker(ctx), LATEST)

  // The fleet's other words have no table on the packages, the journal among
  // them.
  let tables = ctx.storage.sql
    .exec("select name from sqlite_master where type = 'table'").toArray()
    .map((r) => (r as { name: string }).name)
  assert(!tables.some((t) => t.startsWith('journal_')), tables.join(', '))
})

slow("the runtime's own table is not the object's to move", async () => {
  let ctx = state()
  await seedApp(ctx)

  // What every deployed object carries and no probe ever had (T-34019): the
  // table behind `ctx.storage.kv`, which the old store kept everything it
  // remembered in. `sqlite_master` lists it like any other and the authorizer
  // then refuses to read it, so a pass that enumerated tables and selected from
  // each threw before a row moved — and the object served 503 for its lifetime.
  ctx.storage.beneath(
    'create table "_cf_KV" (key text primary key, value blob) without rowid',
  )
  ctx.storage.beneath(`insert into "_cf_KV" values ('name', 'ada/cookbook')`)
  assertThrows(
    () => ctx.storage.sql.exec('select * from "_cf_KV"'),
    Error,
    'SQLITE_AUTH',
  )

  let now = newer(ctx, 'ada/cookbook')
  assertEquals((await now.query('.doc', APP)).length, 3)
  assertEquals(marker(ctx), LATEST)

  // And it is standing where the runtime left it, with its row — proof the pass
  // neither dropped it nor renamed it aside.
  let held = ctx.storage.beneath('select count(*) as n from "_cf_KV"')
  assertEquals(Number(held[0].n), 1)
})

// ---- the slots (T-37546) ---------------------------------------------------

// A store that last accepted the short type map remembers it that way. The
// short form is gone from every door, so the slot itself is rewritten as the
// document at the object's next open — and `seedApp` writes one the old way,
// which is what `older().vocab()` still does. The tools slot the same way: a
// manifest accepted while `{{arg}}` was the hole is rewritten with `$arg`.
slow(
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
    let held = JSON.parse(
      (ctx.storage.sql.exec("select v from yak_kv where k = 'vocab'")
        .toArray()[0] as { v: string }).v,
    )
    assertEquals(Object.keys(held), ['$defs'])
    assertEquals(held.$defs.recipe.kind, true)

    ctx.storage.sql.exec(
      "insert into yak_kv (k, v) values ('tools', ?)",
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

slow('the second boot is a no-op', async () => {
  let ctx = state()
  await seedApp(ctx)
  let first = newer(ctx, 'ada/cookbook')
  assertEquals((await first.query('.doc', APP)).length, 3)
  assertEquals(marker(ctx), LATEST)

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

slow('the directory keeps its three seats', async () => {
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

slow('an app store splits the seat from the level', async () => {
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

// A directory reaches version 2 from either side, so both are held here: the
// store that carries with the column still in the fleet-shaped tables, and the
// one that carried before the word existed, which is where every deployed
// directory is — its `space` table still standing with a `home` column in it,
// because SQLite never drops a column a vocabulary stopped declaring.
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

// The version marker this object stands at (migrate.ts `MARKS`), out of its
// own memory.
let marker = (ctx: State): string | null =>
  (ctx.storage.sql.exec("select v from yak_kv where k = 'migrated'")
    .toArray()[0] as { v: string } | undefined)?.v ?? null

// The marker an object caught up with every pass stands at.
let LATEST = MARKS[MARKS.length - 1]

/**
 * A directory as a deployed one stands right now: carried to version 1 and no
 * further, its `space` table still holding the `home` column with the front
 * page named in it. Built over the new store, because that is what version 1
 * leaves behind — the column outlives the word that declared it, which is the
 * whole reason there is a second pass.
 */
let carriedOne = async (ctx: State) => {
  let now = newer(ctx, PLATFORM_STORE)
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' }, doc: { title: 'Ada' } },
      { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
      { entity: { eid: ONE }, app: { slug: 'garden', space: SPACE } },
      { entity: { eid: TWO }, space: { slug: 'ben' } },
    ]),
  })
  let sql = ctx.storage.sql
  sql.exec('alter table space add column home integer references entity(id)')
  sql.exec(
    'update space set home = (select id from entity where eid = ?) ' +
      'where entity = (select id from entity where eid = ?)',
    APP,
    SPACE,
  )
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    MARK,
  )
  return now
}

slow(
  'a store carrying now arrives with the front page on the app',
  async () => {
    let ctx = state()
    await seedHomes(ctx)
    let now = newer(ctx, PLATFORM_STORE)
    // One row per space that named one — `ben` named none and gets none.
    assertEquals(await wearing(now), ['cookbook'])
    assertEquals(count(ctx, 'home'), 1)
    // Every pass in the same breath, so none of them has anything to do.
    assertEquals(marker(ctx), LATEST)
  },
)

slow(
  'a directory that already carried moves the column on next touch',
  async () => {
    let ctx = state()
    await carriedOne(ctx)

    // A fresh incarnation over the same object — a deploy, in other words — and
    // the first request carries it the rest of the way.
    let now = newer(ctx, PLATFORM_STORE)
    assertEquals(await wearing(now), ['cookbook'])
    assertEquals(count(ctx, 'home'), 1)
    // The old place is gone, so nothing can read the fact from two places.
    assertEquals(
      ctx.storage.sql.exec('pragma table_info(space)').toArray()
        .some((c) => (c as { name: string }).name == 'home'),
      false,
    )
    // And it does not run again: the marker is written.
    assertEquals(marker(ctx), LATEST)
  },
)

slow(
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

// ---- the app's addresses → `former` (T-34390) ------------------------------

// A directory reaches version 3 from either side too: the store that carries
// with the addresses still in the fleet-shaped `alias` table, and the one that
// carried before @yaks/alias took that word — whose `alias` table is standing
// with the addresses in it and the core tag now writing rows of its own there.
let seedFormer = async (ctx: State) => {
  let old = older(ctx, PLATFORM_STORE)
  await old.apply([
    { entity: { eid: SPACE }, space: { slug: 'ada' } },
    {
      entity: { eid: APP },
      app: { slug: 'cookbook', space: SPACE },
      alias: { slug: 'ada/cookbook' },
    },
    // The app that has been renamed: born at `garden`, answering there still.
    {
      entity: { eid: ONE },
      app: { slug: 'orchard', space: SPACE },
      alias: { slug: 'ada/garden', slugs: 'ada/plot' },
    },
    // A space wears no address of its own, which is the row that must not move.
    { entity: { eid: TWO }, space: { slug: 'ben' } },
  ])
  return old
}

// Every address the directory holds, by the app that answers at it.
let answering = async (now: ReturnType<typeof newer>) =>
  (await now.query('.former&.app'))
    .map((r) => [
      (r.app as { slug: string }).slug,
      (r.former as { slug: string; slugs?: string }).slug,
      (r.former as { slugs?: string }).slugs ?? '',
    ])
    .sort()

/**
 * A directory as a deployed one stands right now: carried past the front-page
 * pass and no further, its app addresses still in the table `alias` — which the
 * core word owns as of T-34390, so the columns are standing under a word that
 * declares neither.
 */
let carriedTwo = async (ctx: State) => {
  let now = newer(ctx, PLATFORM_STORE)
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' } },
      { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
      { entity: { eid: ONE }, app: { slug: 'orchard', space: SPACE } },
    ]),
  })
  let sql = ctx.storage.sql
  sql.exec('alter table alias add column slug text')
  sql.exec('alter table alias add column slugs text')
  sql.exec('create unique index alias_slug on alias ("slug")')
  let put = (eid: string, slug: string, slugs: string | null) =>
    sql.exec(
      'insert into alias (entity, slug, slugs) ' +
        'select id, ?, ? from entity where eid = ?',
      slug,
      slugs,
      eid,
    )
  put(APP, 'ada/cookbook', null)
  put(ONE, 'ada/garden', 'ada/plot')
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    HOMED,
  )
  return now
}

slow('a store carrying now arrives with the addresses moved', async () => {
  let ctx = state()
  await seedFormer(ctx)
  let now = newer(ctx, PLATFORM_STORE)
  assertEquals(await answering(now), [
    ['cookbook', 'cookbook', ''],
    ['orchard', 'garden', 'plot'],
  ])
  // The core word's table is planted and empty: an address is not a name tag,
  // so nothing was copied into it on the way past.
  assertEquals(count(ctx, 'alias'), 0)
  // Every pass in the same breath, so none of the later ones has anything left.
  assertEquals(marker(ctx), LATEST)
})

slow('a directory that already carried moves them on next touch', async () => {
  let ctx = state()
  await carriedTwo(ctx)

  // A fresh incarnation over the same object — a deploy, in other words — and
  // the first request carries it the rest of the way.
  let now = newer(ctx, PLATFORM_STORE)
  assertEquals(await answering(now), [
    ['cookbook', 'cookbook', ''],
    ['orchard', 'garden', 'plot'],
  ])

  // The old place is gone — the columns and the unique index the old word
  // declared — so the core word has the table to itself.
  let cols = ctx.storage.sql.exec('pragma table_info(alias)').toArray()
    .map((c) => (c as { name: string }).name)
  assertEquals(cols, ['entity'])
  assertEquals(count(ctx, 'alias'), 0)

  // And it does not run again: the marker is written.
  assertEquals(marker(ctx), LATEST)
})

// ---- a domain's target: `hostname.app` → `hostname.serves` (T-34596) --------
//
// A directory as a deployed one stands: carried past the addresses and no
// further, its domains still aimed by the old column, which the vocabulary no
// longer declares. Nothing selects it, so a domain left there would serve
// nobody — a customer's own address answering the branded page for good.
let carriedThree = async (ctx: State) => {
  let now = newer(ctx, PLATFORM_STORE)
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' } },
      { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
      { entity: { eid: ONE }, hostname: { name: 'herbusiness.com' } },
    ]),
  })
  let sql = ctx.storage.sql
  sql.exec('alter table hostname add column app text')
  sql.exec(
    'update hostname set app = (select id from entity where eid = ?) ' +
      'where entity = (select id from entity where eid = ?)',
    APP,
    ONE,
  )
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    FORMER,
  )
  return now
}

slow('a domain aimed by the old column is aimed by the new one', async () => {
  let ctx = state()
  await carriedThree(ctx)

  // A fresh incarnation over the same object — a deploy — and the first
  // request carries it the rest of the way.
  let now = newer(ctx, PLATFORM_STORE)
  let [row] = await now.query('.hostname')
  assertEquals(
    (row.hostname as { name: string; serves: { eid: string } }).name,
    'herbusiness.com',
  )
  let aimed = (row.hostname as { serves: { eid: string } | string }).serves
  assertEquals(typeof aimed == 'string' ? aimed : aimed.eid, APP)

  // The old column is gone with its values, so nothing can aim a domain two
  // ways.
  let cols = ctx.storage.sql.exec('pragma table_info(hostname)').toArray()
    .map((c) => (c as { name: string }).name)
  assert(!cols.includes('app'), cols.join(', '))

  // And it does not run again.
  assertEquals(marker(ctx), LATEST)
})

// ---- an app's handle: `former.slug` → `app.store` (T-34657) -----------------
//
// A directory as a deployed one stands: carried past the domains and no
// further, its apps still named by the address each was born at. The handle
// each app ends up with is the string it was already stored under, which is
// what makes this a migration nothing moves for.
let carriedFour = async (ctx: State) => {
  let now = newer(ctx, PLATFORM_STORE)
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' } },
      {
        entity: { eid: APP },
        app: { slug: 'cookbook', space: SPACE },
        former: { slug: 'ada/cookbook' },
      },
      // Renamed once: born at `garden`, living at `orchard`, answering at both.
      {
        entity: { eid: ONE },
        app: { slug: 'orchard', space: SPACE },
        former: { slug: 'ada/garden', slugs: 'ada/plot' },
      },
      // And one from before addresses were kept at all: no `former` row.
      { entity: { eid: TWO }, app: { slug: 'shed', space: SPACE } },
    ]),
  })
  let sql = ctx.storage.sql
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    SERVES,
  )
  return now
}

// Every app, by the handle it is stored under and the addresses it answers at.
let handling = async (now: ReturnType<typeof newer>) =>
  (await now.query('.app&?former'))
    .map((r) => [
      (r.app as { slug: string; store?: string }).slug,
      (r.app as { store?: string }).store ?? '',
      slugsOf(r.former as { slug?: string; slugs?: string }).join(' '),
    ])
    .sort()

slow('an app named by its birth address is named by a handle', async () => {
  let ctx = state()
  await carriedFour(ctx)

  // A fresh incarnation over the same object — a deploy — and the first
  // request carries it the rest of the way.
  let now = newer(ctx, PLATFORM_STORE)
  // Each app holds the exact string it was already stored under, so no object
  // is renamed and no byte moves; the addresses are the app's own history now,
  // read in the space's namespace rather than through the space's name.
  assertEquals(await handling(now), [
    ['cookbook', 'ada/cookbook', 'cookbook'],
    ['orchard', 'ada/garden', 'garden plot'],
    ['shed', 'ada/shed', ''],
  ])

  // The unique index the birth address was decided by is down, which is what
  // lets one address be held by two apps a year apart (T-34659).
  let indexes = ctx.storage.sql
    .exec("select name from sqlite_master where type = 'index'")
    .toArray().map((r) => (r as { name: string }).name)
  assert(!indexes.includes('former_slug'), indexes.join(', '))
  assert(indexes.includes('app_store'), indexes.join(', '))

  // And it does not run again.
  assertEquals(marker(ctx), LATEST)
})

slow('two apps may hold one address, and be two stores', async () => {
  let ctx = state()
  await carriedFour(ctx)
  let now = newer(ctx, PLATFORM_STORE)
  // `garden` is an address `orchard` left behind. A new app born there is a
  // write the index used to refuse; what keeps the two apart is the handle,
  // and the handle is not the address.
  await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([{
      entity: { eid: THREE },
      app: { slug: 'garden', space: SPACE, store: 'ada/garden.f00d99' },
      former: { slug: 'garden' },
    }]),
  })
  assertEquals(await handling(now), [
    ['cookbook', 'ada/cookbook', 'cookbook'],
    ['garden', 'ada/garden.f00d99', 'garden'],
    ['orchard', 'ada/garden', 'garden plot'],
    ['shed', 'ada/shed', ''],
  ])
  // The handle is still the one thing no two apps may share.
  let no = await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([{
      entity: { eid: FOUR },
      app: { slug: 'shed-two', space: SPACE, store: 'ada/garden.f00d99' },
    }]),
  })
  assert(!no.ok, 'a second app took a handle that was already held')
})

let collision = async (ctx: State, source = 'fallback') => {
  await carriedFour(ctx)
  let sql = ctx.storage.sql
  sql.exec('drop index if exists former_slug')
  sql.exec(
    'update former set slug = ? where entity = (select id from entity where eid = ?)',
    'ada/shed',
    ONE,
  )
  if (source == 'former') {
    sql.exec(
      'insert into former (entity, slug) select id, ? from entity where eid = ?',
      'ada/shed',
      TWO,
    )
  }
}

let disambiguated = (report: Report) => {
  let note = report.moved.find((m) => m.table == 'app')?.note ?? ''
  for (
    let text of [
      'ada/shed',
      TWO,
      'ada/shed.000002',
      'ada/orchard',
      ONE,
      'empty store',
      'no data copied',
    ]
  ) {
    assert(note.includes(text), note)
  }
}

for (let source of ['former', 'fallback']) {
  slow(
    `colliding handles from ${source} keep the oldest app's store`,
    async () => {
      let ctx = state()
      await collision(ctx, source)
      let now = newer(ctx, PLATFORM_STORE)
      let rows = [
        ['cookbook', 'ada/cookbook', 'cookbook'],
        ['orchard', 'ada/shed', 'shed plot'],
        ['shed', 'ada/shed.000002', source == 'former' ? 'shed' : ''],
      ]
      assertEquals(await handling(now), rows)
      assertEquals(marker(ctx), LATEST)
      assertEquals(await handling(newer(ctx, PLATFORM_STORE)), rows)
    },
  )
}

slow('a handle already assigned stays with its app', async () => {
  let ctx = state()
  await collision(ctx)
  ctx.storage.sql.exec(
    'update app set store = ? where entity = (select id from entity where eid = ?)',
    'ada/shed',
    TWO,
  )
  let now = newer(ctx, PLATFORM_STORE)
  assertEquals(await handling(now), [
    ['cookbook', 'ada/cookbook', 'cookbook'],
    ['orchard', 'ada/orchard.000001', 'shed plot'],
    ['shed', 'ada/shed', ''],
  ])
  assertEquals(marker(ctx), LATEST)
})

slow('a directory grows the handle column before indexing it', async () => {
  let ctx = state()
  await collision(ctx)
  let sql = ctx.storage.sql
  // A directory from before app.store existed must reach the migration too.
  sql.exec('drop index app_store')
  sql.exec('alter table app drop column store')
  sql.exec("update yak_kv set v = 'before handles' where k = 'schema'")
  let now = newer(ctx, PLATFORM_STORE)
  assertEquals(await handling(now), [
    ['cookbook', 'ada/cookbook', 'cookbook'],
    ['orchard', 'ada/shed', 'shed plot'],
    ['shed', 'ada/shed.000002', ''],
  ])
  assertEquals(marker(ctx), LATEST)
  assertEquals(
    sql.exec('pragma index_info(app_store)').toArray()[0].name,
    'store',
  )
})

for (let conflict of ['suffix', 'index']) {
  slow(
    `a handle ${conflict} conflict refuses with the assignment report`,
    async () => {
      let ctx = state()
      await collision(ctx)
      let sql = ctx.storage.sql
      if (conflict == 'suffix') {
        // A generated suffix must not take another app's historical store.
        sql.exec(
          'update former set slug = ? where entity = (select id from entity where eid = ?)',
          'ada/shed.000002',
          APP,
        )
      } else {
        // The writes can still fail after planning: keep the report and rollback.
        sql.exec(
          'create unique index refused_handles on app ((store is not null)) where store is not null',
        )
      }
      let before = sql.exec('select * from app').toArray()
      let history = sql.exec('select * from former').toArray()
      let no = assertThrows(
        () =>
          ctx.storage.transactionSync(() =>
            handled(ctx.storage, { store: PLATFORM_STORE, app: null })
          ),
        Unreconciled,
      )
      disambiguated(no.report)
      if (conflict == 'index') {
        assert(/unique/i.test(no.message), no.message)
      }

      let now = newer(ctx, PLATFORM_STORE)
      let read = await now.door('/query?q=.app')
      assertEquals(read.status, 503)
      assertEquals(read.headers.get('x-yak-migration'), 'refused')
      assertEquals((await read.json()).error, 'Refused')
      assertEquals(sql.exec('select * from app').toArray(), before)
      assertEquals(sql.exec('select * from former').toArray(), history)
      assertEquals(marker(ctx), SERVES)
    },
  )
}

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

Deno.test('a raw constraint failure in a pass refuses once and rolls back', async () => {
  let ctx = state()
  await carriedOne(ctx)
  let sql = ctx.storage.sql
  sql.exec(`create trigger refuse_home before insert on home begin
    select raise(abort, 'UNIQUE constraint failed: home.entity'); end`)
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'UNIQUE constraint failed')
  assertEquals(marker(ctx), MARK)
  assertEquals(count(ctx, 'home'), 0)
  await refused(
    newer(ctx, PLATFORM_STORE),
    'UNIQUE constraint failed',
  )
  assertEquals(marker(ctx), MARK)
})

Deno.test('a declared index failure refuses constructor boot', async () => {
  let ctx = state()
  await carriedOne(ctx)
  let sql = ctx.storage.sql
  sql.exec('drop index space_slug')
  sql.exec("update space set slug = 'same'")
  sql.exec("update yak_kv set v = 'older schema' where k = 'schema'")
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'skipped unique index space_slug')
  assertEquals(marker(ctx), MARK)
  assertEquals(sql.exec("select v from yak_kv where k = 'schema'").toArray(), [{
    v: 'older schema',
  }])
})

Deno.test('boot leaves a populated table constraint for its preparing pass', async () => {
  let ctx = state()
  await carriedFour(ctx)
  let sql = ctx.storage.sql
  sql.exec('drop index app_store')
  sql.exec("update yak_kv set v = 'older schema' where k = 'schema'")
  let exec = sql.exec.bind(sql)
  let created = false
  sql.exec = (query, ...params) => {
    if (query.startsWith('create unique index if not exists app_store')) {
      let [row] = exec('select count(*) as n from app where store is null')
        .toArray() as { n: number }[]
      assertEquals(row.n, 0)
      created = true
    }
    return exec(query, ...params)
  }
  let now = newer(ctx, PLATFORM_STORE)
  assertEquals(created, false)
  assertEquals((await now.door('/query?q=.app')).status, 200)
  assertEquals(created, true)
  assertEquals(marker(ctx), LATEST)
  assertThrows(() => exec("update app set store = 'same'"), Error, 'UNIQUE')
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

Deno.test('a marker write failure rolls back its pass, even for a thrown value', async () => {
  let ctx = state()
  await carriedOne(ctx)
  let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
  ctx.storage.sql.exec = (query, ...params) => {
    if (query.startsWith('insert into "yak_kv"') && params[1] == HOMED) {
      throw 'marker unavailable'
    }
    return exec(query, ...params)
  }
  let now = newer(ctx, PLATFORM_STORE)
  await refused(now, 'marker unavailable')
  assertEquals(marker(ctx), MARK)
  assertEquals(count(ctx, 'home'), 0)
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
    let sql = ctx.storage.sql
    if (door == 'constructor') {
      sql.exec("update yak_kv set v = 'older schema' where k = 'schema'")
    }
    let before = sql.exec('select * from yak_kv order by k').toArray()
    ctx.slots.set('vocab', '{}')
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
    assertEquals(sql.exec('select * from yak_kv order by k').toArray(), before)
    assertEquals(count(ctx, 'recipe'), 0)
    assertEquals(
      sql.exec("select name from sqlite_master where name = 'menu'").toArray(),
      [],
    )
    // The slot keeps the document the manifest means (graph.ts `#vocabDoor`),
    // whichever format the deploy was written in.
    let slot = (k: string) =>
      (before as { k: string; v: string }[]).find((r) => r.k == k)!.v
    assertEquals(slot('name'), 'ada/cookbook')
    assertEquals(JSON.parse(slot('vocab')).$defs.recipe.properties, {
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

slow('a re-addressing that collides rolls the whole pass back', async () => {
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
  assertEquals(count(ctx, 'doc'), 3)
  assertEquals(count(ctx, 'references'), 1)
  let said = await why(now, APP)
  assert(/unique/i.test(said), said)
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  // A write is kept for the store to apply once it can (writes.ts).
  assertEquals(write.status, 202)
})

slow('counts that do not reconcile refuse the pass', async () => {
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
  let before = count(ctx, 'doc')
  let raised: unknown = null
  try {
    ctx.storage.transactionSync(() =>
      carry(ctx.storage, {
        store: 'ada/cookbook',
        app: APP,
        vocab,
        plant: () => {
          let d = driver(ctx.storage)
          for (let stmt of [...schema(vocab), ...blobSchema()]) d.query(stmt)
          ctx.storage.sql.exec(
            'insert into person (entity) select id from entity ' +
              'where id not in (select entity from yak_old_person) limit 1',
          )
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
  assertEquals(count(ctx, 'doc'), before)
})

slow('a body nothing holds refuses the pass', async () => {
  let ctx = state()
  await seedApp(ctx)
  // The blob a doc addresses, gone. Nothing can read that body, and a body that
  // cannot be read is what this pass may not quietly turn into a null.
  ctx.storage.sql.exec(
    'delete from blob_text where entity = ' +
      '(select body from doc where entity = (select id from entity where eid = ' +
      `'${ONE}'))`,
  )
  let now = newer(ctx, 'ada/cookbook')
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  // A write is kept for the store to apply once it can (writes.ts).
  assertEquals(write.status, 202)
  let said = await why(now, APP)
  assert(/address a body/.test(said), said)
  assertEquals(count(ctx, 'doc'), 3)
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
  ctx.storage.sql.exec('drop trigger doc_fts_insert')
  ctx.storage.sql.exec(
    `create trigger doc_fts_insert after insert on doc begin
      insert into doc_fts(rowid, "title", "body")
        values (new.entity, coalesce(new."title", ''), coalesce(new."body", ''));
    end`,
  )
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
  let sql = ctx.storage.sql
  // The retired sqlite DDL read external content through doc_value. Its
  // resolved triggers have the same mirror rule as FTS's, so leave them in
  // place to prove boot replaces the index without losing the stored prose.
  sql.exec('drop table doc_fts')
  sql.exec('drop view doc_text')
  sql.exec(`create virtual table doc_fts using fts5(
    title, body, content='doc_value', content_rowid='entity'
  )`)
  sql.exec("insert into doc_fts(doc_fts) values ('rebuild')")
  sql.exec("update yak_kv set v = 'legacy sqlite FTS' where k = 'schema'")

  let upgraded = newer(ctx, 'ada/cookbook')
  let hits = await upgraded.query('lemons', APP)
  assertEquals(hits.length, 1)
  assertEquals(hits[0].entity.eid, ONE)
  let definition = sql.exec(
    "select sql from sqlite_master where name = 'doc_fts'",
  ).toArray()
  assert(String(definition[0].sql).includes("content='doc_text'"))
  // New writes use the new triggers, removing the old words and adding prose
  // rather than a blob address. Another wake keeps those results intact.
  assertEquals((await write(upgraded, 'four limes')).status, 200)
  assertEquals((await upgraded.query('lemons', APP)).length, 0)
  assertEquals((await upgraded.query('limes', APP)).length, 1)
  assertEquals((await newer(ctx, 'ada/cookbook').query('limes', APP)).length, 1)
})

// An already-package-shaped app deployed before the task/filed split. Plant
// current tables, then restore the exact former task columns through SQLite.
let beforeFiling = async (ctx: State) => {
  let now = newer(ctx, 'ada/cookbook')
  let r = await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: ADA }, person: {} },
      { entity: { eid: SPACE }, project: {} },
      { entity: { eid: ONE }, task: {}, doc: { title: 'Water plants' } },
    ]),
  })
  assert(r.ok, await r.text())
  let sql = ctx.storage.sql
  for (
    let [col, type] of [['priority', 'real'], ['project', 'integer'], [
      'assignee',
      'integer',
    ], ['domain', 'text']]
  ) {
    sql.exec(`alter table task add column ${col} ${type}`)
  }
  sql.exec(
    'update task set priority = 2, project = (select id from entity where eid = ?), assignee = (select id from entity where eid = ?), domain = ?',
    SPACE,
    ADA,
    'Garden',
  )
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) on conflict(k) do update set v = excluded.v",
    HANDLED,
  )
}

Deno.test('app filing preserves every value and never resurrects a cleared filing', async () => {
  let ctx = state()
  await beforeFiling(ctx)
  let now = newer(ctx, 'ada/cookbook')
  let [row] = await now.query('.task&?filed')
  assertEquals(row.task, { status: 'open' })
  let filing = row.filed as Record<string, unknown>
  assertEquals(filing.priority, 2)
  assertEquals(filing.domain, 'Garden')
  // The Store returns canonical reference identities (the app decorates them).
  assertEquals(filing.project, SPACE)
  assertEquals(filing.assignee, ADA)
  assertEquals(marker(ctx), LATEST)
  let r = await now.door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([{ entity: { eid: ONE }, filed: null }]),
  })
  assert(r.ok, await r.text())
  assertEquals(await newer(ctx, 'ada/cookbook').query('.filed'), [])
})

Deno.test('app filing rolls back a conflicting destination', async () => {
  let ctx = state()
  await beforeFiling(ctx)
  // The first row is copied before the second conflicts; both changes must
  // roll back, not just the offending row.
  ctx.storage.sql.exec('insert into entity(eid, num) values (?, 99)', TWO)
  ctx.storage.sql.exec(
    'insert into task(entity, priority) select id, 2 from entity where eid = ?',
    TWO,
  )
  ctx.storage.sql.exec(
    'insert into filed(entity, priority) select id, 9 from entity where eid = ?',
    TWO,
  )
  await refused(newer(ctx, 'ada/cookbook'), 'conflicts with filed.priority')
  assertEquals(marker(ctx), HANDLED)
  assertEquals(ctx.storage.sql.exec('select priority from task').toArray(), [{
    priority: 2,
  }, { priority: 2 }])
  assertEquals(ctx.storage.sql.exec('select priority from filed').toArray(), [{
    priority: 9,
  }])
})

slow(
  'a fleet-shaped app carries filing from the former task columns',
  async () => {
    let ctx = state()
    let was = older(ctx, 'ada/cookbook')
    was.apply([
      { entity: { eid: ONE }, doc: { title: 'Old chore' }, task: {} },
    ])
    // Restore the layout that deployed before the fleet split; no filed row
    // exists. The carry must read these values before dropping the old table.
    ctx.storage.sql.exec('alter table task add column priority real')
    ctx.storage.sql.exec('alter table task add column domain text')
    ctx.storage.sql.exec("update task set priority = 2, domain = 'Garden'")
    let now = newer(ctx, 'ada/cookbook')
    let [row] = await now.query('.task&?filed')
    assertEquals((row.filed as { priority: number }).priority, 2)
    assertEquals((row.filed as { domain: string }).domain, 'Garden')
    assertEquals(marker(ctx), LATEST)
  },
)

// An app store as the code before D-37943 left it (jill/coaches, 2026-09-22):
// tool rows at the ids `tool:<name>` hashed to, no unique index over the
// name, a schema stamp the new vocabulary moves, and the marker one pass
// behind. `twins` names tools written twice — a row at the old id and a
// newer one at the derived id, which a planting over the unindexed table
// writes — and a call aimed at each row.
let toolsOld = async (ctx: State, names: string[], twins: string[] = []) => {
  await newer(ctx, 'ada/cookbook').query('.tool')
  let sql = ctx.storage.sql
  sql.exec('drop index tool_name')
  let tool = (eid: string, name: string, call: string) => {
    sql.exec('insert into entity (eid) values (?), (?)', eid, call)
    sql.exec(
      'insert into tool (entity, name) select id, ? from entity where eid = ?',
      name,
      eid,
    )
    sql.exec(
      'insert into call (entity, "to") select c.id, t.id from entity c,' +
        ' entity t where c.eid = ? and t.eid = ?',
      call,
      eid,
    )
  }
  for (let name of names) tool(derivedEid(`tool:${name}`), name, `c-${name}`)
  for (let name of twins) tool(toolEid(name), name, `c2-${name}`)
  sql.exec("update yak_kv set v = 'older schema' where k = 'schema'")
  sql.exec("update yak_kv set v = ? where k = 'migrated'", FILED)
}

let tooling = (ctx: State) =>
  ctx.storage.sql.exec(
    'select e.eid, t.name from tool t join entity e on e.id = t.entity' +
      ' order by t.name',
  ).toArray()

Deno.test('a store with tools at old ids and twins boots, merges and indexes', async () => {
  let ctx = state()
  await toolsOld(ctx, ['add_chore', 'find_chore'], ['add_chore'])
  let now = newer(ctx, 'ada/cookbook')
  let calls = await now.query('.call')
  assertEquals(calls.length, 3)
  assertEquals(
    calls.map((c) => (c.call as { to: string }).to).sort(),
    [toolEid('add_chore'), toolEid('add_chore'), toolEid('find_chore')].sort(),
  )
  assertEquals(tooling(ctx), [
    { eid: toolEid('add_chore'), name: 'add_chore' },
    { eid: toolEid('find_chore'), name: 'find_chore' },
  ])
  assertEquals(marker(ctx), LATEST)
  assertThrows(
    () => ctx.storage.sql.exec("update tool set name = 'add_chore'").toArray(),
    Error,
    'UNIQUE',
  )
})

// A directory one pass behind (C-37980): a copy the build before sandboxed by
// default, one its owner trusted, and one sandboxed on purpose. Only the
// first moves, stamped trusted so both builds serve it unsandboxed.
Deno.test('a copy the build before would sandbox is stamped trusted', async () => {
  let ctx = state()
  let was = '2026-09-01T00:00:00.000Z'
  let pin = (more = {}) => ({ of: APP, version: 1, ...more })
  let r = await newer(ctx, PLATFORM_STORE).door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: SPACE }, space: { slug: 'ada' } },
      { entity: { eid: APP }, app: { slug: 'cookbook', space: SPACE } },
      { entity: { eid: ONE }, installed: pin() },
      { entity: { eid: TWO }, installed: pin({ trusted: was }) },
      { entity: { eid: THREE }, installed: pin({ sandboxed: was }) },
    ]),
  })
  assert(r.ok, await r.text())
  ctx.storage.sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    TOOLED,
  )
  await newer(ctx, PLATFORM_STORE).query('.installed')
  let [one, two, three] = ctx.storage.sql.exec(
    'select i.sandboxed, i.trusted from installed i' +
      ' join entity e on e.id = i.entity order by e.eid',
  ).toArray() as { sandboxed: string | null; trusted: string | null }[]
  assertEquals(one.sandboxed, null)
  assert(one.trusted && one.trusted > was, one.trusted ?? 'unstamped')
  assertEquals([two.sandboxed, two.trusted], [null, was])
  assertEquals([three.sandboxed, three.trusted], [was, null])
  assertEquals(marker(ctx), LATEST)
})

// An app's store one pass behind: three letters the build before sent, whose
// `delivered.via` held a Message-ID, the address it went to (the transport gave
// no id), and `local`; and one that arrived. Only the Message-ID moves.
Deno.test("a sent letter's Message-ID moves onto the letter", async () => {
  let ctx = state()
  let letter = (eid: string, mail: Record<string, string>) => ({
    entity: { eid },
    mail: { from: 'hi@ada.example', ...mail },
  })
  let r = await newer(ctx, 'ada/cookbook').door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      letter(ONE, { to: 'ann@x.example' }),
      letter(TWO, { to: 'bo@x.example' }),
      letter(THREE, { to: 'cy@ada.example' }),
      letter(FOUR, { to: 'hi@ada.example', message_id: 'a1@x.example' }),
    ]),
  }, APP)
  assert(r.ok, await r.text())
  let sql = ctx.storage.sql
  if (!columns(ctx, 'delivered').includes('via')) {
    sql.exec('alter table delivered add column via text')
  }
  for (
    let [eid, via] of [
      [ONE, 'm1@yaks.app'],
      [TWO, 'bo@x.example'],
      [THREE, 'local'],
    ]
  ) {
    sql.exec(
      'insert into delivered (entity, at, via) select id, ?, ? from entity ' +
        'where eid = ?',
      '2026-09-01T00:00:00.000Z',
      via,
      eid,
    )
  }
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    SANDBOXED,
  )
  await newer(ctx, 'ada/cookbook').query('.mail', APP)
  let ids = sql.exec(
    'select m.message_id from mail m join entity e on e.id = m.entity ' +
      'order by e.eid',
  ).toArray().map((row) => (row as { message_id: string | null }).message_id)
  assertEquals(ids, ['m1@yaks.app', null, null, 'a1@x.example'])
  assertEquals(marker(ctx), LATEST)
})

// The git object store one pass behind: a tree whose links were minted under
// `entry`, @yaks/git's tag before `tree_entry`, and a tree with one link under
// each, the same link minted again since. A clone walks `tree_entry` alone.
Deno.test("a tree's links under the old tag are reached again", async () => {
  let ctx = state()
  let [OLD, BOTH, PAGE, WORDS] = ['1', '2', 'a', 'b'].map((c) => c.repeat(40))
  let obj = (eid: string, type: string) => ({
    entity: { eid },
    gitobj: { type, size: 1 },
    blob: { sha: eid },
  })
  let r = await newer(ctx, GIT_STORE).door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      obj(OLD, 'tree'),
      obj(BOTH, 'tree'),
      obj(PAGE, 'blob'),
      obj(WORDS, 'blob'),
      {
        entity: { eid: entryEid(BOTH, 'index.html') },
        edge: { from: BOTH, to: PAGE, ord: 0 },
        tree_entry: { name: 'index.html', mode: '100644' },
      },
    ]),
  })
  assert(r.ok, await r.text())
  let sql = ctx.storage.sql
  sql.exec(
    'create table entry (entity integer primary key references entity(id),' +
      ' name text, mode text)',
  )
  let entry = (tree: string, name: string, to: string, ord: number) => {
    let eid = derivedEid(`entry|${tree}|${name}`)
    sql.exec('insert into entity (eid) values (?)', eid)
    sql.exec(
      'insert into edge (entity, "from", "to", ord) select e.id, f.id, t.id,' +
        ' ? from entity e, entity f, entity t where e.eid = ? and f.eid = ?' +
        ' and t.eid = ?',
      ord,
      eid,
      tree,
      to,
    )
    sql.exec(
      "insert into entry (entity, name, mode) select id, ?, '100644' from" +
        ' entity where eid = ?',
      name,
      eid,
    )
  }
  entry(OLD, 'index.html', PAGE, 0)
  entry(OLD, 'vocab.json', WORDS, 1)
  entry(BOTH, 'index.html', PAGE, 0)
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    SENT,
  )
  let now = newer(ctx, GIT_STORE)
  let read = (line: unknown) => now.query(String(line))
  assertEquals(await objects({ read }, {} as never).reach([OLD, BOTH]), [
    OLD,
    BOTH,
    PAGE,
    WORDS,
  ])
  assertEquals(
    (await now.query(`.tree_entry&.edge.from=${OLD},${BOTH}`))
      .map((l) => l.entity.eid).sort(),
    [
      entryEid(OLD, 'index.html'),
      entryEid(OLD, 'vocab.json'),
      entryEid(BOTH, 'index.html'),
    ].sort(),
  )
  assertEquals(count(ctx, 'edge'), 3)
  assertEquals(columns(ctx, 'entry'), [])
  assertEquals(marker(ctx), LATEST)
})

// An app's store one pass behind: two calls whose arguments the build before
// kept as text, one of them text that is not JSON. Both come back as values,
// kept as binary JSON: the object, and the string the text was.
Deno.test("a call's arguments become the object they spell", async () => {
  let ctx = state()
  let r = await newer(ctx, 'ada/cookbook').door('/apply', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify([
      { entity: { eid: ONE }, call: { args: {} } },
      { entity: { eid: TWO }, call: { args: {} } },
    ]),
  }, APP)
  assert(r.ok, await r.text())
  let sql = ctx.storage.sql
  for (let [eid, text] of [[ONE, '{"name":"sweep"}'], [TWO, '{']]) {
    sql.exec(
      'update call set args = ? where entity = (select id from entity ' +
        'where eid = ?)',
      text,
      eid,
    )
  }
  sql.exec(
    "insert into yak_kv (k, v) values ('migrated', ?) " +
      'on conflict(k) do update set v = excluded.v',
    ENTERED,
  )
  let calls = await newer(ctx, 'ada/cookbook').query('.call', APP)
  let args = new Map(
    calls.map((c) => [c.entity.eid, (c.call as { args: unknown }).args]),
  )
  assertEquals([args.get(ONE), args.get(TWO)], [{ name: 'sweep' }, '{'])
  assertEquals(
    sql.exec('select distinct typeof(args) as t from call').toArray(),
    [{ t: 'blob' }],
  )
  assertEquals(marker(ctx), LATEST)
})

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
  await toolsOld(ctx, ['add_chore'])
  // A link to a tool is the one shape the pass refuses.
  let sql = ctx.storage.sql
  sql.exec("insert into entity (eid) values ('link')")
  sql.exec(
    'insert into edge (entity, "from", "to") select l.id, t.entity, t.entity' +
      " from entity l, tool t where l.eid = 'link'",
  )
  let now = newer(ctx, 'ada/cookbook')
  await refused(now, 'links touch a tool')
  await client.flush(1000)
  assertEquals(seen.length, 1)
  assertEquals(seen[0].tags, {
    request: 'migration',
    store: 'ada/cookbook',
    mark: TOOLED,
  })
  assertEquals(marker(ctx), FILED)
})
