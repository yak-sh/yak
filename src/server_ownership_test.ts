import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { DatabaseSync, open } from './store/sqlite.ts'
import { slow, until } from './testing.ts'
import {
  acquireServerOwnership,
  OWNER_BUSY_EXIT,
  ownershipPath,
  releaseServerOwnership,
} from './server_ownership.ts'

let root = new URL('../', import.meta.url).pathname
let decoder = new TextDecoder()
let freePort = () => {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  return port
}
let envFor = (db: string, port = freePort()) => ({
  DB_PATH: db,
  PORT: String(port),
  TASKS_SYNC: 'off',
  TASKS_EMBED: '0',
  TASKS_BACKOFF: '',
  TASKS_WS_WORKERS: '0',
  TASKS_EFFECTS: 'daemon',
})
let server = (env: Record<string, string>) =>
  new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '-A',
      '--unstable-net',
      '--unstable-worker-options',
      'src/server.ts',
    ],
    cwd: root,
    env,
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
let stop = async (child?: Deno.ChildProcess) => {
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch { /* already stopped */ }
  await child.status
}
let readiness = async (port: string) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/graph`)).ok
  } catch {
    return false
  }
}
type FileFact = {
  bytes: string
  size: number
  mode: number | null
  mtime: number | null
}
let facts = async (db: string) => {
  let out: Record<string, FileFact | null> = {}
  for (let suffix of ['', '-wal', '-shm']) {
    let path = db + suffix
    try {
      let [bytes, stat] = await Promise.all([
        Deno.readFile(path),
        Deno.stat(path),
      ])
      let digest = await crypto.subtle.digest('SHA-256', bytes)
      out[suffix || 'db'] = {
        bytes: Array.from(
          new Uint8Array(digest),
          (b) => b.toString(16).padStart(2, '0'),
        ).join(''),
        size: stat.size,
        mode: stat.mode,
        mtime: stat.mtime?.getTime() ?? null,
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) out[suffix || 'db'] = null
      else throw e
    }
  }
  return out
}
let stableFacts = async (db: string) => {
  let prior = await facts(db)
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    let current = await facts(db)
    if (JSON.stringify(current) == JSON.stringify(prior)) return current
    prior = current
  }
  throw new Error('owner SQLite files did not settle while migration was held')
}
let loser = async (env: Record<string, string>) => {
  let child = server(env)
  let [status, stderr] = await Promise.all([
    child.status,
    new Response(child.stderr).text(),
  ])
  assertEquals(status.code, OWNER_BUSY_EXIT)
  assertStringIncludes(stderr, 'server ownership refused')
  assertStringIncludes(stderr, 'SQLite was not opened')
  assertEquals(await readiness(env.PORT), false)
}
let ownsFd = async (pid: number, db: string) => {
  try {
    for await (let entry of Deno.readDir(`/proc/${pid}/fd`)) {
      try {
        if (
          await Deno.realPath(`/proc/${pid}/fd/${entry.name}`) ==
            await Deno.realPath(db)
        ) return true
      } catch { /* fd moved while inspected */ }
    }
  } catch { /* process has not reached open, or exited */ }
  return false
}

slow(
  'server ownership: loser never opens SQLite before or during winner migration',
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let dir = await Deno.makeTempDir({ prefix: 'tasks-owner-' })
    let db = `${dir}/tasks.db`
    let seeded = open(db)
    seeded.close()
    // Make the guarded winner perform a real version transition once the
    // external writer releases migration's BEGIN IMMEDIATE.
    let old = new DatabaseSync(db)
    old.exec('pragma user_version=0')
    old.close()
    let holder: Deno.ChildProcess | undefined
    let winner: Deno.ChildProcess | undefined
    let blocker: Deno.ChildProcess | undefined
    try {
      // Phase one: the winner is paused at the barrier itself, before any
      // owner-storage module has been imported.
      holder = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', 'src/testing/hold_server_owner.ts'],
        cwd: root,
        env: { DB_PATH: db },
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()
      let reader = holder.stdout.getReader()
      let { value: chunk } = await reader.read()
      reader.releaseLock()
      assertStringIncludes(
        decoder.decode(chunk),
        'owned-before-import',
      )
      let before = await facts(db)
      await loser(envFor(db))
      assertEquals(await facts(db), before)
      let writer = holder.stdin.getWriter()
      await writer.write(new Uint8Array([1]))
      await writer.close()
      assertEquals((await holder.status).success, true)
      holder = undefined

      // Phase two: hold SQLite's write transaction so the real winner has
      // imported live_db and is stopped inside migration while retaining the
      // process-level ownership claim.
      blocker = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', 'src/testing/hold_sqlite_writer.ts', db],
        cwd: root,
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
      }).spawn()
      let blockerReader = blocker.stdout.getReader()
      let { value: blockerChunk } = await blockerReader.read()
      blockerReader.releaseLock()
      assertStringIncludes(decoder.decode(blockerChunk), 'sqlite-writer-held')
      let winnerEnv = envFor(db)
      winner = server(winnerEnv)
      await until(() => ownsFd(winner!.pid, db), {
        timeout: 5_000,
        label: 'winner to open SQLite under the owner lease',
      })
      let during = await stableFacts(db)
      await loser(envFor(db))
      assertEquals(await facts(db), during)
      assertEquals(await readiness(winnerEnv.PORT), false)

      let blockerWriter = blocker.stdin.getWriter()
      await blockerWriter.write(new Uint8Array([1]))
      await blockerWriter.close()
      assertEquals((await blocker.status).success, true)
      blocker = undefined
      await until(() => readiness(winnerEnv.PORT), {
        timeout: 15_000,
        label: 'winner readiness after migration resumes',
      })
      await stop(winner)
      winner = undefined

      // Orderly shutdown releases the claim for the next guarded boot.
      let nextEnv = envFor(db)
      winner = server(nextEnv)
      await until(() => readiness(nextEnv.PORT), {
        timeout: 15_000,
        label: 'successor readiness',
      })
      assert((await fetch(`http://127.0.0.1:${nextEnv.PORT}/integrity`)).ok)
    } finally {
      if (blocker) {
        try {
          await blocker.stdin.close()
        } catch { /* gone */ }
        await blocker.status
      }
      if (holder) {
        try {
          await holder.stdin.close()
        } catch { /* gone */ }
        await holder.status
      }
      await stop(winner)
      await Deno.remove(dir, { recursive: true })
    }
  },
)

