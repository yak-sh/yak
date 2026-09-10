// Ranked storage contracts over the fleet's real layout. The native KNN is
// injected; anchor hash validation and all package SQL/gathering are real.
import { applyNumbered } from './testdb.ts'
import { assert, assertEquals } from '@std/assert'
import { askOf, askRows, evalGraph, setRanker } from './graph_query.ts'
import { parseQuery } from './query.ts'
import { type Similarity, similarRows } from './ranked.ts'
import { hash, MODEL, stored, textOf } from './embed.ts'
import { eager, rowsOf, search, searchRead } from './db.ts'
import { bareDb } from './testdb.ts'
import { uuid } from './types.ts'

let fixture = () => {
  let db = bareDb()
  let ids = Array.from({ length: 5 }, uuid)
  applyNumbered(
    db,
    ids.flatMap((eid, i) => [
      {
        eid,
        name: 'doc',
        comp: { title: `rankproof ${i}`, body: `body ${i}` },
      },
      { eid, name: 'task', comp: {} },
      { eid, name: 'filed', comp: { domain: i == 2 ? 'Ops' : 'Eng' } },
    ]),
  )
  let text = textOf('rankproof 0', 'body 0')
  let vec = new Float32Array([1, 0, 0])
  db.prepare(`insert into embedding (entity, model, hash, vec)
    values ((select id from entity where eid = ?), ?, ?, ?)`)
    .run(ids[0], MODEL, hash(text), new Uint8Array(vec.buffer))
  let calls: { vec: Float32Array; count: number; floor: number }[] = []
  let embedded: string[] = []
  let provider: Similarity = {
    model: MODEL,
    stored,
    embed: (text) => {
      embedded.push(text)
      return Promise.resolve(null)
    },
    similar: (_db, vec, count = 8, floor = 0) => {
      calls.push({ vec, count, floor })
      return [0, 3, 1, 4, 2].slice(0, count)
        .map((i, pos) => ({ eid: ids[i], score: 1 - pos / 100 }))
    },
  }
  return { db, ids, vec, calls, embedded, provider }
}

Deno.test('ranked read: semantic owns order and self exclusion, storage owns hydration', async () => {
  let { db, ids, calls, embedded, provider, vec } = fixture()
  let got = await similarRows(
    db,
    parseQuery(`.near=${ids[0]} .order=similar`),
    4,
    provider,
  )
  assertEquals(got.map((r) => r.eid), [ids[3], ids[1], ids[4], ids[2]])
  assertEquals(calls, [{ vec, count: 5, floor: 0.78 }])
  assertEquals(embedded, [])
  assertEquals(got[0].comps.doc.body, 'body 3') // CAS decoded by package read
  assertEquals(got[0].comps.rank, {
    score: 0.99,
    open: ids[3],
    title: 'rankproof 3',
  })
  assertEquals(eager(db, ids[3]).rank, undefined)
  // A predicate still screens the bounded neighbourhood, after native rank but
  // before hydration. Storage ids differ from nums because CAS blobs mint ids.
  assertEquals(
    (await similarRows(
      db,
      parseQuery(
        `.near=${ids[0]} .order=similar .filed.domain=Ops`,
      ),
      4,
      provider,
    )).map((r) => r.eid),
    [ids[2]],
  )
})

Deno.test('ranked read: stale anchor is not reused; fresh text is a read-only vector view', async () => {
  let { db, ids, provider, calls, embedded } = fixture()
  applyNumbered(db, [{ eid: ids[0], name: 'doc', comp: { body: 'changed' } }])
  let asked = parseQuery(`.near=${ids[0]} .order=similar`)
  assertEquals(await similarRows(db, asked, 2, provider), [])
  assertEquals(embedded, ['rankproof 0\nchanged'])
  assertEquals(calls, [])
  let fresh = new Float32Array([0, 1, 0])
  provider.embed = () => Promise.resolve(fresh)
  let before = db.prepare('select total_changes() as n').get()!.n
  assertEquals((await similarRows(db, asked, 2, provider)).map((r) => r.eid), [
    ids[3],
    ids[1],
  ])
  assertEquals(calls[0].vec, fresh)
  assertEquals(db.prepare('select total_changes() as n').get()!.n, before)
  // No stored entity is necessary for arbitrary prose. It has no self to omit.
  assertEquals(
    (await similarRows(db, parseQuery('new prose .order=similar'), 2, provider))
      .map((r) => r.eid),
    [ids[0], ids[3]],
  )
})

