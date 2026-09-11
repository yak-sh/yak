import { assert, assertEquals, assertThrows } from '@std/assert'
import { eidOf, tablesOf } from '@yaks/archetype'
import { componentTables } from '@yaks/sqlite'
import {
  apply,
  cursorOf,
  delta,
  fleetGraphOf,
  migrateArchetypes,
  readComp,
  readDriver,
  settleArchetypes,
  snapshot,
  stamp,
  textBlob,
  touch,
} from '../db.ts'
import { evalAgg, evalGraph } from '../graph_query.ts'
import { parseQuery } from '../query.ts'
import { run, toSql } from '../relation.ts'
import { where } from '../sql.ts'
import { bareDb } from '../testdb.ts'
import type { Sql } from './sql.ts'
import { open } from './sqlite.ts'
import { pendingSql } from './fleet_archetype.ts'

let quote = (s: string) => `"${s.replaceAll('"', '""')}"`

Deno.test('archetype flush scans the queue, never the entity spine', () => {
  let db = bareDb()
  let plan = db.prepare(`explain query plan ${pendingSql}`)
    .all<{ detail: string }>().map((r) => r.detail)
  assert(plan.some((step) => /^SCAN p\b/.test(step)))
  assert(plan.some((step) => /^SEARCH e\b/.test(step)))
  assert(!plan.some((step) => /^SCAN e\b/.test(step)))
  db.close()
})

// T-37310: the reported collision now succeeds through Fleet's real writer.
for (let blobsFirst of [true, false]) {
  Deno.test(`empty-set/blob identities coexist, blobsFirst=${blobsFirst}`, () => {
    let db = bareDb()
    try {
      let writes = [
        () => {
          textBlob(db, '')
        },
        () => {
          db.prepare(
            "insert into entity(eid) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc')",
          ).run()
        },
      ]
      for (let write of blobsFirst ? writes : writes.reverse()) {
        db.transaction(() => {
          write()
          settleArchetypes(db)
        })
      }
      let empty = eidOf([])
      assertEquals(
        readComp(db, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'entity')!
          .archetype,
        empty,
      )
      let blob = textBlob(db, '')
      let blobEid = db.prepare('select eid from entity where id = ?')
        .get<{ eid: string }>(blob)!.eid
      assert(blobEid != empty)
      assertEquals(
        db.prepare('select value from blob_text where entity = ?')
          .get<{ value: string }>(blob)!.value,
        '',
      )
      assertEquals(readComp(db, blobEid, 'archetype'), undefined)
      apply(db, [{
        eid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'entity',
        comp: null,
      }])
      assertEquals(readComp(db, empty, 'archetype')!.tables, '[]')
      assertThrows(() =>
        apply(db, [{ eid: empty, name: 'entity', comp: null }])
      )
    } finally {
      db.close()
    }
  })
}

let parity = (db: Sql) => {
  let names = componentTables(readDriver(db))
  let owners = new Map(
    db.prepare('select id from entity').all<{ id: number }>()
      .map((r) => [r.id, [] as string[]]),
  )
  for (let name of names) {
    for (
      let row of db.prepare(`select entity from ${quote(name)}`).all<
        { entity: number }
      >()
    ) {
      owners.get(row.entity)!.push(name)
    }
  }
  for (
    let row of db.prepare(`select e.id, e.eid, a.tables, d.eid as descriptor
    from entity e left join archetype a on a.entity = e.archetype
    left join entity d on d.id = a.entity`).all<{
      id: number
      eid: string
      tables: string | null
      descriptor: string | null
    }>()
  ) {
    assert(row.tables != null, `unclassified ${row.eid}`)
    assertEquals(row.descriptor, eidOf(owners.get(row.id)!), row.eid)
    assertEquals(row.descriptor, eidOf(tablesOf(row.tables)), row.eid)
  }
}

