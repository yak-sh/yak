// The authoritative query pipeline over the LAZY entry partition: snapshot()
// omits entries, but evalGraph reaches them whenever a query NAMES the partition
// — the fix for graph_query answering `.entry.session=X` with [] while the graph
// held hundreds (S-16837/S-16889). Held here: a named scope returns the ordered
// seq partition, paging walks it, and an empty result means the scope is empty,
// never that the optimization dropped it. The index/matcher equivalence over
// entries lives in sql_test.ts; this proves the door on top of it.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'
import { evalGraph } from './graph_query.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, open } = await import('./db.ts')
let { append } = await import('./entries.ts')
let { freshDb } = await import('./testdb.ts')

let session = (db: ReturnType<typeof open>) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: { id: uuid() } }])
  return eid
}

let seqs = (hits: { comps: Record<string, Record<string, unknown>> }[]) =>
  hits.map((h) => Number(h.comps.entry?.seq))

let world = () => {
  let db = freshDb()
  let a = session(db)
  let b = session(db) // stays empty — the genuinely-empty scope
  // Appended one at a time so a generation can point `through` the prior entry,
  // as a real runner threads them; seq is server-minted 1..4 within session a.
  let { eids: [e1] } = append(db, a, [
    { message: { role: 'user' }, content: { body: 'kick it off' } },
  ])
  append(db, a, [{
    generation: { provider: 'codex', model: 'gpt-5', through: e1 },
  }])
  append(db, a, [{ call: { key: 'c1' }, bash: { command: 'ls' } }])
  append(db, a, [{ response: { status: 500 }, content: { body: 'boom' } }])
  return { db, a, b }
}

Deno.test('a named session scope returns its ordered seq partition', () => {
  let { db, a } = world()
  let { hits } = evalGraph(db, `.entry.session=${a}`)
  assertEquals(hits.length, 4)
  assertEquals(seqs(hits), [1, 2, 3, 4]) // seq order, not entity-table order
  assertEquals(hits.every((h) => h.comps.entry?.session == a), true)
  db.close()
})

Deno.test('the human id resolves at the query boundary', () => {
  let { db, a } = world()
  let num = (db.prepare('select num from entity where eid = ?').get(a) as {
    num: number
  }).num
  let { hits } = evalGraph(db, `.entry.session=S-${num}`)
  assertEquals(hits.length, 4)
  db.close()
})

Deno.test('paging walks the partition by seq (after) and bounds it (limit)', () => {
  let { db, a } = world()
  assertEquals(
    seqs(
      evalGraph(db, `.entry.session=${a}`, undefined, {
        after: 2,
      }).hits,
    ),
    [3, 4],
  )
  assertEquals(
    seqs(
      evalGraph(db, `.entry.session=${a}`, undefined, {
        limit: 2,
      }).hits,
    ),
    [1, 2],
  )
  assertEquals(
    seqs(
      evalGraph(db, `.entry.session=${a}`, undefined, {
        after: 1,
        limit: 2,
      }).hits,
    ),
    [2, 3],
  )
  db.close()
})

Deno.test('a facet predicate reaches entries across the partition', () => {
  let { db } = world()
  // .generation.provider is a lazy facet, so the query names the partition and
  // the index answers it — the entry carrying the generation comes back.
  let gen = evalGraph(db, '.generation.provider=codex').hits
  assertEquals(gen.length, 1)
  assertEquals(gen[0].comps.entry?.seq, 2)
  // .response.status>=400 likewise, a numeric facet column.
  let bad = evalGraph(db, '.response.status>=400').hits
  assertEquals(bad.length, 1)
  assertEquals(bad[0].comps.entry?.seq, 4)
  db.close()
})

Deno.test('a body substring on a NON-doc body still answers over the partition', () => {
  let { db, a } = world()
  // sql.ts declines .content.body~= (it only narrows doc.body), so this is the
  // JS fallback — which must include the entry universe, not snapshot's omission.
  let hits = evalGraph(db, `.entry.session=${a}&.content.body~=boom`).hits
  assertEquals(hits.length, 1)
  assertEquals(hits[0].comps.entry?.seq, 4)
  db.close()
})

Deno.test('an empty result means the scope is empty, never a dropped partition', () => {
  let { db, a, b } = world()
  assertEquals(evalGraph(db, `.entry.session=${b}`).hits, []) // real, empty
  assertEquals(evalGraph(db, `.entry.session=${uuid()}`).hits, []) // absent
  assertEquals(evalGraph(db, `.entry.session=${a}`).hits.length, 4) // never []
  db.close()
})

Deno.test('an unscoped eager query never drags the lazy partition in', () => {
  let { db } = world()
  // No lazy facet named → entries stay out (the partition is opt-in). The two
  // sessions are the only eager entities the empty query returns.
  let hits = evalGraph(db, '').hits
  assertEquals(hits.some((h) => h.comps.entry), false)
  assertEquals(hits.filter((h) => h.comps.session).length, 2)
  db.close()
})
