/// <reference lib="deno.ns" />
// The one pass, end to end (T-33809): an object is SEEDED through the store it
// replaces — store.ts's own doors, its own DDL out of src/store/schema.json, its
// own wire — and then woken as the Store on the packages, which finds the old
// rows and moves them.
//
// Nothing is stubbed between the two: the fixtures are written by the code that
// wrote the rows a deployed object is holding right now, and the assertions read
// the new store through its own `/query` door. What this proves is what the
// cutover deploy (T-33808) turns on.
//
// SLOW tier: every one of these plants the fleet's whole 328-op schema to have
// something to migrate, which is a third of a second an object — the cost of
// the thing under test, not of the setup around it.
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { blobSchema } from '@yaks/blob'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { edgeEid } from '@yaks/edge'
import { schema } from '@yaks/sqlite'
import { Store } from './graph.ts'
import {
  carry,
  keyOf,
  Refused as Unreconciled,
  type Report,
} from './migrate.ts'
import { Store as Legacy } from './store.ts'
import { appVocab, PLATFORM_STORE } from './vocab.ts'

// One object's whole state, kept across incarnations: its storage, the key-value
// slots the OLD store remembered everything in, and the socket list the runtime
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

// The bucket a pass exports to, as the slice migrate.ts asks for.
let bucket = () => {
  let held = new Map<string, string>()
  return {
    held,
    r2: {
      put: (k: string, v: string | ArrayBuffer | Uint8Array) =>
        Promise.resolve(
          void held.set(
            k,
            typeof v == 'string' ? v : new TextDecoder().decode(v as never),
          ),
        ),
    },
  }
}

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BEN = 'b0000000-0000-4000-8000-0000000000be'
let SPACE = 'c0000000-0000-4000-8000-0000000000c5'
let APP = 'd0000000-0000-4000-8000-0000000000ab'
let ONE = '10000000-0000-4000-8000-000000000001'
let TWO = '20000000-0000-4000-8000-000000000002'
let GONE = '30000000-0000-4000-8000-000000000003'

type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
}

// The old store, over one object's storage: its doors, its wire, its DDL.
let older = (ctx: State, name: string) => {
  let store = new Legacy(
    ctx as unknown as ConstructorParameters<typeof Legacy>[0],
    null,
  )
  let door = (path: string, init: RequestInit = {}) => {
    let req = new Request(`http://store${path}`, init)
    req.headers.set('x-store', name)
    req.headers.set('x-yak-kernel', '1')
    return store.fetch(req)
  }
  return {
    store,
    door,
    apply: async (changes: Change[]) => {
      let r = await door('/apply', {
        method: 'POST',
        body: JSON.stringify(changes),
      })
      if (!r.ok) throw new Error(`old store refused: ${await r.text()}`)
      return await r.json()
    },
    vocab: (manifest: unknown) =>
      door('/vocab', { method: 'POST', body: JSON.stringify(manifest) }),
  }
}

