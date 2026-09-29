// Backups use private SQLite paths, so a failed or concurrent run cannot
// replace a database another reader or restore verifier still has open.
import { test, until } from '@yaks/testing'
import { fileURLToPath } from 'node:url'
import { assert, assertEquals } from '@std/assert'
import { at, fn, insert, lit, type Stmt } from '@yaks/sql'
import { open, type Opened } from '@yaks/sqlite/db'

let script = fileURLToPath(new URL('./backup', import.meta.url))
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let run = async (cmd: string, args: string[], cwd: string) => {
  let out = await new Deno.Command(cmd, { args, cwd }).output()
  assert(out.success, decode(out.stderr))
  return decode(out.stdout)
}

// A searched component, indexed the way @yaks/fts indexes one: an
// external-content FTS5 mirror plus the trigger that keeps it. Named after no
// index the script ever hard-coded, because that is the failure — a new index
// (mail_fts, 5db8be2b) that a list of names could not know about.
let fresh = at('new')
let schema: Stmt[] = [
  {
    t: 'create table',
    name: 'entity',
    cols: [{ name: 'id', type: 'integer', pk: true }],
  },
  {
    t: 'create table',
    name: 'note',
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      { name: 'body', type: 'text' },
    ],
  },
  {
    t: 'create virtual table',
    name: 'note_fts',
    using: 'fts5',
    args: ['body', ['content', 'note'], ['content_rowid', 'entity']],
  },
  {
    t: 'create trigger',
    name: 'note_fts_insert',
    timing: 'after',
    event: 'insert',
    on: 'note',
    body: [{
      t: 'insert',
      into: 'note_fts',
      cols: ['rowid', 'body'],
      rows: [[fresh('entity'), fn('coalesce', fresh('body'), lit(''))]],
    }],
  },
]

// The schema in a WAL database, made once: a new file's switch into WAL costs
// the disk its syncs, and a copy of one already switched costs none.
let made: Promise<string> | undefined
let template = () =>
  made ??= Deno.makeTempDir({ prefix: 'yak-backup-template-' }).then((d) => {
    let db = open(`${d}/yak.db`)
    for (let s of schema) db.query(s)
    db.close()
    return `${d}/yak.db`
  })

let fixture = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-backup-' })
  await run('git', ['init', '-q'], dir)
  await Deno.writeTextFile(`${dir}/.gitignore`, '*.db\n*.db-*\n')
  await Deno.mkdir(`${dir}/snap`)
  let opened: Opened[] = []
  let database = async (path: string) => {
    await Deno.copyFile(await template(), `${dir}/${path}`)
    let db = open(`${dir}/${path}`)
    opened.push(db)
    return db
  }
  // The rows are commits still in the WAL when the backup runs.
  let db = await database('yak.db')
  db.query(insert('entity', { id: 1 }))
  db.query(insert('note', { entity: 1, body: 'the words the index holds' }))
  // Previous versions used these public names. Another process may still
  // hold either open; a new backup has no ownership of those files.
  await database('snap/yak.db')
  await database('snap/.verify.db')
  // Unbounded unless asked: timeout(1) can take a tenth of a second to see
  // its command end, and a test waits behind nothing.
  let command = (snapshotDir: string, bound: string, io = {}) =>
    new Deno.Command(script, {
      env: {
        YAK_DATA: dir,
        YAK_BACKUP_BOUND: bound,
        YAK_BACKUP_TIMEOUT: '30',
        YAK_BACKUP_SNAPSHOT_DIR: snapshotDir,
      },
      ...io,
    })
  let release = () => {
    for (let db of opened.splice(0)) db.close()
  }
  return {
    dir,
    db,
    backup: (snapshotDir = '') => command(snapshotDir, '1').output(),
    // A bounded run to signal, with nothing to read back but how it ended.
    start: () => command('', '', { stdout: 'null', stderr: 'null' }).spawn(),
    release,
    close: async () => {
      release()
      await Deno.remove(dir, { recursive: true })
    },
  }
}

// What the fixture holds open while a backup runs.
let held = ['yak.db', 'snap/yak.db', 'snap/.verify.db']

// The first two tests read one run with every default: a backup is a few dozen
// processes, and neither test changes what the other reads. Its directory is
// the run's scratch, and the first test lets go of its databases.
let backedUp = async () => {
  let f = await fixture()
  let inodes = held.map((p) => Deno.statSync(`${f.dir}/${p}`).ino)
  return { f, inodes, out: await f.backup() }
}
let defaults: ReturnType<typeof backedUp> | undefined
let once = () => defaults ??= backedUp()

// A process blocked on a lock is listed in /proc/locks as `->` against the
// locked file's inode, which is how flock(1) waits.
let waiting = (path: string) => {
  let ino = Deno.statSync(path).ino
  return Deno.readTextFileSync('/proc/locks').split('\n')
    .some((l) => l.includes('->') && l.includes(`:${ino} `))
}

