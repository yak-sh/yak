import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { Database } from '@yaks/sqlite/db'
import { MigrationPending, migrations } from '@yaks/sqlite'
import { agent } from './run.ts'
import { driver, open } from './store.ts'

Deno.test('daemon stop releases its migration monitor before a shared harness is reused', async () => {
  using time = new FakeTime()
  const h = open(':memory:')
  const read = h.migrations.read
  let reads = 0
  h.migrations.read = () => {
    reads++
    // Detect the lifetime violation without passing a freed pointer to FFI.
    if (!h.db.open) throw new Error('monitor read a closed database')
    return read()
  }
  const a = agent({ h })
  let b: ReturnType<typeof agent> | undefined
  try {
    time.tick(1000)
    assertEquals(reads, 1)
    await a.d.stop()
    time.tick(1000)
    assertEquals(reads, 1)
    // Daemon-only shutdown deliberately leaves the connection open for the
    // replacement host (pool_test's durable-queue restart contract).
    assertEquals(h.db.open, true)
    b = agent({ h })
    time.tick(1000)
    assertEquals(reads, 2)
    await b.close()
    time.tick(10_000)
    assertEquals(reads, 2)
  } finally {
    await a.close()
    await b?.close()
  }
})

Deno.test('pending migration refuses harness startup before installing domain tables', () => {
  const dir = Deno.makeTempDirSync()
  const path = dir + '/test.db'
  const db = new Database(path)
  try {
    const control = migrations(driver(db))
    control.announce('new-schema', 0)
    assertThrows(() => open(path), MigrationPending)
    assertEquals(
      db.prepare("select name from sqlite_master where name='entity'").all(),
      [],
    )
  } finally {
    db.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('migration observation stops admission but drains current model before database close', async () => {
  const dir = Deno.makeTempDirSync()
  const path = dir + '/test.db'
  const h = open(path)
  const peer = new Database(path)
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let closed = false
  const close = h.close
  h.close = () => {
    closed = true
    close()
  }
  const a = agent({
    h,
    migrationPollMs: 1,
    model: async () => {
      started.resolve()
      await release.promise
      return {
        id: 'done',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'finished' }],
      }
    },
  })
  try {
    const id = await a.start('work')
    await started.promise
    const control = migrations(driver(peer))
    control.announce('encoding-change', 0)
    // Wait on the observable admission condition, not on an assumed sleep.
    let observed = false
    for (let i = 0; i < 100; i++) {
      try {
        await a.sessions()
      } catch (error) {
        if (!(error instanceof MigrationPending)) throw error
        observed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    assertEquals(observed, true)
    assertEquals(closed, false)
    await assertRejects(() => a.send(id, 'must not admit'), MigrationPending)
    release.resolve()
    await a.close()
    assertEquals(closed, true)
    const sql = driver(peer)
    assertEquals(
      Number(sql.query('select count(*) as n from entry', [])[0].n) > 0,
      true,
    )
  } finally {
    release.resolve()
    await a.close()
    peer.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