// The new store over the same object, driven through its own doors.
let newer = (ctx: State, name: string, bind: { EXPORTS?: unknown } = {}) => {
  let store = new Store(
    ctx as unknown as ConstructorParameters<typeof Store>[0],
    bind as never,
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

let count = (ctx: State, table: string): number =>
  Number(
    (ctx.storage.sql.exec(`select count(*) as n from "${table}"`)
      .toArray()[0] as { n: number }).n,
  )

let reportIn = (held: Map<string, string>): Report => {
  let key = [...held.keys()].find((k) => k.endsWith('/report.json'))
  assert(key, `no report among ${[...held.keys()]}`)
  return JSON.parse(held.get(key)!) as Report
}

let rowsIn = (held: Map<string, string>): Record<string, unknown[]> => {
  let key = [...held.keys()].find((k) => k.endsWith('/rows.jsonl'))
  assert(key, `no export among ${[...held.keys()]}`)
  let out: Record<string, unknown[]> = {}
  for (let line of held.get(key)!.trim().split('\n')) {
    let said = JSON.parse(line) as { kind: string; table?: string; rows?: [] }
    if (said.kind == 'rows') out[said.table!] = said.rows!
  }
  return out
}

// ---- an app's store --------------------------------------------------------

// Everything an app's store can be holding, written the old way: a person, a
// document with prose in the old blob backend, a task, a comment aimed at it,
// two edges (one under each spelling of the relation), a dead entity, and a
// component the app declared in its own vocab.json.
let seedApp = async (ctx: State) => {
  let old = older(ctx, 'ada/cookbook')
  await old.vocab({ recipe: { title: 'text', serves: 'number' } })
  await old.apply([
    { eid: ADA, name: 'person', comp: {} },
    { eid: ADA, name: 'doc', comp: { title: 'Ada' } },
    { eid: ONE, name: 'doc', comp: { title: 'Lemon cake', body: '3 lemons' } },
    { eid: ONE, name: 'task', comp: { priority: 2 } },
    { eid: ONE, name: 'recipe', comp: { title: 'Lemon cake', serves: 8 } },
    { eid: TWO, name: 'doc', comp: { title: 'Notes', body: 'nice' } },
    { eid: TWO, name: 'comment', comp: { target: ONE } },
    { eid: GONE, name: 'doc', comp: { title: 'Scratch' } },
  ])
  // Two edges, said the way the fleet says one: the entity is the sentence's
  // own address, and the tag is the nature — `references` in the present tense,
  // which is the one word this pass renames.
  let requires = edgeEid(TWO, 'requires', ONE)
  let refs = edgeEid(TWO, 'references', ADA)
  await old.apply([
    { eid: requires, name: 'edge', comp: { from: TWO, to: ONE } },
    { eid: requires, name: 'requires', comp: {} },
    { eid: refs, name: 'edge', comp: { from: TWO, to: ADA } },
    { eid: refs, name: 'references', comp: {} },
  ])
  await old.apply([{ eid: GONE, name: 'entity', comp: null }])
  return { requires, refs }
}

slow('an app store carries every row across, and reconciles', async () => {
  let ctx = state()
  let said = await seedApp(ctx)
  let files = bucket()

  let now = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })
  let docs = await now.query(`.doc.title=Lemon cake&.doc?`, APP)

  let report = reportIn(files.held)
  assert(report.ok, report.message)
  assertEquals(report.store, 'ada/cookbook')
  assertEquals(docs.length, 1)

  // The prose came across the blob move: the column holds the address now, and
  // the read inflates it, so a page asking for the body gets the body.
  assertEquals((docs[0].doc as { title: string }).title, 'Lemon cake')
  assertEquals((docs[0].doc as { body: string }).body, '3 lemons')

  // And the search index holds the PROSE, not the address (T-33978): the blob
  // row is written before the row that addresses it, so the trigger that fills
  // the index resolves a body the same way a read does.
  let found = await now.query('lemons', APP)
  assertEquals(found.length, 1)
  assertEquals(found[0].entity.eid, ONE)

  // The app's OWN word, planted from the vocab.json the old object remembered.
  let cakes = await now.query('.recipe.serves=8', APP)
  assertEquals(cakes.length, 1)
  assertEquals((cakes[0].recipe as { title: string }).title, 'Lemon cake')

  // The task, the comment and the person.
  assertEquals((await now.query('.task!', APP)).length, 1)
  assertEquals((await now.query('.comment.target=' + ONE, APP)).length, 1)
  assertEquals((await now.query('.person!', APP)).length, 1)

  // The edge said under the old spelling wears the new tag AND the address that
  // spelling derives; the one whose word never moved kept its own.
  let kept = await now.query('.requires!&.edge?', APP)
  assertEquals(kept.length, 1)
  assertEquals(kept[0].entity.eid, said.requires)
  let moved = await now.query('.referenced!&.edge?', APP)
  assertEquals(moved.length, 1)
  assertEquals(moved[0].entity.eid, edgeEid(TWO, 'referenced', ADA))
  assert(moved[0].entity.eid != said.refs, 'the address moved with the word')

  // The dead stay dead, and the spine did not move at all.
  let counts = Object.fromEntries(report.moved.map((m) => [m.table, m]))
  assertEquals(counts.tombstone.from, 1)
  assertEquals(counts.tombstone.to, 1)
  assertEquals(counts.entity.from, counts.entity.to)
  for (let m of report.moved) {
    if (m.table == 'grant' || m.table == 'blob_text') continue
    assertEquals(m.from, m.to, `${m.table}: ${m.from} → ${m.to}`)
  }

  // The fleet's other words are named with their counts, and their rows are in
  // the export and nowhere else — including the journal, which no store on the
  // packages has a table for.
  let rows = rowsIn(files.held)
  assert(rows.journal_tx.length > 0, 'the journal is archived')
  assert(rows.doc.length > 0, 'the old doc rows are archived')
})

