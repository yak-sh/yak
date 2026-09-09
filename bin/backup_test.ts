// Backups use private SQLite paths, so a failed or concurrent run cannot
// replace a database another reader or restore verifier still has open.
import { assert, assertEquals } from '@std/assert'
import { DatabaseSync } from '../src/store/sqlite.ts'
import { slow } from '../src/testing.ts'

let script = new URL('./backup', import.meta.url).pathname
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let run = async (cmd: string, args: string[], cwd: string) => {
  let out = await new Deno.Command(cmd, { args, cwd }).output()
  assert(out.success, decode(out.stderr))
  return decode(out.stdout)
}

let fixture = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'tasks-backup-' })
  await run('git', ['init', '-q'], dir)
  await Deno.writeTextFile(`${dir}/.gitignore`, '*.db\n*.db-*\n')
  await Deno.mkdir(`${dir}/snap`)
  let opened: DatabaseSync[] = []
  let database = (path: string) => {
    let db = new DatabaseSync(`${dir}/${path}`)
    opened.push(db)
    db.exec(
      'pragma journal_mode=wal; create table entity (id integer primary key)',
    )
    db.exec('insert into entity values (1)')
    return db
  }
  let db = database('tasks.db')
  // Previous versions used these public names. Another process may still
  // hold either open; a new backup has no ownership of those files.
  database('snap/tasks.db')
  database('snap/.verify.db')
  return {
    dir,
    db,
    backup: (timeout = '30') =>
      new Deno.Command(script, {
        env: {
          TASKS_DATA: dir,
          TASKS_BACKUP_BOUND: '',
          TASKS_BACKUP_TIMEOUT: timeout,
        },
      }).output(),
    close: async () => {
      for (let db of opened) db.close()
      await Deno.remove(dir, { recursive: true })
    },
  }
}

slow(
  'backup snapshots WAL commits and leaves existing SQLite files attached',
  async () => {
    let f = await fixture()
    try {
      let paths = ['tasks.db', 'snap/tasks.db', 'snap/.verify.db']
      let inodes = paths.map((p) => Deno.statSync(`${f.dir}/${p}`).ino)
      let out = await f.backup()
      assert(out.success, decode(out.stderr))
      assertEquals(paths.map((p) => Deno.statSync(`${f.dir}/${p}`).ino), inodes)
      assertEquals(f.db.prepare('pragma integrity_check').get(), {
        integrity_check: 'ok',
      })
      let sql = await run(
        'git',
        ['show', 'HEAD:snap/graph.sql.part.000'],
        f.dir,
      )
      assert(sql.includes('INSERT INTO entity VALUES(1);'), sql)
      let pending = [...Deno.readDirSync(`${f.dir}/.git`)]
        .filter((e) => e.isDirectory && e.name.startsWith('tasks-backup.'))
      assertEquals(pending, [])
    } finally {
      await f.close()
    }
  },
)

slow(
  'a backup timing out on the lock cannot remove the active verifier database',
  async () => {
    let f = await fixture()
    let lock = await Deno.open(`${f.dir}/.git/tasks-backup.lock`, {
      create: true,
      write: true,
    })
    await lock.lock()
    try {
      let before = Deno.statSync(`${f.dir}/snap/.verify.db`).ino
      let out = await f.backup('0.2')
      assertEquals(out.code, 124)
      assertEquals(Deno.statSync(`${f.dir}/snap/.verify.db`).ino, before)
    } finally {
      await lock.unlock()
      lock.close()
      await f.close()
    }
  },
)
