// A night in the bucket restores to the data dir it was taken from; the
// newest seven complete nights stay; a failed run keeps every night before it
// and reaches the tracker. The bucket here is a local directory, which rclone
// treats as a remote like R2.
import { equal, match, ok, test, until } from '@yaks/testing'
import { fileURLToPath } from 'node:url'
import { at, fn, insert, lit, type Stmt } from '@yaks/sql'
import { open, type Opened } from '@yaks/sqlite/db'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { files } from '@yaks/tracker/file'
import { comp } from '../packages/tracker/model.ts'

let script = fileURLToPath(new URL('./backup', import.meta.url))
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let sqlite = async (db: string, sql: string) => {
  let out = await new Deno.Command('sqlite3', {
    args: ['-batch', '-init', '/dev/null', '-noheader', '-list', db, sql],
  }).output()
  ok(out.success, decode(out.stderr))
  return decode(out.stdout).trim()
}
let ls = (dir: string) => [...Deno.readDirSync(dir)].map((e) => e.name).sort()

// A searched table beside the graph's own, so the counts must skip an FTS5
// index and its shadow tables, and a restore must bring the index back whole.
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
  let data = `${dir}/data`
  let remote = `${dir}/remote`
  let scratch = `${dir}/scratch`
  for (let d of [`${data}/frozen`, `${data}/roles/r`, `${data}/images`]) {
    await Deno.mkdir(d, { recursive: true })
  }
  await Deno.mkdir(scratch)
  await Deno.writeTextFile(`${data}/frozen/page.html`, '<p>frozen</p>')
  await Deno.writeTextFile(`${data}/roles/r/instructions.md`, '# role')
  await Deno.writeTextFile(`${data}/images/ab12`, 'image bytes')
  // Every supervised run has its own config and spool, never the box's.
  let configPath = `${dir}/tracker.json`
  await Deno.writeTextFile(
    configPath,
    JSON.stringify({
      tracker: { spool: 'spool' },
      plugins: [
        '@yaks/kernel',
        '@yaks/doc',
        '@yaks/tools',
        '@yaks/api',
        '@yaks/mail',
        '@yaks/wake',
        '@yaks/process',
        '@yaks/effects',
        '@yaks/tracker',
      ],
    }),
  )
  let opened: Opened[] = []
  for (let name of ['yak.db', 'tracker.db']) {
    await Deno.copyFile(await template(), `${data}/${name}`)
    opened.push(open(`${data}/${name}`))
  }
  // The rows are commits still in the WAL when the backup runs.
  let [db] = opened
  db.query(insert('entity', { id: 1 }))
  db.query(insert('note', { entity: 1, body: 'the words the index holds' }))
  let env = (more: Record<string, string> = {}) => ({
    YAK_DATA: data,
    YAK_CONFIG: configPath,
    YAK_BACKUP_REMOTE: remote,
    YAK_BACKUP_SNAPSHOT_DIR: scratch,
    YAK_BACKUP_BOUND: '1',
    ...more,
  })
  let command = (args: string[], more: Record<string, string>) =>
    new Deno.Command(script, { args, env: env(more) })
  // Through the supervisor: its timeout, its key pair and its reports.
  let watched = { YAK_BACKUP_BOUND: '', YAK_BACKUP_TIMEOUT: '30' }
  return {
    dir,
    data,
    remote,
    scratch,
    configPath,
    // Straight to the bounded child, as the supervisor runs it.
    backup: (more = {}) => command([], more).output(),
    restore: (into: string) => command(['restore', into], {}).output(),
    supervised: (args: string[] = []) => command(args, watched).output(),
    start: (more = {}) =>
      new Deno.Command(script, {
        env: env({ ...watched, ...more }),
        stdout: 'null',
        stderr: 'null',
      }).spawn(),
    spooled: () => Array.fromAsync(files(`${dir}/spool`).source()),
    nights: () => ls(`${remote}/snapshots`),
    close: async () => {
      for (let o of opened) o.close()
      await Deno.remove(dir, { recursive: true })
    },
  }
}

