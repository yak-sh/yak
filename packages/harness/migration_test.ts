import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { Database } from '@yaks/sqlite/db'
import { MigrationPending, migrations } from '@yaks/sqlite'
import { agent } from './run.ts'
import { driver, open } from './store.ts'

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
