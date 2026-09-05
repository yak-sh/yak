// ONE query door: the /query route, the CLI's local arm, and the Cloudflare
// worker's store all answer a filter line through askOf → askRows → layered.
// They were three copies of that pipeline, and a copy drifts: the per-id
// hydration fix landed in the route (0d4d4b4a), had to be made again in the
// local arm hours later (2f0b8ed7), and never reached the worker at all.
//
// Held here: the segment vocabulary parses one way whichever door reads it, the
// client's own serializer round-trips through that parse, and every arm the
// doors share answers from the shared function. The route and the worker are
// adapters over these — segments in, JSON out — so what they can still differ
// about is serialization, which their own tests cover.
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { link } from './edge.ts'
import { uuid } from './types.ts'
import { askOf, askRows, layered, localQuery } from './graph_query.ts'
import { queryArgs } from './client.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')

// A graph with one task pointing at another and a quarantined one — enough for
// every rider the doors carry. Built ONCE: these tests only read, and freshDb +
// apply is production cost paid per call, which is the difference between a
// file that runs in milliseconds and one that runs in seconds.
let a = uuid(), b = uuid(), hidden = uuid(), bodied = uuid()
let db = freshDb()
apply(db, [
  // A body is stored as a content-addressed blob ENTITY (db.ts textBlob), so
  // writing one plants a store row in the same spine every filter selects from.
  { eid: bodied, name: 'doc', comp: { title: 'gamma', body: 'flour' } },
  { eid: a, name: 'doc', comp: { title: 'alpha' } },
  { eid: a, name: 'task', comp: { priority: 1 } },
  { eid: b, name: 'doc', comp: { title: 'beta' } },
  { eid: b, name: 'task', comp: { priority: 2 } },
  ...link(a, 'requires', b),
  { eid: hidden, name: 'doc', comp: { title: 'buried treasure' } },
  { eid: hidden, name: 'task', comp: {} },
  { eid: hidden, name: 'quarantined', comp: {} },
])

let ids = (rows: { eid: string }[]) => rows.map((r) => r.eid).sort()

Deno.test('askOf: one segment vocabulary, riders lifted off the filter line', () => {
  let ask = askOf([
    'id=T-1,T-2',
    'backlinks=1',
    'deps=1',
    'quarantined=1',
    'after=7',
    'limit=3',
    'recursive=1',
    '.status=open',
    '.priority=1',
  ])
  assertEquals(ask.ids, ['T-1', 'T-2'])
  assertEquals(ask.filters, ['.status=open', '.priority=1'])
  assertEquals(ask.after, 7)
  assertEquals(ask.limit, 3)
  assertEquals([ask.reveal, ask.backlinks, ask.deps, ask.recursive], [
    true,
    true,
    true,
    true,
  ])
  // Absent riders are absent, never a filter — an empty line selects nothing,
  // so a stray `limit=` landing in `filters` would change what a query means.
  let bare = askOf(['.status=open'])
  assertEquals(bare.ids, [])
  assertEquals(bare.filters, ['.status=open'])
  assertEquals([bare.reveal, bare.backlinks, bare.deps], [false, false, false])
})

Deno.test('askOf: the work lane states its refusals once, for every door', () => {
  assertThrows(
    () => askOf(['work=sideways']),
    Error,
    'unknown work lane: sideways',
  )
  assertThrows(
    () => askOf(['work=build', 'id=T-1']),
    Error,
    'do not accept id=',
  )
  assertThrows(
    () => askOf(['work=build', 'quarantined=1']),
    Error,
    'do not reveal quarantined',
  )
  assertThrows(
    () => askOf(['work=build', 'deps=1']),
    Error,
    'backlinks or edge riders',
  )
})

Deno.test('the client serializer round-trips through the door parse', () => {
  // queryArgs is what httpQuery puts on the wire and what localQuery hands
  // askOf, so the local arm reads the exact segment line it would have sent.
  let ask = askOf(queryArgs(['.status=open', 'id=T-3'], {
    after: 4,
    limit: 9,
    recursive: true,
  }))
  assertEquals(ask.ids, ['T-3'])
  assertEquals(ask.filters, ['.status=open'])
  assertEquals([ask.after, ask.limit, ask.recursive], [4, 9, true])
})