slow('the second boot is a no-op', async () => {
  let ctx = state()
  await seedApp(ctx)
  let files = bucket()
  let first = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })
  assertEquals((await first.query('.doc!', APP)).length, 3)
  let after = [...files.held.keys()].length

  // A fresh incarnation over the same storage: the marker is written, the
  // journal is gone, so nothing runs and nothing is exported a second time.
  let again = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })
  assertEquals((await again.query('.doc!', APP)).length, 3)
  assertEquals([...files.held.keys()].length, after)

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
  assertEquals((await again.query('.doc!', APP)).length, 4)
})

// ---- the directory ---------------------------------------------------------

slow('the directory keeps its three seats', async () => {
  let ctx = state()
  let old = older(ctx, PLATFORM_STORE)
  await old.apply([
    { eid: SPACE, name: 'space', comp: { slug: 'ada' } },
    { eid: SPACE, name: 'doc', comp: { title: 'Ada' } },
    { eid: ADA, name: 'person', comp: {} },
    { eid: BEN, name: 'person', comp: {} },
    { eid: APP, name: 'app', comp: { slug: 'cookbook', space: SPACE } },
    {
      eid: ONE,
      name: 'member',
      comp: { space: SPACE, person: ADA, role: 'owner' },
    },
    {
      eid: TWO,
      name: 'member',
      comp: { space: SPACE, person: BEN, role: 'editor' },
    },
  ])
  let files = bucket()
  let now = newer(ctx, PLATFORM_STORE, { EXPORTS: files.r2 })

  // Three seats, unsplit: the platform's own `member` declares them, so an
  // editor is still an editor and no grant is minted.
  let seats = await now.query('.member!')
  let report = reportIn(files.held)
  assert(report.ok, report.message)
  assertEquals(seats.length, 2)
  assertEquals(
    seats.map((s) => (s.member as { role: string }).role).sort(),
    ['editor', 'owner'],
  )
  assertEquals(report.moved.find((m) => m.table == 'grant'), undefined)
  assertEquals((await now.query('.space.slug=ada')).length, 1)
  assertEquals((await now.query('.app.slug=cookbook')).length, 1)
})

slow('an app store splits the seat from the level', async () => {
  let ctx = state()
  let old = older(ctx, 'ada/cookbook')
  await old.apply([
    { eid: ADA, name: 'person', comp: {} },
    { eid: BEN, name: 'person', comp: {} },
    { eid: SPACE, name: 'space', comp: { slug: 'ada' } },
    {
      eid: ONE,
      name: 'member',
      comp: { space: SPACE, person: ADA, role: 'owner' },
    },
    {
      eid: TWO,
      name: 'member',
      comp: { space: SPACE, person: BEN, role: 'editor' },
    },
  ])
  let files = bucket()
  let now = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })
  // The app is named on the request, which is what a grant is ON.
  let seats = await now.query('.member!', APP)
  assertEquals(seats.length, 2)
  assertEquals(
    seats.map((s) => (s.member as { role: string }).role).sort(),
    ['member', 'owner'],
  )
  let grants = await now.query('.grant!', APP)
  assertEquals(grants.length, 1)
  assertEquals((grants[0].grant as { access: string }).access, 'editor')
  assertEquals((grants[0].grant as { person: string }).person, BEN)
  assertEquals((grants[0].grant as { app: string }).app, APP)
  let report = reportIn(files.held)
  assert(report.ok, report.message)
  assertEquals(report.moved.find((m) => m.table == 'grant')?.to, 1)
})

// ---- the refusals ----------------------------------------------------------

slow('no bucket, no migration', async () => {
  let ctx = state()
  await seedApp(ctx)
  let now = newer(ctx, 'ada/cookbook')
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  assertEquals(write.status, 503)
  assert((await write.text()).includes('EXPORTS'))

  // A read is refused in the same words, and the rows are untouched: the pass
  // did not start, so the old tables are standing exactly as they were.
  let read = await now.door('/query?q=.doc!', {}, APP)
  assertEquals(read.status, 503)
  assertEquals(read.headers.get('x-yak-migration'), 'refused')
  assertEquals(count(ctx, 'doc'), 3)
  assertEquals(count(ctx, 'journal_tx') > 0, true)

  // The meter still reads: how much an object weighs is a question about its
  // storage, not about its graph, and an object in this state still has one.
  let weighed = await now.door('/graph', {}, APP)
  assertEquals(weighed.status, 200)
  assertEquals(
    (await weighed.json() as { migration: string }).migration,
    'refused',
  )
})

