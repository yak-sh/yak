// The authoritative query pipeline over the LAZY entry partition: snapshot()
// omits entries, but evalGraph reaches them whenever a query NAMES the partition
// — the fix for graph_query answering `.entry.session=X` with [] while the graph
// held hundreds (S-16837/S-16889). Held here: a named scope returns the ordered
// seq partition, paging walks it, and an empty result means the scope is empty,
// never that the optimization dropped it. The index/matcher equivalence over
// entries lives in sql_test.ts; this proves the door on top of it.
import { assertEquals, assertThrows } from '@std/assert'
import { kindOf, uuid } from './types.ts'
import { edgeEid, link } from './edge.ts'
import {
  evalAgg,
  evalCapped as evalCappedDoor,
  evalGraph,
  evalQuery,
  evalSub as evalSubDoor,
} from './graph_query.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, eager, entriesOf, entriesScan, matching } = await import('./db.ts')
let { open } = await import('./store/sqlite.ts')
let { append } = await import('./entries.ts')
let { bareDb, freshDb } = await import('./testdb.ts')

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

Deno.test('verifier facets round-trip, query, and preserve their base kinds', () => {
  let db = bareDb()
  let verifier = uuid(), muted = uuid()
  apply(db, [
    { eid: verifier, name: 'session', comp: { id: uuid() } },
    { eid: verifier, name: 'verifier', comp: {} },
    { eid: muted, name: 'project', comp: {} },
    { eid: muted, name: 'noverify', comp: {} },
  ])

  assertEquals(eager(db, verifier).verifier, { eid: verifier })
  assertEquals(eager(db, muted).noverify, { eid: muted })
  assertEquals(kindOf(eager(db, verifier)), 'session')
  assertEquals(kindOf(eager(db, muted)), 'project')
  assertEquals(evalGraph(db, '.verifier!').hits.map((h) => h.eid), [verifier])
  assertEquals(evalGraph(db, '.noverify!').hits.map((h) => h.eid), [muted])

  apply(db, [
    { eid: verifier, name: 'verifier', comp: null },
    { eid: muted, name: 'noverify', comp: null },
  ])
  assertEquals(eager(db, verifier).verifier, undefined)
  assertEquals(eager(db, muted).noverify, undefined)
  assertEquals(evalGraph(db, '.verifier!').hits, [])
  assertEquals(evalGraph(db, '.noverify!').hits, [])
  db.close()
})

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

Deno.test('lazy subscription selects its keyed bounded universe before hydration', () => {
  let db = freshDb()
  let a = session(db)
  let { eids: [through] } = append(db, a, [{
    message: { role: 'user' },
    content: { body: 'ordinary anchor' },
  }])
  append(
    db,
    a,
    Array.from({ length: 619 }, (_, i) => ({
      message: { role: i % 2 ? 'agent' : 'user' },
      content: { body: i % 7 || i == 0 ? `ordinary ${i}` : `needle ${i}` },
      ...(i == 0
        ? {
          content: { body: 'needle generation response' },
          generation: { through, provider: 'codex', model: 'bounded' },
        }
        : {}),
      ...(i == 0 ? { response: { status: 503 } } : {}),
    })),
  )

  let eagerEnumerations = 0
  let keyedReads: { session: string; after: number; limit: number }[] = []
  let doors = {
    matching: (...args: Parameters<typeof matching>) => {
      eagerEnumerations++
      return matching(...args)
    },
    entriesOf: (...args: Parameters<typeof entriesOf>) => {
      keyedReads.push({ session: args[1], after: args[2]!, limit: args[3]! })
      return entriesOf(...args)
    },
    entriesScan,
  }

  // This is the evaluator's universe-selection seam, not a query-string spy:
  // every positive lazy facet takes it. The eager/source-list statement door
  // must remain unopened, while entriesOf receives the exact page bound.
  let direct = evalQuery(db, `.entry.session=${a}`, 0, 500, doors)
  assertEquals(eagerEnumerations, 0)
  assertEquals(keyedReads, [{ session: a, after: 0, limit: 500 }])
  assertEquals(seqs(direct.hits), Array.from({ length: 500 }, (_, i) => i + 1))

  keyedReads.length = 0
  let next = evalQuery(db, `.entry.session=${a}`, 500, 500, doors)
  assertEquals(keyedReads, [{ session: a, after: 500, limit: 500 }])
  assertEquals(seqs(next.hits), Array.from({ length: 120 }, (_, i) => i + 501))

  // Subscription initialization uses that same evaluator and returns the page
  // in partition order, independent of the 120 older rows behind the bound.
  let initial = evalSubDoor(db, `.entry.session=${a}`).hits
  assertEquals(initial.length, 500)
  assertEquals(seqs(initial), Array.from({ length: 500 }, (_, i) => i + 1))

  // Remaining predicates refine the bounded candidates. These cover the
  // JS-only content.body substring fallback and compiled generation/response
  // facets together; no predicate gets a parallel unbounded universe.
  let refined = evalGraph(
    db,
    `.entry.session=${a}&.content.body~=needle&.generation.provider=codex&.response.status>=500`,
  ).hits
  assertEquals(
    refined.every((h) =>
      Number(h.comps.entry?.seq) <= 500 &&
      String(h.comps.content?.body).includes('needle') &&
      h.comps.generation?.provider == 'codex' &&
      Number(h.comps.response?.status) >= 500
    ),
    true,
  )
  assertEquals(refined.length > 0, true)
  db.close()
})

