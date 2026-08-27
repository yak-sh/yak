// Process-level WAL acceptance: the serving and effects processes keep
// persistent connections while hundreds of ordinary sqlite3 connections read
// and commit. Checkpointing must not replace the WAL generation beneath those
// connections; after every connection closes, normal SQLite cleanup may remove
// the sidecars and the next generation must contain the same history.
import { assert, assertEquals } from '@std/assert'
import { DatabaseSync } from './sqlite.ts'
import { slow, until } from './testing.ts'

let root = new URL('../', import.meta.url).pathname
let text = new TextDecoder()

let sqlite = async (db: string, sql: string) => {
  let out = await new Deno.Command('sqlite3', {
    args: ['-cmd', '.mode list', db, sql],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!out.success) {
    throw new Error(`sqlite3 failed: ${text.decode(out.stderr)}`)
  }
  return text.decode(out.stdout).trim()
}

let stop = async (child: Deno.ChildProcess | undefined) => {
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch { /* already stopped */ }
  await child.status
}

slow(
  'persistent app connections share one WAL history with 200 sqlite3 writers',
  { sanitizeResources: false, sanitizeOps: false },
  async () => {
    try {
      if (
        !(await new Deno.Command('sqlite3', { args: ['--version'] }).output())
          .success
      ) {
        return console.warn('wal concurrency: sqlite3 unavailable — skipping')
      }
    } catch {
      return console.warn('wal concurrency: sqlite3 unavailable — skipping')
    }

    let dir = await Deno.makeTempDir()
    let db = `${dir}/tasks.db`
    let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
    let port = (seat.addr as Deno.NetAddr).port
    seat.close()
    let env = {
      DB_PATH: db,
      PORT: String(port),
      TASKS_SYNC: 'off',
      TASKS_EMBED: '0',
      TASKS_BACKOFF: '',
      TASKS_WS_WORKERS: '0',
      TASKS_EFFECTS: 'daemon',
    }
    let server: Deno.ChildProcess | undefined
    let effects: Deno.ChildProcess | undefined
    try {
      server = new Deno.Command(Deno.execPath(), {
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
        stderr: 'null',
      }).spawn()
      await until(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/graph`)).ok
        } catch {
          return false
        }
      }, { timeout: 15_000, label: 'disposable server readiness' })

      effects = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          '--unstable-net',
          '--unstable-worker-options',
          'src/effectsd.ts',
        ],
        cwd: root,
        env,
        stdout: 'null',
        stderr: 'null',
      }).spawn()
      await until(() => {
        try {
          Deno.statSync(`${db}-effects.lock`)
          return true
        } catch {
          return false
        }
      }, { timeout: 5_000, label: 'effects connection' })

      await sqlite(
        db,
        `pragma busy_timeout=30000;
         create table wal_accept(id integer primary key, writer text unique);
         create table wal_account(id integer primary key check(id=1), n integer not null);
         insert into wal_account values(1,0);
         create trigger wal_accept_ai after insert on wal_accept begin
           update wal_account set n=n+1 where id=1;
         end;`,
      )
      let wal = (await Deno.stat(`${db}-wal`)).ino
      let shm = (await Deno.stat(`${db}-shm`)).ino

      let apply = async (eid: string, title: string) => {
        let response = await fetch(`http://127.0.0.1:${port}/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([{ eid, name: 'doc', comp: { title } }]),
        })
        assert(response.ok, await response.text())
      }
      let before = crypto.randomUUID()
      let after = crypto.randomUUID()
      await apply(before, 'before sqlite3 writers')

      let writers = Array.from({ length: 200 }, (_, i) =>
        sqlite(
          db,
          `pragma busy_timeout=30000; begin immediate;
           insert into wal_accept values(${i + 1},'cli-${i + 1}'); commit;`,
        ))
      await Promise.all(writers)

      // A fresh Deno connection joins the two persistent application
      // connections after the CLI burst and sees/writes the same generation.
      let fresh = new DatabaseSync(db)
      fresh.exec('pragma busy_timeout=30000')
      fresh.exec("insert into wal_accept values(1001,'deno-new')")
      assertEquals(
        (fresh.prepare('select count(*) n from wal_accept').get() as {
          n: number
        }).n,
        201,
      )
      fresh.close()

      await sqlite(
        db,
        'pragma wal_checkpoint(truncate); select count(*) from wal_accept;',
      )
      assertEquals((await Deno.stat(`${db}-wal`)).ino, wal)
      assertEquals((await Deno.stat(`${db}-shm`)).ino, shm)
      await apply(after, 'after sqlite3 writers')

      let audit = await sqlite(
        db,
        `select (select count(*) from wal_accept),
                (select n from wal_account),
                (select count(*) from journal_touch
                  where eid in ('${before}','${after}'));
         pragma foreign_key_check;
         pragma integrity_check;`,
      )
      assert(audit.includes('201|201|2'), audit)
      assert(audit.endsWith('ok'), audit)

      await stop(effects)
      effects = undefined
      await stop(server)
      server = undefined
      // SIGTERM ends the Deno processes with Deno.exit(), so their native
      // handles do not run sqlite3_close(). A normal sqlite3 connection now
      // checkpoints and closes as the sole connection; SQLite itself owns any
      // sidecar removal.
      await sqlite(db, 'pragma wal_checkpoint(truncate);')
      await until(() => {
        try {
          Deno.statSync(`${db}-wal`)
          return false
        } catch {
          return true
        }
      }, { timeout: 5_000, label: 'normal WAL cleanup after last close' })

      await sqlite(db, "insert into wal_accept values(1002,'after-reopen');")
      assertEquals(
        await sqlite(db, 'select count(*),n from wal_accept,wal_account;'),
        '202|202',
      )
      assertEquals(await sqlite(db, 'pragma integrity_check;'), 'ok')
    } finally {
      await stop(effects)
      await stop(server)
      await Deno.remove(dir, { recursive: true })
    }
  },
)