// Nights an earlier run left: complete ones carry `counts`.
let seed = async (remote: string, nights: string[], complete = true) => {
  for (let n of nights) {
    await Deno.mkdir(`${remote}/snapshots/${n}`, { recursive: true })
    await Deno.writeTextFile(`${remote}/snapshots/${n}/yak.db.zst`, '')
    if (complete) {
      await Deno.writeTextFile(`${remote}/snapshots/${n}/counts`, '')
    }
  }
}

test('a night restores to the data dir it was taken from', async () => {
  let f = await fixture()
  try {
    // Taken as cron takes it, under the supervisor; a success reports nothing.
    let out = await f.supervised()
    ok(out.success, decode(out.stderr))
    match(decode(out.stdout), /backup: \S+: 1 entities, done/)
    equal(await f.spooled(), [])
    let [night] = f.nights()
    equal(ls(`${f.remote}/snapshots/${night}`), [
      'counts',
      'files.tar.zst',
      'tracker.db.zst',
      'yak.db.zst',
    ])
    equal(ls(f.scratch), [])
    let into = `${f.dir}/restored`
    out = await f.restore(into)
    ok(out.success, decode(out.stderr))
    match(decode(out.stdout), new RegExp(`restored ${night} in \\d+s`))
    equal(ls(into), ['frozen', 'images', 'roles', 'tracker.db', 'yak.db'])
    equal(
      await sqlite(`${into}/yak.db`, 'select body from note'),
      'the words the index holds',
    )
    equal(
      await sqlite(
        `${into}/yak.db`,
        "select count(*) from note_fts where note_fts match 'index'",
      ),
      '1',
    )
    equal(await Deno.readTextFile(`${into}/images/ab12`), 'image bytes')
    equal(await Deno.readTextFile(`${into}/roles/r/instructions.md`), '# role')
    // A restore never lands on a directory already in use.
    out = await f.restore(into)
    ok(!out.success)
    match(decode(out.stderr), /is not empty: restore into a new directory/)
    // Nor does it pass a night whose databases read otherwise than counted.
    let counts = `${f.remote}/snapshots/${night}/counts`
    await Deno.writeTextFile(
      counts,
      (await Deno.readTextFile(counts)).replace('note\t1', 'note\t2'),
    )
    out = await f.restore(`${f.dir}/again`)
    ok(!out.success)
    match(decode(out.stderr), /row counts differ from the night's/)
  } finally {
    await f.close()
  }
})

test('the newest seven complete nights stay, and nothing else', async () => {
  let f = await fixture()
  try {
    let old = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => `2026-01-0${d}T044200Z`)
    await seed(f.remote, old)
    await seed(f.remote, ['2026-01-01T000000Z', '2026-01-09T044200Z'], false)
    let out = await f.backup()
    ok(out.success, decode(out.stderr))
    let [tonight] = f.nights().filter((n) => n > '2026-02')
    equal(f.nights(), [...old.slice(2), tonight])
  } finally {
    await f.close()
  }
})

test('a damaged database fails the night and drops nothing', async () => {
  let f = await fixture()
  try {
    await seed(f.remote, ['2026-01-01T044200Z'])
    // A b-tree page whose header is garbage: a page copy keeps it as it is.
    let file = await Deno.open(`${f.data}/tracker.db`, { write: true })
    await file.seek(4096, Deno.SeekMode.Start)
    await file.write(new Uint8Array(64).fill(0xff))
    file.close()
    let out = await f.backup()
    ok(!out.success)
    match(decode(out.stderr), /tracker\.db failed quick_check/)
    equal(f.nights(), ['2026-01-01T044200Z'])
    equal(ls(f.scratch), [])
  } finally {
    await f.close()
  }
})

test('a snapshot directory without enough space is refused', async () => {
  let f = await fixture()
  try {
    // A sparse terabyte: the capacity gate refuses it before any copy.
    await Deno.truncate(`${f.data}/yak.db`, 2 ** 40)
    // Named, and the default: the system's temporary directory.
    for (let dir of [f.scratch, '']) {
      let out = await f.backup({
        YAK_BACKUP_SNAPSHOT_DIR: dir,
        TMPDIR: f.scratch,
      })
      ok(!out.success)
      match(decode(out.stderr), /snapshot directory needs \d+ KiB/)
    }
    equal(ls(f.scratch), [])
  } finally {
    await f.close()
  }
})