Deno.test('entry paging refuses the duplicate-producing multi-session order', () => {
  let db = freshDb()
  let a = session(db), b = session(db)
  append(
    db,
    a,
    Array.from({ length: 3 }, (_, i) => ({ content: { body: `a ${i}` } })),
  )
  append(
    db,
    b,
    Array.from({ length: 3 }, (_, i) => ({ content: { body: `b ${i}` } })),
  )

  // The old first page was A1,A2,A3,B1; `after=1` then repeated A2,A3.
  assertThrows(
    () => evalGraph(db, `.entry.session=${a},${b}`, { limit: 4 }),
    Error,
    'query each Session separately',
  )
  db.close()
})

Deno.test('entry paging refuses before one Session spends the page budget', () => {
  let db = freshDb()
  let a = session(db), b = session(db)
  append(
    db,
    a,
    Array.from({ length: 501 }, (_, i) => ({ content: { body: `a ${i}` } })),
  )
  append(db, b, [{ content: { body: 'b 0' } }])
  let reads = 0
  let doors = {
    matching,
    entriesOf: (...args: Parameters<typeof entriesOf>) => {
      reads++
      return entriesOf(...args)
    },
    entriesScan: (...args: Parameters<typeof entriesScan>) => {
      reads++
      return entriesScan(...args)
    },
  }

  assertThrows(
    () => evalQuery(db, `.entry.session=${a},${b}`, 0, 500, doors),
    Error,
    'query each Session separately',
  )
  assertEquals(reads, 0)
  db.close()
})

Deno.test('entry session ranges use one bounded scan and cannot take a seq cursor', () => {
  let db = freshDb()
  let a = session(db), b = session(db)
  append(db, a, [{ content: { body: 'a' } }])
  append(db, b, [{ content: { body: 'b' } }])
  let keyed = 0, scans: { after: number; limit: number }[] = []
  let doors = {
    matching,
    entriesOf: (...args: Parameters<typeof entriesOf>) => {
      keyed++
      return entriesOf(...args)
    },
    entriesScan: (...args: Parameters<typeof entriesScan>) => {
      scans.push({ after: args[1]!, limit: args[2]! })
      return entriesScan(...args)
    },
  }
  let [lo, hi] = [a, b].sort()

  evalQuery(db, `.entry.session=${lo}..${hi}`, 0, 500, doors)
  assertEquals(keyed, 0)
  assertEquals(scans, [{ after: 0, limit: 500 }])
  assertThrows(
    () => evalQuery(db, `.entry.session=${lo}..${hi}`, 1, 500, doors),
    Error,
    'requires one scalar .entry.session=',
  )
  db.close()
})