Deno.test('fleet archetype plans share the execution snapshot; detached SQL stays live', () => {
  let dir = Deno.makeTempDirSync()
  let a = open(`${dir}/graph.db`)
  let b = open(`${dir}/graph.db`)
  try {
    let ps = parseQuery('.canvas!')
    let detached = where(a, ps)!
    assert(!toSql(detached).sql.includes('"entity"."archetype"'))
    let before = run(a, detached).length
    let eid = crypto.randomUUID()
    a.transaction(() => {
      let indexed = where(a, ps)!
      assert(toSql(indexed).sql.includes('"entity"."archetype"'))
      fleetGraphOf(b).apply([{ entity: { eid }, canvas: {}, favorite: {} }])
      assertEquals(run(a, indexed).length, before)
      assertEquals(run(a, detached).length, before)
    })
    assertEquals(run(a, detached).length, before + 1)
    a.transaction(() => {
      assertEquals(run(a, where(a, ps)!).length, before + 1)
    })
    parity(b)
  } finally {
    a.close()
    b.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('fleet archetypes cover physical blobs, births, moves, tombstones and recall', () => {
  let db = bareDb()
  let start = cursorOf(db)
  apply(
    db,
    [
      {
        eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'doc',
        comp: {
          title: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          body: 'physical bytes',
        },
      },
      { eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'task', comp: {} },
      { eid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'task', comp: {} },
    ],
  )
  parity(db)
  let first =
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype
  apply(db, [{
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'doc',
    comp: { title: 'edited' },
  }])
  parity(db)
  assert(
    first !=
      readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
    'updated is a physical move',
  )
  let next =
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype
  apply(db, [{
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'doc',
    comp: { title: 'again' },
  }])
  assertEquals(
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
    next,
  )
  touch(db, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
  parity(db)
  apply(db, [{
    eid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'entity',
    comp: null,
  }])
  parity(db)
  assertEquals(
    readComp(db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'entity')!.archetype,
    eidOf(['tombstone']),
  )
  let replay = delta(db, start).changes
  let death = replay.findLastIndex((c) =>
    c.eid == 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' && c.name == 'entity' &&
    c.comp == null
  )
  assert(death >= 0)
  assert(
    !replay.slice(death + 1).some((c) =>
      c.eid == 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ),
    'derived metadata must not resurrect a tombstone on replay',
  )
  assert(replay.some((c) => c.name == 'archetype'))
  let descriptorEids = new Set(
    replay.filter((c) => c.name == 'archetype').map((c) => c.eid),
  )
  assert(
    !replay.some((c) =>
      descriptorEids.has(c.eid) && ['created', 'updated'].includes(c.name)
    ),
  )
  assertEquals(
    db.prepare(`select count(*) n from archetype a
    join entity e on e.id = a.entity where e.num is not null`).get(),
    { n: 0 },
  )
  db.close()
})

Deno.test('archetype stamp echoes and rollback leave no poisoned IDs', () => {
  let db = bareDb()
  apply(db, [{
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'task',
    comp: {},
  }])
  let first =
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype
  assertThrows(
    () =>
      db.transaction(() => {
        stamp(db, () => {
          db.prepare(`insert into error(entity, message)
        select id, 'no' from entity where eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`)
            .run()
          return [{
            eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'error',
            comp: { message: 'no' },
          }]
        })
        parity(db)
        throw new Error('rollback')
      }),
    Error,
    'rollback',
  )
  assertEquals(
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
    first,
  )
  parity(db)
  let changes = stamp(db, () => {
    db.prepare(
      `insert into delivered(entity) select id from entity where eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`,
    ).run()
    return [{
      eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'delivered',
      comp: {},
    }]
  })
  assert(
    changes.some((c) =>
      c.eid == 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && c.name == 'entity' &&
      c.comp?.archetype
    ),
  )
  parity(db)
  db.close()
})

Deno.test('archetype identities are storage-owned and permanent', () => {
  let db = bareDb()
  let g = fleetGraphOf(db)
  g.apply([{
    entity: { eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', archetype: 'spoof' },
    task: {},
  }])
  parity(db)
  let id = String(
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
  )
  assertThrows(
    () => g.apply([{ entity: { eid: id }, tombstone: {} }]),
    Error,
    'permanent',
  )
  g.apply([{ entity: { eid: id }, archetype: { tables: '[]' } }])
  parity(db)
  db.close()
})

Deno.test('numbering an existing owner retains its archetype move in the journal', () => {
  let db = bareDb()
  let eid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  apply(db, [{ eid, name: 'task', comp: {} }])
  let cursor = cursorOf(db)
  let changes = apply(db, [{
    eid,
    name: 'doc',
    comp: { title: 'numbered' },
    $num: true,
  }])
  let entity = readComp(db, eid, 'entity')!
  assert(entity.num != null)
  for (let batch of [changes, delta(db, cursor).changes]) {
    let spine = batch.filter((c) => c.eid == eid && c.name == 'entity')
    assertEquals(spine.length, 1)
    assertEquals(spine[0].comp?.num, entity.num)
    assertEquals(spine[0].comp?.archetype, entity.archetype)
  }
  parity(db)
  db.close()
})

Deno.test('boot backfill is physical, idempotent, and retires missing tables', () => {
  let db = bareDb()
  db.exec(
    `create table unknown_facet(entity integer primary key references entity(id));
    insert into entity(eid) values ('foreign');
    insert into unknown_facet select id from entity where eid = 'foreign'`,
  )
  let first = db.transaction(() => migrateArchetypes(db))
  assert(first.entities > 0)
  parity(db)
  let descriptor = eidOf(['unknown_facet'])
  assertEquals(readComp(db, 'foreign', 'entity')!.archetype, descriptor)
  let again = db.transaction(() => migrateArchetypes(db))
  assertEquals([again.entities, again.archetypes, again.retired], [0, 0, 0])
  let cursor = cursorOf(db)
  db.exec('drop table unknown_facet')
  let dropped = db.transaction(() => migrateArchetypes(db))
  assertEquals(dropped.retired, 1)
  assert(readComp(db, descriptor, 'retired'))
  for (let eid of ['foreign', descriptor]) {
    assertEquals(
      delta(db, cursor).changes.find((c) => c.eid == eid && c.name == 'entity')
        ?.comp?.archetype,
      readComp(db, eid, 'entity')!.archetype,
    )
  }
  parity(db)
  let reopened = migrateArchetypes(db)
  assertEquals([reopened.entities, reopened.archetypes, reopened.retired], [
    0,
    0,
    0,
  ])
  db.close()
})

Deno.test('boot classifies populated new tables on previously assigned owners', () => {
  let db = bareDb()
  db.exec("insert into entity(eid) values ('grafted')")
  migrateArchetypes(db)
  let cursor = cursorOf(db)
  db.exec(
    `create table grafted_facet(entity integer primary key references entity(id));
    insert into grafted_facet select id from entity where eid = 'grafted'`,
  )
  migrateArchetypes(db)
  assertEquals(
    readComp(db, 'grafted', 'entity')!.archetype,
    eidOf(['grafted_facet']),
  )
  assertEquals(
    delta(db, cursor).changes.find((c) =>
      c.eid == 'grafted' && c.name == 'entity'
    )
      ?.comp?.archetype,
    eidOf(['grafted_facet']),
  )
  parity(db)
  let again = migrateArchetypes(db)
  assertEquals([again.entities, again.archetypes, again.retired], [0, 0, 0])
  db.close()
})

Deno.test('query/catalog and snapshot carry the current archetype, with raw-writer fallback', () => {
  let db = bareDb()
  apply(db, [{
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'task',
    comp: {},
  }])
  assertEquals(evalAgg(db, '.task! .count!')?.values.get(''), 1)
  db.prepare(
    `insert into completed(entity) select id from entity where eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`,
  ).run()
  // Out-of-band SQL makes the pointer NULL rather than retaining a stale set.
  assertEquals(
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
    null,
  )
  assertEquals(evalAgg(db, '.task! .completed! .count!')?.values.get(''), 1)
  db.transaction(() => settleArchetypes(db))
  parity(db)
  assert(evalGraph(db, '.task!'))
  let snap = snapshot(db)
  assertEquals(
    snap.changes.find((c) =>
      c.eid == 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && c.name == 'entity'
    )?.comp?.archetype,
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
  )
  // The keyed package gather uses the same entity metadata as the wire snapshot.
  let bundles = fleetGraphOf(db).read(
    '.entity.eid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  )
  assert(!(bundles instanceof Promise))
  assertEquals(
    bundles[0].entity.archetype,
    readComp(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'entity')!.archetype,
  )
  db.close()
})
