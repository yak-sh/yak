// The authoritative query pipeline over the LAZY entry partition: snapshot()
// omits entries, but evalGraph reaches them whenever a query NAMES the partition
// — the fix for graph_query answering `.entry.session=X` with [] while the graph
// held hundreds (S-16837/S-16889). Held here: a named scope returns the ordered
// seq partition, paging walks it, and an empty result means the scope is empty,
// never that the optimization dropped it. The index/matcher equivalence over
// entries lives in sql_test.ts; this proves the door on top of it.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'
import {
  evalAgg,
  evalCapped as evalCappedDoor,
  evalGraph,
  evalSub as evalSubDoor,
} from './graph_query.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, eager, open } = await import('./db.ts')
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
      evalGraph(db, `.entry.session=${a}`, {
        after: 2,
      }).hits,
    ),
    [3, 4],
  )
  assertEquals(
    seqs(
      evalGraph(db, `.entry.session=${a}`, {
        limit: 2,
      }).hits,
    ),
    [1, 2],
  )
  assertEquals(
    seqs(
      evalGraph(db, `.entry.session=${a}`, {
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
  // sessions are the only eager entities a session query returns.
  let hits = evalGraph(db, '.session!').hits
  assertEquals(hits.some((h) => h.comps.entry), false)
  assertEquals(hits.filter((h) => h.comps.session).length, 2)
  // And the EMPTY query selects nothing — there is nothing to return until
  // the caller actually selects something.
  assertEquals(evalGraph(db, '').hits, [])
  db.close()
})

Deno.test('kind= selects an eager kind past a lazy comp in kindOrder (T-17354)', () => {
  let { db, a } = world()
  // kindPreds emits a synthetic `.entry absent` clause for every kindOrder
  // component earlier than the queried kind — so any kind past `entry` (comment,
  // wake, …) carried one. namesLazy must NOT read that absence as a lazy opt-in:
  // the bug flipped the query into entry-partition mode and orderedEntries then
  // dropped every row without an entry.seq, so kind=comment / kind=wake said [].
  let c = uuid()
  apply(db, [
    { eid: c, name: 'comment', comp: { target: a } },
    { eid: c, name: 'doc', comp: { title: '', body: 'a note' } },
  ])
  let w = uuid()
  apply(db, [{ eid: w, name: 'wake', comp: { at: '2099-01-01T00:00:00Z' } }])

  assertEquals(evalGraph(db, '.kind=comment').hits.map((h) => h.eid), [c])
  assertEquals(evalGraph(db, '.kind=wake').hits.map((h) => h.eid), [w])
  // A genuinely-lazy kind (a POSITIVE `entry` presence) still routes into the
  // partition — the guard narrows to absence assertions only.
  assertEquals(evalGraph(db, '.kind=entry').hits.length, 4)
  db.close()
})

Deno.test('evalAgg answers .distinct/.tally, filtered and null-for-membership', () => {
  let db = freshDb()
  let mk = (domain: string, status: string) => {
    let eid = uuid()
    apply(db, [
      { eid, name: 'task', comp: { domain } },
      { eid, name: 'doc', comp: { title: 't', body: '' } },
      // status is DERIVED (D-24102): the mark makes the derived value
      ...(status == 'done'
        ? [{ eid, name: 'completed', comp: {} }]
        : status == 'cancelled'
        ? [{ eid, name: 'cancelled', comp: {} }]
        : []),
    ])
  }
  mk('Ops', 'open')
  mk('Eng', 'open')
  mk('Ops', 'done')
  mk('', 'open') // an empty domain is not a domain — dropped like the census
  // the SQL path: distinct sorted, empties out; tally counts per value
  assertEquals([...evalAgg(db, '.distinct=domain')!.values.keys()].sort(), [
    'Eng',
    'Ops',
  ])
  assertEquals(evalAgg(db, '.tally=domain')!.values.get('Ops'), 2)
  // the other preds screen the universe the aggregate reduces
  assertEquals(evalAgg(db, '.tally=domain&.status=open')!.values.get('Ops'), 1)
  // `.count!` counts the SELECTION, under the empty key no tally can collide
  // with — one shape for every aggregate.
  let count = (q: string) => evalAgg(db, q)!.values.get('')
  assertEquals(count('.task.domain=Ops&.count!'), 2)
  assertEquals(count('.task.domain=Eng&.count!'), 1)
  assertEquals(count('.task.domain=Ops&.task.status=open&.count!'), 1)
  // A pred the compiler declines still counts EXACTLY, through the matcher.
  assertEquals(count('.task.domain=Ops&.title~=t&.count!'), 2)
  // no AGG projection → null, the door falls through to membership
  assertEquals(evalAgg(db, '.status=open'), null)
  db.close()
})

Deno.test('evalCapped answers a declining query newest-first, bounded', () => {
  let db = freshDb()
  // 'zap' is a bare-word text pred — the index declines it, whereSome scans.
  for (let i = 0; i < 6; i++) {
    apply(db, [{ eid: uuid(), name: 'doc', comp: { title: `zap ${i}` } }])
  }
  apply(db, [{ eid: uuid(), name: 'doc', comp: { title: 'unrelated' } }])
  let { hits } = evalCappedDoor(db, 'zap', 3)
  assertEquals(hits.length, 3)
  // The cap SELECTS the newest matches (a set — frame order is irrelevant).
  let titles = new Set(hits.map((h) => String(h.comps.doc?.title)))
  assertEquals(titles, new Set(['zap 5', 'zap 4', 'zap 3']))
})

Deno.test('text query returns ordinary rows with an ephemeral rank component', () => {
  let db = freshDb()
  let eid = uuid()
  apply(db, [{ eid, name: 'doc', comp: { title: 'xylophone', body: 'music' } }])
  let [hit] = evalGraph(db, 'xyloph*', { limit: 5 }).hits
  assertEquals(hit.eid, eid)
  assertEquals(hit.comps.doc?.title, 'xylophone')
  assertEquals(hit.comps.rank?.open, eid)
  assertEquals(String(hit.comps.rank?.title_hit).includes('\x01'), true)
  assertEquals(typeof hit.comps.rank?.score, 'number')
  // Query decoration is not a component a caller can write back. The ordinary
  // admission door drops it, and a later addressed read has no trace of it.
  apply(db, [{
    eid,
    name: 'rank',
    comp: { title: 'forged', open: 'elsewhere' },
  }])
  assertEquals(eager(db, eid).rank, undefined)
  assertEquals(
    db.prepare("select 1 from sqlite_schema where name = 'rank'").get(),
    undefined,
  )
  db.close()
})

Deno.test('search ordering is explicit query rank, recent first and retired last', () => {
  let db = freshDb()
  let live = uuid(),
    retired = uuid(),
    older = uuid(),
    newer = uuid(),
    sunk = uuid()
  apply(db, [
    { eid: live, name: 'project', comp: {} },
    { eid: live, name: 'doc', comp: { title: 'live', body: '' } },
    { eid: retired, name: 'project', comp: {} },
    { eid: retired, name: 'doc', comp: { title: 'retired', body: '' } },
    { eid: retired, name: 'archived', comp: {} },
    { eid: older, name: 'task', comp: { project: live } },
    { eid: older, name: 'doc', comp: { title: 'older', body: '' } },
    { eid: newer, name: 'task', comp: { project: live } },
    { eid: newer, name: 'doc', comp: { title: 'newer', body: '' } },
    { eid: sunk, name: 'task', comp: { project: retired } },
    { eid: sunk, name: 'doc', comp: { title: 'sunk', body: '' } },
  ])
  let at = (eid: string, value: string) =>
    db.prepare(
      'update created set at = ? where entity = (select id from entity where eid = ?)',
    ).run(value, eid)
  at(older, '2026-01-01T00:00:00Z')
  at(newer, '2026-02-01T00:00:00Z')
  at(sunk, '2026-03-01T00:00:00Z')
  let hits = evalGraph(db, '.task!&.order=search').hits
    .filter((r) => [older, newer, sunk].includes(r.eid))
  assertEquals(hits.map((r) => r.eid), [newer, older, sunk])
  assertEquals(hits.at(-1)?.comps.rank?.retired, true)
  assertEquals(hits.every((r) => typeof r.comps.rank?.score == 'number'), true)
  db.close()
})

Deno.test('text membership agrees across ranked queries and subscriptions', () => {
  let db = freshDb(), exact = uuid(), inside = uuid()
  apply(db, [
    { eid: exact, name: 'doc', comp: { title: 'widget alpha', body: '' } },
    { eid: inside, name: 'doc', comp: { title: 'midwidget beta', body: '' } },
  ])
  let ids = (q: string, sub = false) =>
    (sub ? evalSubDoor(db, q).hits : evalGraph(db, q).hits)
      .map((r) => r.eid).filter((eid) => eid == exact || eid == inside)
  assertEquals(ids('widget'), [exact])
  assertEquals(ids('widget', true), [exact])
  assertEquals(ids('idget'), [])
  assertEquals(ids('idget', true), [])
  assertEquals(ids('wid*'), [exact])
  assertEquals(ids('wid*', true), [exact])
  db.close()
})

Deno.test('evalSub: exact for narrowing and aggregate queries, capped otherwise', () => {
  let db = freshDb()
  for (let i = 0; i < 4; i++) {
    let eid = uuid()
    apply(db, [{ eid, name: 'doc', comp: { title: `t${i}` } }, {
      eid,
      name: 'task',
      comp: {},
    }])
  }
  // Narrowing: the index answers whole — every task, mine and freshDb's seed.
  let exact = evalSubDoor(db, '.task!').hits
  let mine = exact.filter((h) => /^t\d$/.test(String(h.comps.doc?.title)))
  assertEquals(mine.length, 4)
  // Aggregate: exact tally path, never capped (all opens counted).
  let agg = evalAgg(db, '.task!&.tally=task.status')
  assertEquals((agg?.values.get('open') ?? 0) >= 4, true)
})