slow('a re-addressing that collides rolls the whole pass back', async () => {
  let ctx = state()
  let old = older(ctx, 'ada/cookbook')
  let refs = edgeEid(TWO, 'references', ADA)
  // The address that edge takes under the relation's new spelling — already
  // spoken for here, so re-addressing it cannot land. This is the one condition
  // in a customer's own rows that can make the pass refuse.
  let taken = edgeEid(TWO, 'referenced', ADA)
  await old.apply([
    { eid: ADA, name: 'doc', comp: { title: 'Ada' } },
    { eid: TWO, name: 'doc', comp: { title: 'Notes' } },
    { eid: taken, name: 'doc', comp: { title: 'in the way' } },
    { eid: refs, name: 'edge', comp: { from: TWO, to: ADA } },
    { eid: refs, name: 'references', comp: {} },
  ])
  let files = bucket()
  let now = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })

  // The rows are exactly what they were: the pass ran in one transaction and it
  // unwound. The object says so rather than serving half a graph.
  let read = await now.door('/query?q=.doc!', {}, APP)
  assertEquals(read.status, 503)
  assertEquals(count(ctx, 'doc'), 3)
  assertEquals(count(ctx, 'references'), 1)
  let report = reportIn(files.held)
  assertEquals(report.ok, false)
  assert(/unique/i.test(report.message ?? ''), report.message)
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  assertEquals(write.status, 503)
  assert((await write.text()).includes('rows.jsonl'))
  assertEquals(rowsIn(files.held).references.length, 1)
})

slow('counts that do not reconcile refuse the pass', async () => {
  let ctx = state()
  await seedApp(ctx)
  // The rule itself, at its own seam. It guards the CODE, not the data — a copy
  // that quietly loses or gains a row — so `plant` stands in for one that went
  // wrong: the schema is raised the way the object raises it, and then one row
  // too many lands in a table the pass is about to fill.
  let vocab = appVocab({ recipe: { title: 'text', serves: 'number' } })
  let before = count(ctx, 'doc')
  let raised: unknown = null
  try {
    ctx.storage.transactionSync(() =>
      carry(ctx.storage, {
        store: 'ada/cookbook',
        app: APP,
        vocab,
        plant: () => {
          for (let stmt of [...schema(vocab), ...blobSchema()]) {
            ctx.storage.sql.exec(stmt)
          }
          ctx.storage.sql.exec(
            'insert into person (entity) select id from entity ' +
              'where id not in (select entity from yak_old_person) limit 1',
          )
        },
        grantEid: (app, person) => `${app}:${person}`,
        export: 'store/probe/rows.jsonl',
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
  let files = bucket()
  let now = newer(ctx, 'ada/cookbook', { EXPORTS: files.r2 })
  let write = await now.door('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: BEN }, person: {} }]),
  }, APP)
  assertEquals(write.status, 503)
  let report = reportIn(files.held)
  assertEquals(report.ok, false)
  assert(/address a body/.test(report.message ?? ''), report.message)
  assertEquals(count(ctx, 'doc'), 3)
})

Deno.test('the export key names the object and the moment', () => {
  let key = keyOf('ada/cookbook', '2026-09-05T10:11:12.000Z')
  assertEquals(key, 'store/ada/cookbook/2026-09-05T10-11-12.000Z')
})

// ---- the definitions, when the schema moves under them ---------------------

Deno.test('a schema that moves re-cuts its definitions and refills', async () => {
  // No old rows here: this is a store already on the packages, whose SCHEMA
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
  // as it is STORED, which for a body is its address. A document written under
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
    body: JSON.stringify({ recipe: { serves: 'number' } }),
  }, APP)
  assertEquals(grew.status, 200)
  assertEquals((await now.query('limes', APP)).length, 1)
  assertEquals((await now.query('lemons', APP)).length, 1)
})
