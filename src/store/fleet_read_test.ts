// Fleet composition around @yaks/sqlite.read(): these assertions pin the APP
// wire, not another invocation of the package reader. eager() deliberately
// remains the independent, keyed projection used by write-side helpers.
import { assert, assertEquals, assertStrictEquals } from '@std/assert'
import { slow } from '../testing.ts'
import { link } from '../edge.ts'
import type { Change } from '../types.ts'

Deno.env.set('DB_PATH', ':memory:')
let {
  apply,
  cursorOf,
  eager,
  epochOf,
  entriesOf,
  fleetVocabOf,
  matching,
  plantVocab,
  rowsOf,
  snapshot,
} = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { addSource } = await import('../source.ts')
let { evalGraph } = await import('../graph_query.ts')
let { parseQuery } = await import('../query.ts')
let { where } = await import('../sql.ts')
let { toSql } = await import('../relation.ts')
let uid = () => crypto.randomUUID()

Deno.test('fleet read: explicit wire columns, stored stamps, refs and body layouts', () => {
  let db = bareDb(), eid = uid(), peer = uid()
  apply(db, [
    { eid: peer, name: 'project', comp: {} },
    { eid, name: 'doc', comp: { title: 'read fixture', body: 'CAS text' } },
    { eid, name: 'task', comp: {} },
    { eid, name: 'filed', comp: { project: peer, priority: 1 } },
    { eid, name: 'accept', comp: { body: 'inline acceptance' } },
    { eid, name: 'repo', comp: { path: '/fixture', push: false } },
  ])
  // Gathering must not synthesize an absent updated facet from created.at.
  assertEquals(rowsOf(db, [eid])[0].comps.updated, undefined)
  // Stored stamps travel on the wire, not a computed query-only projection.
  db.prepare(
    "insert or replace into updated(entity,at) values ((select id from entity where eid=?),'2000-01-01T00:00:00.000Z')",
  )
    .run(eid)
  let expected = eager(db, eid)
  let [got] = rowsOf(db, [eid, eid, 'missing'])
  assertEquals(got, { eid, comps: expected })
  assertEquals(Object.keys(got.comps), Object.keys(expected))
  assertEquals(got.comps.task, { eid })
  assertEquals(got.comps.updated.at, '2000-01-01T00:00:00.000Z')
  assertEquals(got.comps.doc.body, 'CAS text')
  assertEquals(got.comps.accept.body, 'inline acceptance')
  assertStrictEquals(got.comps.repo.push, false)
  assertEquals(got.comps.filed.project, peer)
  for (let comp of Object.values(got.comps)) assertEquals(comp.eid, eid)
  assertEquals(matching(db, toSql(where(db, parseQuery('.priority=1'))!)), [
    got,
  ])
  // This remains end-to-end: fleet routing, package membership/gather, app wire.
  let result = evalGraph(db, '.priority=1')
  assert(JSON.stringify(result).includes('CAS text'))
})

Deno.test('fleet read: snapshot ordering, lazy/dead omission and derived home reads', () => {
  let db = bareDb()
  let home = 'ffffffff-0000-4000-8000-000000000001',
    persona = '00000000-0000-4000-8000-000000000001',
    session = uid(),
    entry = uid()
  let dead = uid()
  apply(db, [
    { eid: home, name: 'project', comp: {} },
    { eid: persona, name: 'persona', comp: { home } },
    { eid: home, name: 'doc', comp: { title: 'home', body: 'home body' } },
    {
      eid: persona,
      name: 'doc',
      comp: { title: 'persona', body: 'persona body' },
    },
    { eid: session, name: 'session', comp: { id: session } },
    { eid: entry, name: 'entry', comp: { session } },
    { eid: entry, name: 'content', comp: { body: 'lazy bytes' } },
    { eid: dead, name: 'task', comp: {} },
    ...link(home, 'requires', persona),
    ...link(entry, 'referenced', home),
  ])
  apply(db, [{ eid: dead, name: 'entity', comp: null }])
  let snap = snapshot(db)
  assertEquals(snap.cursor, cursorOf(db))
  assertEquals(snap.epoch, epochOf(db))
  assert(snap.vocabHash)
  assert(!snap.changes.some((c) => c.eid == entry || c.eid == dead))
  assert(!snap.deps.some((d) => d.parent == entry || d.child == entry))
  assertEquals(snap.deps.filter((d) => d.type == 'reads'), [
    { parent: home, type: 'reads', child: persona },
  ])
  for (let eid of [home, persona, session]) {
    let actual = Object.fromEntries(
      snap.changes.filter((c) => c.eid == eid).map((c) => [c.name, c.comp]),
    )
    assertEquals(actual, eager(db, eid))
  }
  let spines = snap.changes.filter((c) => c.name == 'entity').map((c) => c.eid)
  let stored = db.prepare(`select eid from entity where eid not in
    (select o.eid from entry t join entity o on o.id=t.entity)
    and id not in (select entity from tombstone) order by id`).all<
    { eid: string }
  >()
  assertEquals(spines, stored.map((r) => r.eid))
  for (let name of new Set(snap.changes.map((c) => c.name))) {
    if (name == 'entity') continue
    let eids = snap.changes.filter((c) => c.name == name).map((c) => c.eid)
    assertEquals(eids, [...eids].sort())
  }
  assertEquals(rowsOf(db, [dead]), [])
  assertStrictEquals(snapshot(db), snap) // even with a nonempty lazy partition
  assertEquals(entriesOf(db, session)[0].comps.content.body, 'lazy bytes')
  // A previously empty component must not stay pruned after a write.
  apply(db, [{ eid: home, name: 'favorite', comp: {} }])
  assert(rowsOf(db, [home])[0].comps.favorite)
  assert(snapshot(db) !== snap)
})

