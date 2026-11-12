import { equal, test } from '@yaks/testing'
import { insert } from '@yaks/sql'
import { bounded } from './ceiling.ts'
import { storage } from './store.ts'
import { durable, shop } from './testing.ts'

// Workerd counts index writes too. Stock SQLite's changes() does not, so this
// boundary supplies that amplification while keeping the queries in process.
let metered = () => {
  let file = durable(), exec = file.sql.exec
  let rows = (q: string) => exec(q).toArray()
  let written = 0
  file.sql.exec = (q, ...bindings) => {
    let cursor = exec(q, ...bindings)
    let cost = 0
    let index = /^create (?:unique )?index .* on "?([\w]+)"?/i.exec(q)
    if (index) {
      cost = Number(rows(`select count(*) as n from "${index[1]}"`)[0].n)
    } else if (/^(insert|update|delete)\b/i.test(q)) {
      let target =
        /^(?:insert (?:or \w+ )?into|update|delete from) "?([\w]+)"?/i
          .exec(q)?.[1]
      let indexes = target
        ? rows(
          `select name from sqlite_schema where type='index' and tbl_name='${target}'`,
        ).length
        : 0
      cost = Number(rows('select changes() as n')[0].n) * (1 + indexes)
    }
    written += cost
    return { ...cursor, rowsRead: cursor.toArray().length, rowsWritten: cost }
  }
  return { file, written: () => written }
}

let f = metered()
let now = 1_000, failures: Error[] = []
bounded(f.file, {
  now: () => now,
  windows: [{ ms: 60_000, read: 50e6, written: 30_000 }],
  report: (e) => {
    failures.push(e)
  },
})
let initial = storage(f.file, shop, { deferred: false })
initial.install()
initial.raise(['doc', 'updated'])
for (let from = 1; from <= 12_000; from += 500) {
  f.file.beneath(
    insert(
      'entity',
      ...Array.from(
        { length: 500 },
        (_, i) => ({ id: from + i, eid: `old-${from + i}` }),
      ),
    ),
  )
  f.file.beneath(
    insert(
      'doc',
      ...Array.from(
        { length: 500 },
        (_, i) => ({ entity: from + i, title: `old-${from + i}` }),
      ),
    ),
  )
}
f.file.sql.exec('drop index entity_archetype_num')
f.file.sql.exec("delete from server_meta where k='schema'")
let before = f.written()
let opened = storage(f.file, shop, { deferred: true })
opened.install()
let openingWrites = f.written() - before

test('a populated object opens without spending its write window on classification or indexes, and reads while work is owed', () => {
  equal(openingWrites < 1000, true)
  let beforeRead = f.written()
  equal(opened.read('.doc.title=old-12000')[0].doc, { title: 'old-12000' })
  equal(opened.rows('.doc&.count')[0].n, 12_000)
  equal(f.written(), beforeRead)
  equal(failures, [])
})

test('classification and indexes resume after reopening and leave ordinary writes their window', async () => {
  let store = opened, windows = 0
  for (let pass = 0; pass < 100; pass++) {
    let wait = store.upkeep()
    if (wait == null) break
    if (wait) {
      now += wait
      windows++
    }
    if (pass == 5) {
      store = storage(f.file, shop, { deferred: true })
      store.install()
      await store.tx((tx) => {
        tx.patch([{ entity: { eid: 'new' }, doc: { title: 'new' } }])
        equal(tx.read('.doc.title=old-12000')[0].doc, { title: 'old-12000' })
      })
    }
  }
  equal(windows > 0, true)
  equal(failures, [])
  equal(
    f.file.sql.exec('select count(*) as n from entity where archetype is null')
      .toArray()[0].n,
    0,
  )
  equal(
    f.file.sql.exec(
      "select name from sqlite_schema where name='entity_archetype_num'",
    ).toArray().length,
    1,
  )
  equal(store.read('.doc.title=new')[0].doc, { title: 'new' })
})

let retired = durable()
let legacy = storage(retired, shop, { deferred: false })
legacy.install()
await legacy.tx((tx) =>
  tx.patch([{ entity: { eid: 'former' }, product: { price: 1 } }])
)
let descriptor = retired.sql.exec(
  "select e.eid, e.id from entity e join entity owner on owner.archetype=e.id where owner.eid='former'",
).toArray()[0]
let canonical = String(descriptor.eid)
// Legacy descriptors used the SHA of the joined table names as their eid.
let { sha256 } = await import('@yaks/graph/sha256')
retired.sql.exec(
  'update entity set eid=? where id=?',
  sha256('product'),
  Number(descriptor.id),
)
retired.sql.exec('drop table product')
retired.sql.exec("delete from server_meta where k='schema'")
let recovering = storage(retired, shop, { deferred: true })
recovering.install()

test('deferred classification preserves legacy descriptor identities and retires missing component sets', () => {
  for (
    let n = 0;
    n < 20 && recovering.upkeep() != null;
    n++
  ) { /* finish each unit */ }
  equal(
    retired.sql.exec('select eid from entity where id=?', Number(descriptor.id))
      .toArray()[0].eid,
    canonical,
  )
  equal(
    retired.sql.exec(
      'select entity from retired where entity=?',
      Number(descriptor.id),
    ).toArray().length,
    1,
  )
  equal(
    retired.sql.exec('select count(*) as n from entity where archetype is null')
      .toArray()[0].n,
    0,
  )
  equal(recovering.read('.entity.eid=former')[0].product, undefined)
})

let ordinary = durable()
let ordinaryStore = storage(ordinary, shop)
ordinaryStore.install()
ordinary.beneath(insert('entity', { id: 1, eid: 'legacy' }))
ordinary.sql.exec("delete from server_meta where k='schema'")
let reopenedOrdinary = storage(ordinary, shop)
reopenedOrdinary.install()

test('a host without a maintenance lifecycle completes its ordinary installation', () => {
  equal(
    ordinary.sql.exec(
      'select count(*) as n from entity where archetype is null',
    ).toArray()[0].n,
    0,
  )
  equal(
    ordinary.sql.exec(
      "select v from server_meta where k='archetype:pending' or k like 'owed:index:%'",
    ).toArray(),
    [],
  )
  equal(reopenedOrdinary.upkeep(), null)
})
