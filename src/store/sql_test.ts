// The store seam's contract, held against db.ts through a second handle: one
// that wraps the file adapter and answers `can` differently. A store without
// FTS5 still migrates, and its search door says so; an empty handle planted
// from schemaDdl() serves the wire like a migrated one.
Deno.env.set('DB_PATH', ':memory:')
import { assertEquals, assertThrows } from '@std/assert'
import { slow } from '../testing.ts'
import { type Can, present, type Sql, textPresent, WHITESPACE } from './sql.ts'
let { DatabaseSync } = await import('./sqlite.ts')
let { apply, migrate, plant, regraft, schemaDdl, search, snapshot } =
  await import(
    '../db.ts'
  )

// The WHITESPACE list is String.prototype.trim's, proven over the whole BMP
// (every Unicode space lives there); present() is that test as SQL, and the
// file adapter agrees with textPresent() on the values that used to need the
// text_present function.
slow('WHITESPACE is String.prototype.trim over the BMP', () => {
  let ws = new Set(WHITESPACE)
  let off: string[] = []
  for (let cp = 0; cp < 0x10000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if ((String.fromCodePoint(cp).trim() == '') != ws.has(cp)) {
      off.push(`U+${cp.toString(16)}`)
    }
  }
  assertEquals(off, [])
})

Deno.test('present() in SQL is textPresent() in JS', () => {
  let db = new DatabaseSync(':memory:')
  let ask = db.prepare(`select ${present('?')} as p`)
  for (let v of ['', ' \t\n', '\u00a0\ufeff\u3000', ' x ', '\u2028y', null]) {
    assertEquals(!!ask.get(v)?.p, textPresent(v), JSON.stringify(v))
  }
  db.close()
})

// The transaction door's contract: a nested run is a savepoint whose failure
// leaves the outer's writes; an outer failure leaves nothing and no open
// transaction; the version round-trips.
Deno.test('transaction(): nested failure rolls back alone, outer keeps', () => {
  let db = new DatabaseSync(':memory:')
  db.exec('create table t (n integer)')
  let rows = () => db.prepare('select n from t').all()
  db.transaction(() => {
    db.exec('insert into t values (1)')
    assertThrows(() =>
      db.transaction(() => {
        db.exec('insert into t values (2)')
        throw new Error('inner')
      })
    )
    assertEquals(db.inTransaction, true)
  }, true)
  assertEquals(rows(), [{ n: 1 }])
  assertThrows(() =>
    db.transaction(() => {
      db.exec('insert into t values (3)')
      throw new Error('outer')
    })
  )
  assertEquals(db.inTransaction, false)
  assertEquals(rows(), [{ n: 1 }])
  db.version = 7
  assertEquals(db.version, 7)
  db.close()
})

// A backend is whatever answers Sql: delegate to the adapter, own the `can`.
let backend = (can: Can): Sql => {
  let db = new DatabaseSync(':memory:')
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get inTransaction() {
      return db.inTransaction
    },
    get lastInsertRowId() {
      return db.lastInsertRowId
    },
    get isOpen() {
      return db.isOpen
    },
    get version() {
      return db.version
    },
    set version(v: number) {
      db.version = v
    },
    transaction: (fn, immediate) => db.transaction(fn, immediate),
    can,
    close: () => db.close(),
  }
}

let tables = (db: Sql) =>
  (db.prepare(
    `select name from sqlite_master where type = 'table' order by name`,
  ).all() as { name: string }[]).map((r) => r.name)

slow('a store without FTS5 migrates whole and its search says so', () => {
  let db = migrate(backend({ fts: false, temp: true }))
  assertEquals(tables(db).some((t) => t.startsWith('doc_fts')), false)
  assertEquals(tables(db).includes('task'), true)
  assertThrows(() => search(db, 'anything'), Error, 'FTS5')
  db.close()
})

// A store raised from an OLDER schema: `create … if not exists` leaves the
// definition it found, so a store planted before the mail envelope joined the
// index (T-32657) kept a two-column doc_fts under the current mail triggers,
// which write doc_fts.addr — and SQLite compiles a table's triggers with the
// statement that fires them, so EVERY delete stopped preparing (T-32826).
// regraft() drops each definition and raises the current one, then refills the
// mirrors it emptied.
slow('regraft() raises the definitions a graft cannot alter', () => {
  let ops = schemaDdl(new DatabaseSync(':memory:'))
  let db = plant(backend({ fts: true, temp: true }), ops)
  let [live, dead] = [crypto.randomUUID(), crypto.randomUUID()]
  apply(db, [
    { eid: live, name: 'doc', comp: { title: 'planted' } },
    { eid: dead, name: 'doc', comp: { title: 'passing' } },
  ])
  // The index as it stood before the envelope joined it, beside the mail
  // triggers of the current schema.
  db.exec(`
    drop trigger doc_fts_ai;
    drop trigger doc_fts_ad;
    drop trigger doc_fts_au;
    drop table doc_fts;
    create virtual table doc_fts using fts5(
      title, body, content='doc_value', content_rowid='rowid'
    );
    create trigger doc_fts_ad after delete on doc begin
      insert into doc_fts (doc_fts, rowid, title, body)
      values ('delete', old.rowid, old.title,
        (select value from blob_text where entity = old.body));
    end;
  `)
  assertThrows(() => apply(db, [{ eid: dead, name: 'entity', comp: null }]))
  regraft(db, ops)
  apply(db, [{ eid: dead, name: 'entity', comp: null }])
  // And the mirror the drop emptied answers for a doc written before it.
  assertEquals(search(db, 'planted').map((h) => h.eid), [live])
  db.close()
})

slow('plant() from schemaDdl() serves the wire without a migration', () => {
  let ops = schemaDdl(new DatabaseSync(':memory:'))
  let db = plant(backend({ fts: true, temp: true }), ops)
  let eid = crypto.randomUUID()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'planted' } },
    { eid, name: 'task', comp: { priority: 1 } },
  ])
  let doc = snapshot(db).changes.find((c) => c.eid == eid && c.name == 'doc')
  assertEquals((doc?.comp as { title?: string })?.title, 'planted')
  db.close()
})