Deno.test('fleet read: handle vocabulary replacement invalidates shape and snapshot', () => {
  let db = bareDb(), eid = uid(), peer = uid()
  apply(db, [{ eid: peer, name: 'project', comp: {} }])
  let vocab = fleetVocabOf(db)
  let first = snapshot(db)
  plantVocab(db, {
    recipe: {
      body: 'body',
      ready: 'bool',
      target: { eid: 'entity', death: 'detach' },
    },
  })
  assert(fleetVocabOf(db) !== vocab)
  apply(db, [{
    eid,
    name: 'recipe',
    comp: { body: 'inline app body', ready: true, target: peer },
  }])
  assertEquals(rowsOf(db, [eid])[0].comps.recipe, {
    eid,
    body: 'inline app body',
    ready: true,
    target: peer,
  })
  let second = snapshot(db)
  assert(second !== first)
  assert(second.changes.some((c) => c.eid == eid && c.name == 'recipe'))
  // Existing table, additive column: cached projection must be replaced too.
  plantVocab(db, {
    recipe: {
      body: 'body',
      ready: 'bool',
      target: { eid: 'entity', death: 'detach' },
      label: 'text',
    },
  })
  assertEquals(rowsOf(db, [eid])[0].comps.recipe.label, null)
  assert(snapshot(db) !== second)
})

Deno.test('fleet read: sources receive the original filter and do not enter snapshots', () => {
  let db = bareDb(), eid = uid(), ghost = uid()
  apply(db, [{ eid, name: 'doc', comp: { title: 'persisted' } }])
  let filter = { sql: 'select eid from entity where eid=?', params: [eid] }
  let batch = (
    id: string,
  ): Change[] => [{ eid: id, name: 'doc', comp: { title: 'source' } }]
  let off = addSource({
    list: (got) => {
      assertStrictEquals(got, filter)
      return [batch(eid), batch(ghost), batch(ghost)]
    },
    resolve: (id) => id == ghost ? batch(ghost) : undefined,
  })
  try {
    let rows = matching(db, filter)
    assertEquals(rows.map((r) => r.eid), [eid, ghost])
    assertEquals(rows[0].comps.doc.title, 'persisted')
    assertEquals(rowsOf(db, [ghost])[0].comps.doc.title, 'source')
    assert(!snapshot(db).changes.some((c) => c.eid == ghost))
  } finally {
    off()
  }
})

slow(
  'fleet read: more than 4096 owners, duplicate ids and lazy seq paging',
  () => {
    let db = bareDb(), session = uid()
    apply(db, [{ eid: session, name: 'session', comp: { id: session } }])
    db.exec(
      `with recursive n(x) as (values(1) union all select x+1 from n where x<4101)
    insert into entity(eid,num) select printf('chunk-%05d',x),100000+x from n;
    insert into task(entity) select id from entity where eid like 'chunk-%';`,
    )
    let eids = Array.from(
      { length: 4101 },
      (_, i) => `chunk-${String(i + 1).padStart(5, '0')}`,
    )
    let got = rowsOf(db, [...eids.toReversed(), eids[0], 'missing'])
    assertEquals(
      got.map((r) => r.eid),
      eids,
    )
    assertEquals(got.map((r) => r.comps.task), eids.map((eid) => ({ eid })))
    // seq order deliberately differs from identity/arrival order.
    for (
      let [eid, seq] of [['z-entry', 2], ['a-entry', 7], [
        'm-entry',
        4,
      ]] as const
    ) {
      db.prepare('insert into entity(eid) values(?)').run(eid)
      db.prepare(`insert into entry(entity,session,seq) values
      ((select id from entity where eid=?),(select id from entity where eid=?),?)`)
        .run(eid, session, seq)
    }
    let page = entriesOf(db, session, 2, 2)
    assertEquals(page.map((r) => [r.eid, r.seq]), [['m-entry', 4], [
      'a-entry',
      7,
    ]])
    assertEquals(page.map((r) => r.comps.entity.num), [null, null])
    assertEquals(entriesOf(db, session, 7, 2), [])
  },
)

slow(
  'fleet read: snapshot cache observes unjournaled local and foreign writes',
  async () => {
    let { open, connect } = await import('./sqlite.ts')
    let dir = Deno.makeTempDirSync({ prefix: 'fleet-read-' })
    let a = open(`${dir}/graph.db`), b = connect(`${dir}/graph.db`)
    try {
      let eid = uid()
      apply(a, [{ eid, name: 'doc', comp: { title: 'initial' } }])
      let first = snapshot(a)
      assertStrictEquals(snapshot(a), first)
      let changeTitle = (db: typeof a, title: string) =>
        db.prepare(
          'update doc set title=? where entity=(select id from entity where eid=?)',
        )
          .run(title, eid)
      changeTitle(a, 'local')
      let second = snapshot(a)
      assert(second !== first)
      assertEquals(second.cursor, first.cursor)
      assertEquals(second.epoch, first.epoch)
      assertEquals(
        second.changes.find((c) => c.eid == eid && c.name == 'doc')?.comp
          ?.title,
        'local',
      )
      assertStrictEquals(snapshot(a), second)
      changeTitle(b, 'foreign')
      let third = snapshot(a)
      assert(third !== second)
      assertEquals(third.cursor, second.cursor)
      assertEquals(third.epoch, second.epoch)
      assertEquals(
        third.changes.find((c) => c.eid == eid && c.name == 'doc')?.comp?.title,
        'foreign',
      )
      assertStrictEquals(snapshot(a), third)
    } finally {
      b.close()
      a.close()
      Deno.removeSync(dir, { recursive: true })
    }
  },
)
