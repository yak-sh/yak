// Backups use private SQLite paths, so a failed or concurrent run cannot
// replace a database another reader or restore verifier still has open.
import { fileURLToPath } from 'node:url'
import { assert, assertEquals } from '@std/assert'
import { DatabaseSync } from '../src/store/sqlite.ts'
import { slow } from '../src/testing.ts'

let script = fileURLToPath(new URL('./backup', import.meta.url))
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let run = async (cmd: string, args: string[], cwd: string) => {
  let out = await new Deno.Command(cmd, { args, cwd }).output()
  assert(out.success, decode(out.stderr))
  return decode(out.stdout)
}

let fixture = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-backup-' })
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
  let db = database('yak.db')
  // A searched component, indexed the way @yaks/fts indexes one: an
  // external-content FTS5 mirror plus the trigger that keeps it. Named after
  // no index the script ever hard-coded, because that is the failure — a new
  // index (mail_fts, 5db8be2b) that a list of names could not know about.
  db.exec(`create table note (entity integer primary key, body text);
    create virtual table "note_fts" using fts5(
      "body", content='note', content_rowid='entity'
    );
    create trigger "note_fts_insert" after insert on "note" begin
      insert into "note_fts"(rowid, "body") values (new.entity, coalesce(new."body", ''));
    end;
    insert into note values (1, 'the words the index holds')`)
  // Previous versions used these public names. Another process may still
  // hold either open; a new backup has no ownership of those files.
  database('snap/yak.db')
  database('snap/.verify.db')
  return {
    dir,
    db,
    backup: (timeout = '30') =>
      new Deno.Command(script, {
        env: {
          YAK_DATA: dir,
          YAK_BACKUP_BOUND: '',
          YAK_BACKUP_TIMEOUT: timeout,
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
      let paths = ['yak.db', 'snap/yak.db', 'snap/.verify.db']
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
        .filter((e) => e.isDirectory && e.name.startsWith('yak-backup.'))
      assertEquals(pending, [])
    } finally {
      await f.close()
    }
  },
)

// The dump must carry an index's definition and no byte of the index itself.
// Its shadow tables cannot be written as plain create TABLEs — VACUUM emits
// them ahead of the virtual table, so they win and the virtual table then
// fails to create, which is what left every `insert into mail_fts` with no
// such table from 2026-09-11. The script's own round-trip gate is the rest of
// the proof: a run that gets here loaded its dump back.
slow(
  'the dump defines each FTS5 index and dumps none of its rows',
  async () => {
    let f = await fixture()
    try {
      let out = await f.backup()
      assert(out.success, decode(out.stderr))
      let schema = await run('git', ['show', 'HEAD:snap/schema.sql'], f.dir)
      assert(schema.includes('CREATE VIRTUAL TABLE "note_fts"'), schema)
      assert(schema.includes('CREATE TRIGGER "note_fts_insert"'), schema)
      assert(!/CREATE TABLE ['"]?note_fts_/.test(schema), schema)
      let sql = await run(
        'git',
        ['show', 'HEAD:snap/graph.sql.part.000'],
        f.dir,
      )
      assert(!sql.includes('note_fts'), sql)
      assert(
        sql.includes("INSERT INTO note VALUES(1,'the words the index holds');"),
        sql,
      )
    } finally {
      await f.close()
    }
  },
)

slow(
  'a backup timing out on the lock cannot remove the active verifier database',
  async () => {
    let f = await fixture()
    let lock = await Deno.open(`${f.dir}/.git/yak-backup.lock`, {
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