Deno.test('an unscoped lazy universe remains explicitly capped', () => {
  let db = freshDb()
  let a = session(db), b = session(db)
  append(
    db,
    a,
    Array.from({ length: 350 }, (_, i) => ({
      content: { body: `a ${i}` },
    })),
  )
  append(
    db,
    b,
    Array.from({ length: 350 }, (_, i) => ({
      content: { body: `b ${i}` },
    })),
  )
  let hits = evalGraph(db, '.content!').hits
  assertEquals(hits.length, 500)
  assertEquals(seqs(hits).every((seq) => seq > 0), true)
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

Deno.test('accept.body filters tasks through the ordinary query door', () => {
  let db = freshDb()
  let matching = uuid(), other = uuid()
  for (
    let [eid, body] of [[matching, 'the command exits zero'], [
      other,
      'manual check',
    ]]
  ) {
    apply(db, [
      { eid, name: 'doc', comp: { title: eid } },
      { eid, name: 'task', comp: {} },
      { eid, name: 'accept', comp: { body } },
    ])
  }
  let hits = evalGraph(db, '.task!&.accept.body~=exits zero').hits
  assertEquals(hits.map((r) => r.eid), [matching])
  assertEquals(hits[0].comps.accept?.body, 'the command exits zero')
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

// An asked-for order survives a window, and the window pages inside it: the
// cursor names an ENTITY, and its place in the RANKING is where the next page
// starts. Before this, `.order=hot&.after=` cut down the spine instead — two
// pages of one ranking that neither joined up nor covered it.
Deno.test('a ranking window pages within the ranking, not down the spine', () => {
  let db = freshDb()
  for (let i = 0; i < 4; i++) {
    let eid = uuid()
    apply(db, [
      { eid, name: 'doc', comp: { title: `zephyr ${i}` } },
      { eid, name: 'task', comp: { priority: i } },
    ])
  }
  let hot = (win = '') =>
    evalGraph(db, `.title~=zephyr&.order=hot${win}`).hits.map((r) => r.eid)
  let all = evalGraph(db, '.title~=zephyr&.order=hot').hits
  assertEquals(all.length, 4)
  assertEquals(hot('&.limit=2'), all.slice(0, 2).map((r) => r.eid))
  assertEquals(
    hot(`&.limit=2&.after=${all[1].num}`),
    all.slice(2).map((r) => r.eid),
  )
  // an anchor no entity has is the first page again, never an empty one
  assertEquals(
    hot('&.limit=2&.after=999999'),
    all.slice(0, 2).map((r) => r.eid),
  )
  db.close()
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

// D-23820's spelling, answered by the ORDINARY dot-param grammar: an edge is an
// entity, so `.edge.to=X` is a plain reference filter and `.<nature>!` a plain
// presence one. No `.edges[...]`-style special case was needed for it — the
// vocabulary already carries the words. `.edges[...]` stays as the SUGAR that
// delivers triples beside a result set (T-23821 retires it).
Deno.test('an edge answers the plain grammar: .edge.to=X & .<nature>!', () => {
  let db = bareDb()
  let p = uuid(), c = uuid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'parent' } },
    { eid: c, name: 'doc', comp: { title: 'child' } },
    ...link(p, 'requires', c),
  ])
  let sentence = edgeEid(p, 'requires', c)
  let eids = (q: string) => evalGraph(db, q).hits.map((r) => r.eid)
  assertEquals(eids(`.edge.to=${c}`), [sentence])
  assertEquals(eids(`.edge.from=${p}`), [sentence])
  assertEquals(eids(`.edge.to=${c}&.requires!`), [sentence])
  // a consumer names the nature it knows; another's stays invisible
  assertEquals(eids(`.edge.to=${c}&.contains!`), [])
})