Deno.test('askRows: every arm both doors share, one answer', async () => {
  // A plain filter goes to evalGraph.
  assertEquals(
    ids(await askRows(db, askOf(['.task!', '.priority=1']))),
    [a].sort(),
  )
  // `id=` FETCHES by address, and a remaining filter only SCREENS.
  assertEquals(ids(await askRows(db, askOf([`id=${a},${b}`]))), [a, b].sort())
  assertEquals(
    ids(await askRows(db, askOf([`id=${a},${b}`, '.priority=2']))),
    [b],
  )
  // An id naming nothing is simply absent.
  assertEquals(await askRows(db, askOf(['id=T-999999'])), [])
  // Quarantine screens both paths, and `quarantined=1` reveals — the rider the
  // local arm never had, so an armed CLI answered a revealed query differently.
  assertEquals(await askRows(db, askOf([`id=${hidden}`])), [])
  assertEquals(
    ids(await askRows(db, askOf([`id=${hidden}`, 'quarantined=1']))),
    [hidden],
  )
  // The id path comes back in num order, so a door cannot hand back a set whose
  // order depends on which address the caller happened to name first.
  assertEquals(
    (await askRows(db, askOf([`id=${b},${a}`]))).map((r) => r.num),
    (await askRows(db, askOf([`id=${a},${b}`]))).map((r) => r.num),
  )
})

// A doc's body lands as a blob entity, so the store's own content-addressed
// rows share the spine with the graph a filter asks about. They wear no doc
// and render as nothing — a page listing showed `undefined` for each of them
// (C-32498 item 4) — so a filter answers with one only when it NAMES `.blob`.
Deno.test("askRows: a filter answers the graph, not the store's blob rows", async () => {
  let rows = async (q: string) => ids(await askRows(db, askOf(q.split('&'))))
  let blobs = await rows('.blob!')
  let none = async (q: string) =>
    (await rows(q)).filter((e) => blobs.includes(e))
  // The case that found it: an empty needle is a PRESENCE test, not a contains
  // that every string — and every absent column — satisfies.
  assertEquals(await rows('.doc.title~=gamma'), [bodied])
  assertEquals(await none('.doc.title~='), [])
  // Every entity carries a created stamp; the blob rows still stay out.
  assertEquals(await none('.created.at!'), [])
  // Naming the component is how a caller asks for them, and the flour body's
  // blob is one of the rows that answers.
  assertEquals(blobs.length > 0, true)
  // Addressed by name, a blob is still itself: `id=` selects, it does not list.
  assertEquals(ids(await askRows(db, askOf([`id=${blobs[0]}`]))), [blobs[0]])
})

Deno.test('askRows: a similarity order is refused, not answered some other way', async () => {
  // No ranker is registered in a bare process (the app plane registers the
  // embedding one at boot), so the door declines rather than quietly returning
  // an unranked set — the same words evalGraph uses.
  await assertRejects(
    () => askRows(db, askOf([`.near=${a}`, '.order=similar'])),
    Error,
    'embedding query evaluator',
  )
})

Deno.test('localQuery answers through the shared door', async () => {
  let q = localQuery(db)
  assertEquals(ids(await q([`id=${a},${b}`])), [a, b].sort())
  assertEquals(ids(await q(['.task!', '.priority=2'])), [b])
  assertEquals(await q([`id=${hidden}`]), [])
  // The Querier's opts reach the same riders the URL spells.
  assertEquals((await q(['.task!'], { limit: 1 })).length, 1)
})

Deno.test('layered: deps and backlinks ride the same hits', async () => {
  let plain = layered(
    db,
    await askRows(db, askOf([`id=${a}`])),
    askOf([`id=${a}`]),
  )
  assertEquals('deps' in (plain[0] as object), false)
  assertEquals('backlinks' in (plain[0] as object), false)

  let ask = askOf([`id=${a}`, 'deps=1'])
  let withDeps = layered(db, await askRows(db, ask), ask) as {
    deps: { type: string; child: string }[]
  }[]
  assertEquals(withDeps[0].deps.map((d) => [d.type, d.child]), [[
    'requires',
    b,
  ]])

  // A backlink names who points here, with the title along — a backlink is
  // READ, not chased. Screened to the edge's own verb: an edge is an entity
  // additively now (T-23826), so it also references its endpoint through
  // `edge.to`, and this holds the verb rather than the census.
  let back = askOf([`id=${b}`, 'backlinks=1'])
  let linked = layered(db, await askRows(db, back), back) as {
    backlinks: { via: string; title: string }[]
  }[]
  assertEquals(
    linked[0].backlinks.filter((l) => l.via == 'requires')
      .map((l) => [l.via, l.title]),
    [['requires', 'alpha']],
  )
})
