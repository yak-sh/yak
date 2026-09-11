import { assertEquals, assertNotEquals } from '@std/assert'
import { eidOf, tablesOf } from '@yaks/archetype'
import { sha256 } from '@yaks/graph'
import { backfill } from '@yaks/sqlite'
import { readDriver, textBlob } from '../db.ts'
import { bareDb } from '../testdb.ts'
import { flushArchetypes, watchArchetypes } from './fleet_archetype.ts'
import type { Sql } from './sql.ts'
import { DatabaseSync } from './sqlite.ts'

let driver = (db: Sql) => ({
  ...readDriver(db),
  exec: (sql: string) => db.exec(sql),
})

// Stage the physical writer before T-37057 turns it on in Fleet. This setup is
// also valid after rollout: no second identity implementation in the host.
let install = (db: Sql) => {
  if (
    !db.prepare('pragma table_info(entity)').all<{ name: string }>().some((r) =>
      r.name == 'archetype'
    )
  ) {
    db.exec(
      'alter table entity add column archetype integer references entity(id)',
    )
  }
  db.exec(`create table if not exists archetype (
    entity integer primary key references entity(id), tables text);
    create table if not exists retired (entity integer primary key references entity(id));`)
  backfill(driver(db), false)
  watchArchetypes(db, readDriver(db))
}
let texts = [
  '',
  'doc',
  'blob|blob_text',
  'archetype|',
  'archetype|blob,blob_text',
]
let verify = (db: Sql) => {
  for (let value of texts) {
    let row = db.prepare(`select e.eid, b.value, a.tables, d.eid descriptor
      from blob_text b join entity e on e.id = b.entity
      join archetype a on a.entity = e.archetype
      join entity d on d.id = a.entity where e.eid = ?`)
      .get<{ eid: string; value: string; tables: string; descriptor: string }>(
        sha256(value),
      )!
    assertEquals(row.value, value)
    assertEquals(tablesOf(row.tables), ['blob', 'blob_text'])
    assertEquals(row.descriptor, eidOf(['blob', 'blob_text']))
    assertNotEquals(row.eid, row.descriptor)
    assertEquals(
      db.prepare(
        'select * from archetype where entity = (select id from entity where eid = ?)',
      ).get(row.eid),
      undefined,
    )
  }
  assertEquals(
    db.prepare(`select a.tables, d.eid from entity e
    join archetype a on a.entity = e.archetype join entity d on d.id = a.entity
    where e.eid = 'empty-owner'`).get(),
    { tables: '[]', eid: eidOf([]) },
  )
}

for (let blobsFirst of [true, false]) {
  for (let boot of [true, false]) {
    Deno.test(`Fleet blob/archetype namespace: blobsFirst=${blobsFirst}, boot=${boot}`, () => {
      let db = bareDb()
      try {
        if (!boot) install(db)
        let batches = [
          () => {
            for (let text of texts) textBlob(db, text)
          },
          () => {
            db.prepare("insert into entity(eid) values ('empty-owner')").run()
          },
        ]
        for (let write of blobsFirst ? batches : batches.reverse()) {
          db.transaction(() => {
            write()
            if (!boot) flushArchetypes(db)
          })
        }
        if (boot) install(db)
        verify(db)
        db.transaction(() => flushArchetypes(db))
        assertEquals(backfill(driver(db), false), {
          entities: 0,
          archetypes: 0,
          retired: 0,
        })
        // Reopen the actual physical image, including trigger definitions.
        let reopened = new DatabaseSync(':memory:')
        reopened.deserialize(db.serialize())
        try {
          install(reopened)
          reopened.transaction(() => {
            textBlob(reopened, '')
            reopened.prepare("insert into entity(eid) values ('after-reopen')")
              .run()
            flushArchetypes(reopened)
          })
          verify(reopened)
          // The empty descriptor outlives its last owner; blob bytes are not
          // housed on that permanent entity, so neither lifecycle couples them.
          reopened.transaction(() => {
            reopened.exec(
              "delete from entity where eid in ('empty-owner', 'after-reopen')",
            )
            flushArchetypes(reopened)
          })
          assertEquals(
            reopened.prepare(`select a.tables from archetype a join entity e
            on e.id = a.entity where e.eid = ?`).get(eidOf([])),
            { tables: '[]' },
          )
          assertEquals(
            reopened.prepare('select value from blob_text where entity = ?')
              .get(textBlob(reopened, '')),
            { value: '' },
          )
        } finally {
          reopened.close()
        }
      } finally {
        db.close()
      }
    })
  }
}