test(
  'backup snapshots WAL commits and leaves existing SQLite files attached',
  async () => {
    let { f, inodes, out } = await once()
    try {
      assert(out.success, decode(out.stderr))
      assert(decode(out.stdout).includes('backup: snapshot in /dev/shm'))
      assertEquals(held.map((p) => Deno.statSync(`${f.dir}/${p}`).ino), inodes)
      assertEquals(f.db.query({ t: 'pragma', name: 'integrity_check' }), [{
        integrity_check: 'ok',
      }])
      await run(
        'git',
        ['cat-file', '-e', 'HEAD:snap/graph.sql.part.000.zst'],
        f.dir,
      )
      let sql = await run(
        'zstd',
        ['-dcq', 'snap/graph.sql.part.000.zst'],
        f.dir,
      )
      assert(sql.includes('INSERT INTO entity VALUES(1);'), sql)
      await run('sh', [
        '-c',
        '{ cat snap/schema.sql; zstd -dcq snap/graph.sql.part.*.zst snap/journal.sql.part.*.zst; } | sqlite3 restored.db',
      ], f.dir)
      assertEquals(
        await run('sqlite3', [
          '-batch',
          '-init',
          '/dev/null',
          '-noheader',
          '-list',
          'restored.db',
          'select count(*) from entity',
        ], f.dir),
        '1\n',
      )
      let pending = [...Deno.readDirSync(`${f.dir}/.git`)]
        .filter((e) => e.isDirectory && e.name.startsWith('yak-backup.'))
      assertEquals(pending, [])
    } finally {
      f.release()
    }
  },
)

// The dump must carry an index's definition and no byte of the index itself.
// Its shadow tables cannot be written as plain create TABLEs — VACUUM emits
// them ahead of the virtual table, so they win and the virtual table then
// fails to create, which is what left every `insert into mail_fts` with no
// such table from 2026-09-11. The script's own round-trip gate is the rest of
// the proof: a run that gets here loaded its dump back.
test(
  'the dump defines each FTS5 index and dumps none of its rows',
  async () => {
    let { f, out } = await once()
    assert(out.success, decode(out.stderr))
    let schema = await run('git', ['show', 'HEAD:snap/schema.sql'], f.dir)
    assert(schema.includes('CREATE VIRTUAL TABLE "note_fts"'), schema)
    assert(schema.includes('CREATE TRIGGER "note_fts_insert"'), schema)
    assert(!/CREATE TABLE ['"]?note_fts_/.test(schema), schema)
    let sql = await run('zstd', ['-dcq', 'snap/graph.sql.part.000.zst'], f.dir)
    assert(!sql.includes('note_fts'), sql)
    assert(
      sql.includes("INSERT INTO note VALUES(1,'the words the index holds');"),
      sql,
    )
  },
)

test('a separate snapshot directory is private and cleaned', async () => {
  let f = await fixture()
  let scratch = await Deno.makeTempDir({ prefix: 'yak-snapshot-' })
  try {
    let out = await f.backup(scratch)
    assert(out.success, decode(out.stderr))
    assert(decode(out.stdout).includes(`backup: snapshot in ${scratch}`))
    assertEquals([...Deno.readDirSync(scratch)], [])
    await run(
      'git',
      ['cat-file', '-e', 'HEAD:snap/graph.sql.part.000.zst'],
      f.dir,
    )
  } finally {
    await f.close()
    await Deno.remove(scratch)
  }
})

test('a snapshot directory without enough space is refused', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-backup-capacity-' })
  let scratch = await Deno.makeTempDir({ prefix: 'yak-snapshot-' })
  try {
    await run('git', ['init', '-q'], dir)
    await Deno.writeTextFile(`${dir}/yak.db`, '')
    await Deno.truncate(`${dir}/yak.db`, 2 ** 40)
    for (let snapshotDir of ['', scratch]) {
      let env: Record<string, string> = {
        YAK_DATA: dir,
        YAK_BACKUP_BOUND: '1',
      }
      if (snapshotDir) env.YAK_BACKUP_SNAPSHOT_DIR = snapshotDir
      let out = await new Deno.Command(script, {
        env,
      }).output()
      assert(!out.success)
      assert(decode(out.stderr).includes('snapshot directory needs'))
    }
    assertEquals([...Deno.readDirSync(scratch)], [])
  } finally {
    await Deno.remove(dir, { recursive: true })
    await Deno.remove(scratch)
  }
})

test('the restore proof compares against snapshot row counts', async () => {
  let f = await fixture()
  try {
    f.db.query({
      t: 'create table',
      name: 'echo',
      cols: [{ name: 'id', type: 'integer' }],
    })
    // The original entity predates this trigger; replaying its INSERT adds a
    // row to echo that the checked snapshot did not contain.
    f.db.query({
      t: 'create trigger',
      name: 'echo_entity',
      timing: 'after',
      event: 'insert',
      on: 'entity',
      body: [insert('echo', { id: 1 })],
    })
    let out = await f.backup()
    assert(!out.success)
    assert(
      decode(out.stderr).includes('round-trip lost rows in echo (0 → 1)'),
      decode(out.stderr),
    )
  } finally {
    await f.close()
  }
})

test(
  'a backup timing out on the lock cannot remove the active verifier database',
  async () => {
    let f = await fixture()
    let path = `${f.dir}/.git/yak-backup.lock`
    let lock = await Deno.open(path, { create: true, write: true })
    await lock.lock()
    try {
      let before = Deno.statSync(`${f.dir}/snap/.verify.db`).ino
      let backup = f.start()
      await until(() => waiting(path), {
        label: 'the backup to wait on the lock',
      })
      // SIGALRM is timeout(1)'s own deadline: its time runs out now.
      backup.kill('SIGALRM')
      assertEquals((await backup.status).code, 124)
      assertEquals(Deno.statSync(`${f.dir}/snap/.verify.db`).ino, before)
    } finally {
      await lock.unlock()
      lock.close()
      await f.close()
    }
  },
)
