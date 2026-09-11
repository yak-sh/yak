import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { Database } from './db.ts'
import { type Driver } from './driver.ts'
import { MigrationPending, migrations, watchMigrations } from './migration.ts'

function fixture() {
  const path = Deno.makeTempFileSync()
  const databases: Database[] = []
  const connect = () => {
    const db = new Database(path)
    databases.push(db)
    const driver: Driver = {
      exec: (sql) => db.exec(sql),
      query: (sql, params) => {
        const statement = db.prepare(sql)
        try {
          return statement.all(...params)
        } finally {
          statement.finalize()
        }
      },
    }
    return { db: driver, control: migrations(driver) }
  }
  return {
    connect,
    close: () => {
      for (const db of databases) db.close()
      Deno.removeSync(path)
    },
  }
}
Deno.test('committed announcement is visible, blocks startup and competitors, monitor latches once', () => {
  const f = fixture()
  try {
    const a = f.connect(), b = f.connect()
    const notices: Error[] = []
    const watch = watchMigrations(b.control, (reason) => notices.push(reason))
    try {
      watch.check()
      assertEquals(notices.length, 0)
      const claim = a.control.announce('add-widget', 0)
      assertEquals(b.control.read()?.migration, 'add-widget')
      assertEquals(claim.announced > 1700000000000, true)
      assertThrows(() => b.control.ready(), MigrationPending)
      assertThrows(() => b.control.announce('rival', 0), MigrationPending)
      watch.check()
      assertEquals(notices.length, 1)
      a.control.apply(
        claim,
        (db) => db.exec('create table widget (value text)'),
      )
      watch.check()
      assertEquals(notices.length, 1)
      assertEquals(b.control.read()?.state, 'applied')
      assertEquals(f.connect().control.ready(), claim.generation)
    } finally {
      watch.stop()
    }
  } finally {
    f.close()
  }
})
Deno.test('migration failure rolls back data/DDL and leaves explicit recoverable failure', () => {
  const f = fixture()
  try {
    const a = f.connect(), b = f.connect()
    const claim = a.control.announce('broken', 0)
    assertThrows(() =>
      a.control.apply(claim, (db) => {
        db.exec('create table unfinished (x)')
        throw new Error('broken callback')
      })
    )
    assertEquals(
      b.db.query("select name from sqlite_master where name='unfinished'", []),
      [],
    )
    assertEquals(b.control.read()?.state, 'failed')
    assertThrows(() => b.control.ready(), MigrationPending)
    assertThrows(() => b.control.acknowledge(claim.generation + 1))
    b.control.acknowledge(claim.generation)
    assertEquals(b.control.ready(), claim.generation)
  } finally {
    f.close()
  }
})
Deno.test('missed pending notification still detects applied data-only migration; unchanged polls are quiet', () => {
  const f = fixture()
  try {
    const a = f.connect(), b = f.connect()
    a.db.exec("create table value (body); insert into value values ('old')")
    const errors: Error[] = []
    const watch = watchMigrations(b.control, (e) => errors.push(e))
    try {
      for (let i = 0; i < 5; i++) watch.check()
      assertEquals(errors.length, 0)
      const c = a.control.announce('encoding', 0)
      a.control.apply(c, (db) => db.exec("update value set body='new'"))
      watch.check()
      assertEquals(errors.length, 1)
      assertEquals(b.db.query('select body from value', []), [{ body: 'new' }])
    } finally {
      watch.stop()
    }
  } finally {
    f.close()
  }
})
Deno.test('run waits announced grace outside transaction; early application is refused without clearing claim', async () => {
  const f = fixture()
  try {
    const a = f.connect(), b = f.connect()
    const claim = a.control.announce('later', 60000)
    assertThrows(() => a.control.apply(claim, () => {}), Error, 'grace')
    assertEquals(b.control.read()?.state, 'pending')
    a.control.fail(claim, 'operator cancelled')
    a.control.acknowledge(claim.generation)
    let polled = false
    const watch = watchMigrations(b.control, () => {
      polled = true
    }, 1)
    try {
      const result = await a.control.run('next', () => {
        assertEquals(polled, true)
        const current = a.control.read()!
        assertEquals(Date.now() >= current.notBefore, true)
      }, { intervalMs: 10, marginMs: 5 })
      assertEquals(result.state, 'applied')
    } finally {
      watch.stop()
    }
    await assertRejects(() => a.control.run('bad', () => {}, { intervalMs: 0 }))
  } finally {
    f.close()
  }
})
