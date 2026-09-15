import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { slow, until } from './testing.ts'
import { drain, report } from './turn.ts'
import { watchVault } from './vault_watch.ts'

slow('vault watches only the spool, never the database', async () => {
  let dir = Deno.makeTempDirSync()
  let watched: (string | string[])[] = []
  let watchFs = Deno.watchFs
  using _watch = stub(Deno, 'watchFs', (paths, options) => {
    watched.push(paths)
    return watchFs(paths, options)
  })
  let turns: string[] = []
  let path = `${dir}/spool/turns.jsonl`
  let stop = watchVault(dir, () => drain((t) => turns.push(t.sid), path))
  try {
    assertEquals(watched, [`${dir}/spool`])
    // Database churn never enters a watched directory.
    for (let file of ['tasks.db', 'tasks.db-wal', 'tasks.db-shm']) {
      Deno.writeTextFileSync(`${dir}/${file}`, 'not a database')
    }
    report({ hook_event_name: 'Stop', session_id: 'first' }, path)
    await until(() => turns.length == 1)
    // The server's own empty drains must settle, not spin.
    drain(() => {}, path)
    await new Promise((r) => setTimeout(r, 30))
    assertEquals(turns, ['first'])
  } finally {
    stop()
    Deno.removeSync(dir, { recursive: true })
  }
})