slow(
  'controlled cutover: failed migration stops and verified backup restores before retry',
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    let dir = await Deno.makeTempDir({ prefix: 'tasks-cutover-' })
    let db = `${dir}/tasks.db`
    let backup = `${dir}/tasks.verified.db`
    let child: Deno.ChildProcess | undefined
    try {
      let original = open(db)
      original.exec(
        "insert into setting(entity,key,value) values((select id from entity limit 1),'cutover-proof','before')",
      )
      let expectedEntities =
        (original.prepare('select count(*) as n from entity')
          .get() as { n: number }).n
      original.close()
      await Deno.copyFile(db, backup)
      let verify = new DatabaseSync(backup, { readOnly: true })
      assertEquals(
        (verify.prepare('pragma integrity_check').get() as {
          integrity_check: string
        }).integrity_check,
        'ok',
      )
      assertEquals(
        (verify.prepare('pragma user_version').get() as {
          user_version: number
        })
          .user_version,
        1,
      )
      assertEquals(
        (verify.prepare('select count(*) as n from entity').get() as {
          n: number
        }).n,
        expectedEntities,
      )
      assertEquals(
        (verify.prepare("select value from setting where key='cutover-proof'")
          .get() as { value: string }).value,
        'before',
      )
      verify.close()
      let backupBytes = await Deno.readFile(backup)

      // A future schema version is a deterministic migration refusal after
      // SQLite open but before readiness. The guarded process must die and free
      // ownership; the operator then restores the verified pre-cutover bytes.
      let injected = new DatabaseSync(db)
      injected.exec('pragma user_version=2')
      injected.close()
      let failedEnv = envFor(db)
      child = server(failedEnv)
      let [status, stderr] = await Promise.all([
        child.status,
        new Response(child.stderr).text(),
      ])
      child = undefined
      assertEquals(status.code, 1)
      assertStringIncludes(stderr, 'database schema version 2 is newer')
      assertEquals(await readiness(failedEnv.PORT), false)

      // The failed candidate selected WAL before rejecting the future schema.
      // With the process gone, discard that candidate generation before
      // replacing the main file with the verified, self-contained backup.
      for (let suffix of ['-wal', '-shm']) {
        try {
          await Deno.remove(db + suffix)
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e
        }
      }
      await Deno.writeFile(db, backupBytes)
      let restored = await Deno.readFile(db)
      assertEquals(restored, backupBytes)
      let retryEnv = envFor(db)
      child = server(retryEnv)
      await until(() => readiness(retryEnv.PORT), {
        timeout: 15_000,
        label: 'restored successor readiness',
      })
      let audit = new DatabaseSync(db, { readOnly: true })
      assertEquals(
        (audit.prepare('pragma integrity_check').get() as {
          integrity_check: string
        }).integrity_check,
        'ok',
      )
      assertEquals(
        (audit.prepare('pragma user_version').get() as { user_version: number })
          .user_version,
        1,
      )
      assertEquals(
        (audit.prepare("select value from setting where key='cutover-proof'")
          .get() as { value: string }).value,
        'before',
      )
      audit.close()
    } finally {
      await stop(child)
      await Deno.remove(dir, { recursive: true })
    }
  },
)

Deno.test('ownership lock path is separate from the complete SQLite owner file set', () => {
  assertEquals(ownershipPath('/tmp/graph.db'), '/tmp/graph.db-server.lock')
})

Deno.test('ownership preserves first boot into a missing graph directory', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-owner-parent-' })
  let db = `${root}/new/graph/tasks.db`
  try {
    acquireServerOwnership(db)
    assertEquals(Deno.statSync(`${db}-server.lock`).isFile, true)
  } finally {
    releaseServerOwnership()
    Deno.removeSync(root, { recursive: true })
  }
})