// A process blocked on a lock is listed in /proc/locks as `->` against the
// locked file's inode, with its pid: how flock(1) waits.
let waiter = (path: string) => {
  let ino = Deno.statSync(path).ino
  let line = Deno.readTextFileSync('/proc/locks').split('\n')
    .find((l) => l.includes('->') && l.includes(`:${ino} `))
  return line ? Number(line.match(/-> \S+\s+\S+\s+\S+\s+(\d+)/)![1]) : 0
}
let parent = (pid: number) => {
  let stat = Deno.readTextFileSync(`/proc/${pid}/stat`)
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
}

test('a backup stuck behind another is killed at its bound and reported', async () => {
  let f = await fixture()
  let path = `${f.data}/backup.lock`
  let lock = await Deno.open(path, { create: true, write: true })
  await lock.lock()
  try {
    let backup = f.start()
    let flock = await until(() => waiter(path), {
      label: 'the backup to wait on the lock',
    })
    // The bound is timeout(1)'s alarm, and it goes off now: flock(1) runs
    // under the backup's shell, which runs under timeout.
    let bound = parent(parent(flock))
    equal(Deno.readTextFileSync(`/proc/${bound}/comm`).trim(), 'timeout')
    Deno.kill(bound, 'SIGALRM')
    equal((await backup.status).code, 124)
    let records = await f.spooled()
    equal(records.length, 1)
    equal(comp(records[0].rows[0], 'error').tags, {
      job: 'backup',
      exit_code: 124,
    })
  } finally {
    await lock.unlock()
    lock.close()
    await f.close()
  }
})

test('a failed restore is the reader’s, not a tracker bug', async () => {
  let f = await fixture()
  try {
    let out = await f.supervised(['restore', `${f.dir}/restored`])
    ok(!out.success)
    equal(await f.spooled(), [])
  } finally {
    await f.close()
  }
})

test('a failed daily backup becomes a tracker bug', async () => {
  let f = await fixture()
  let host = await compose(
    { ...read(f.configPath), db: `${f.dir}/tracker.db` },
    ['graph', 'effects', '@yaks/tracker'],
    undefined,
    {
      install: true,
    },
  )
  try {
    await seed(f.remote, ['2026-01-01T044200Z'])
    // A sparse scratch database forces the capacity gate before any copy.
    // Its size comes back at once: never fill a disk.
    let size = (await Deno.stat(`${f.data}/yak.db`)).size
    await Deno.truncate(`${f.data}/yak.db`, 2 ** 40)
    let out
    try {
      out = await f.supervised()
    } finally {
      await Deno.truncate(`${f.data}/yak.db`, size)
    }
    equal(out.code, 1)
    let stderr = decode(out.stderr)
    ok(stderr.includes('snapshot directory needs'), stderr)
    equal(f.nights(), ['2026-01-01T044200Z'])
    let records = await f.spooled()
    equal(records.length, 1)
    let row = records[0].rows[0]
    equal(comp(row, 'error').level, 'error')
    equal(comp(row, 'error').tags, { job: 'backup', exit_code: 1 })
    equal(comp(row, 'during').kind, 'backup')
    ok(
      String(comp(row, 'exception').value).includes('snapshot directory needs'),
    )
    equal(
      String(comp(row, 'error').at).slice(0, 10),
      new Date().toISOString().slice(0, 10),
    )
    await host.duties(AbortSignal.abort(), ['@yaks/tracker'])
    await host.fx.work(host.graph)
    await host.fx.idle()
    let errors = await host.graph.read('.error *')
    let bugs = await host.graph.read('.bug *')
    equal(errors.length, 1)
    equal(bugs.length, 1)
    equal(comp(errors[0], 'error').bug, bugs[0].entity.eid)
    equal(comp(bugs[0], 'bug').hits, 1)
    ok(String(comp(bugs[0], 'doc').title).includes('backup failed'))
    equal(await f.spooled(), [])
  } finally {
    await host.close()
    await f.close()
  }
})