Deno.test('ranked read: actual semantic door pages by entity num, not owner or score', async () => {
  let { db, ids, provider } = fixture()
  setRanker((db, asked, limit) => similarRows(db, asked, limit, provider))
  let query = [`.near=${ids[0]}`, '.order=similar', '.limit=2']
  let first = await askRows(db, askOf(query))
  let next = await askRows(db, askOf([...query, `.after=${first[1].num}`]))
  assertEquals([...first, ...next].map((r) => r.eid), [
    ids[3],
    ids[1],
    ids[4],
    ids[2],
  ])
  assertEquals(
    await askRows(db, askOf([...query, `.after=${next[1].num}`])),
    [],
  )
})

Deno.test('ranked FTS: cursors cross the stable retirement boundary before hydration', () => {
  let { db, ids } = fixture()
  let project = uuid()
  applyNumbered(db, [
    { eid: project, name: 'project', comp: {} },
    { eid: project, name: 'archived', comp: {} },
    { eid: ids[0], name: 'filed', comp: { project } },
  ])
  let all = evalGraph(db, 'rankproof .limit=20').hits
  assertEquals(all.length, 5)
  assertEquals(all.at(-1)!.eid, ids[0])
  assertEquals(all.at(-1)!.comps.rank.retired, true)
  let collected = [], after: number | undefined
  for (let i = 0; i < 4; i++) {
    let q = `rankproof .limit=2${after ? ` .after=${after}` : ''}`
    let page = evalGraph(db, q).hits
    collected.push(...page)
    if (!page.length) break
    after = page.at(-1)!.num
  }
  assertEquals(collected.map((r) => r.eid), all.map((r) => r.eid))
  let read = searchRead(db, 'rankproof', 2, all[1].num)
  assertEquals(read.hits.map((h) => h.eid), all.slice(2, 4).map((r) => r.eid))
  assertEquals(read.byEid.size, 2) // only the page, not every matching doc
  assertEquals(
    evalGraph(db, 'rankproof .after=999999 .limit=2').hits.map((r) => r.eid),
    all.slice(0, 2).map((r) => r.eid),
  )
})

Deno.test('ranked FTS: doc wins over content; comments carry target title and snippets', () => {
  let { db, ids } = fixture()
  let comment = uuid(), session = uuid()
  applyNumbered(db, [
    { eid: session, name: 'session', comp: { id: uuid() } },
    { eid: ids[1], name: 'entry', comp: { session, seq: 1 } },
    {
      eid: ids[1],
      name: 'content',
      comp: { body: 'rankproof transcript version' },
    },
    {
      eid: comment,
      name: 'doc',
      comp: { title: '', body: 'rankproof comment' },
    },
    { eid: comment, name: 'comment', comp: { target: ids[2] } },
  ])
  let hits = search(db, 'rankproof')
  let h = hits.find((h) => h.eid == comment)!
  assertEquals(h.open, ids[2])
  assertEquals(h.title, 'rankproof 2')
  assert(h.snip.includes('\x01rankproof\x02'))
  let duplicate = hits.filter((h) => h.eid == ids[1])
  assertEquals(duplicate.length, 1)
  assertEquals(duplicate[0].title_hit, '\x01rankproof\x02 1')
  assertEquals(duplicate[0].snip, 'body 1')
  assert(rowsOf(db, hits.map((h) => h.eid)).every((r) => !r.comps.rank))
})

let { slow } = await import('./testing.ts')
slow(
  'ranked native: indexed KNN screens ineligible hits through the package door',
  async () => {
    let { vectorDb } = await import('./testdb.ts')
    let { axes } = await import('./testvec.ts')
    let { refreshVector } = await import('./vector.ts')
    let db = vectorDb()
    let [anchor, live, unsafe, spoke] = Array.from({ length: 4 }, uuid)
    let vec = axes(1, 0)
    applyNumbered(
      db,
      [anchor, live, unsafe, spoke].map((eid) => ({
        eid,
        name: 'doc',
        comp: { title: 'nativeproof', body: '' },
      })),
    )
    for (let eid of [anchor, live, unsafe, spoke]) {
      db.prepare(`insert into embedding (entity, model, hash, vec)
      values ((select id from entity where eid = ?), ?, ?, ?)`)
        .run(eid, MODEL, hash('nativeproof'), new Uint8Array(vec.buffer))
    }
    refreshVector(db)
    applyNumbered(db, [
      { eid: unsafe, name: 'quarantined', comp: {} },
      { eid: spoke, name: 'comment', comp: { target: anchor } },
    ])
    let got = await similarRows(
      db,
      parseQuery(`.near=${anchor} .order=similar`),
    )
    assertEquals(got.map((r) => r.eid), [live])
    assert(Number(got[0].comps.rank.score) > 0.99)
  },
)
