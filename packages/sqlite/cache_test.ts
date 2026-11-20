// Cache eviction returns disk space through the same inode and connection a
// running process already owns, while retaining entries it can still reuse.
// The owner holds its cache through Deno's own SQLite, as Deno holds its
// caches in this process; a trim that opened it through another copy would
// not see the owner's locks.
import * as io from '@yaks/file/io'
import { col, type Driver, insert, select, table } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { builtin } from './builtin.ts'
import { held, prune, threaded, trim } from './cache.ts'
import { open } from './db.ts'

let schema = (db: Driver) => {
  db.query({
    t: 'create table',
    name: 'entries',
    cols: [{ name: 'source' }, { name: 'data' }],
  })
  db.query({ t: 'create table', name: 'info', cols: [{ name: 'version' }] })
  db.query(insert('info', { version: 2 }))
}
let rows = (db: Driver) =>
  db.query(select({ cols: [col('source')], from: table('entries') }))
let tables = { entries: 'source' }

let memory = open(':memory:')
schema(memory)
for (
  let source of ['file:///gone.ts', 'file:///kept.ts', 'https://host/mod.ts']
) {
  memory.query(insert('entries', { source, data: 'data' }))
}

test('cache pruning keeps existing files and remote entries', () => {
  let checked: string[] = []
  equal(
    prune(memory, tables, (source) => {
      checked.push(source)
      return source == 'file:///gone.ts'
    }),
    1,
  )
  equal(checked.sort(), ['file:///gone.ts', 'file:///kept.ts'])
  equal(rows(memory), [
    { source: 'file:///kept.ts' },
    { source: 'https://host/mod.ts' },
  ])
  memory.close()
})

let fixture = () => {
  let dir = io.makeTempDirSync()
  let path = dir + '/cache'
  io.writeFileSync(path, new Uint8Array())
  let db = builtin(path)
  db.query({ t: 'pragma', name: 'journal_mode', value: 'wal' })
  schema(db)
  io.writeTextFileSync(dir + '/kept.ts', '')
  let kept = io.pathToFileURL(dir + '/kept.ts').href
  let gone = io.pathToFileURL(dir + '/gone.ts').href
  let add = (source: string, bytes: number) =>
    db.query(insert('entries', { source, data: new Uint8Array(bytes) }))
  let close = () => {
    db.close()
    io.removeSync(dir, { recursive: true })
  }
  return { dir, path, db, kept, gone, add, close }
}

let stale = fixture()
stale.add(stale.kept, 1000)
stale.add(stale.gone, 256 * 1024)
let full = fixture()
full.add(full.kept, 256 * 1024)
let small = fixture()
small.add(small.kept, 1000)
let locked = fixture()
locked.add(locked.gone, 256 * 1024)
let read = fixture()
read.add(read.gone, 256 * 1024)
let damaged = fixture()
damaged.add(damaged.gone, 256 * 1024)

test('cache eviction compacts in place while an existing connection continues writing', async () => {
  let { path, db, kept, close } = stale
  let descriptor = io.openSync(path)
  let inode = descriptor.statSync().ino
  try {
    equal(db.query({ t: 'pragma', name: 'journal_mode' }), [{
      journal_mode: 'wal',
    }])
    ok(await trim(path, { most: 64 * 1024, tables }) > 0)
    ok(await held(path) <= 64 * 1024)
    equal(io.statSync(path).ino, inode)
    equal(descriptor.statSync().nlink, 1)
    equal(rows(db), [{ source: kept }])
    db.query(insert('entries', { source: 'https://host/new.ts', data: 'new' }))
    equal(rows(db).length, 2)
    equal(db.query(select({ from: table('info') })), [{ version: 2 }])
  } finally {
    descriptor.close()
    close()
  }
})

test('a cache still over budget clears rebuildable rows and retains metadata', async () => {
  let { path, db, close } = full
  try {
    ok(await trim(path, { most: 64 * 1024, tables }) > 0)
    ok(await held(path) <= 64 * 1024)
    equal(rows(db), [])
    equal(db.query(select({ from: table('info') })), [{ version: 2 }])
  } finally {
    close()
  }
})

test('a cache below budget retains its rows and a missing cache stays absent', async () => {
  let { path, db, kept, dir, close } = small
  try {
    equal(await trim(path, { most: 4 * 1024 * 1024, tables }), 0)
    equal(rows(db), [{ source: kept }])
    equal(await trim(dir + '/absent', { most: 0, tables }), 0)
    equal([...io.readDirSync(dir)].some((e) => e.name == 'absent'), false)
  } finally {
    close()
  }
})

test('a trim waits for its lock on its own thread while the caller runs', async () => {
  let { path, db, close } = locked
  try {
    db.query({ t: 'begin', mode: 'immediate' })
    setTimeout(() => db.query({ t: 'commit' }), 100)
    ok(await threaded(path, { most: 64 * 1024, tables }) > 0)
    equal(rows(db), [])
  } finally {
    close()
  }
})

test('a cache another connection is reading waits for the next pass', async () => {
  let { path, db, close } = read
  let cache = { most: 64 * 1024, tables }
  try {
    db.query({ t: 'begin' })
    equal(rows(db).length, 1)
    await trim(path, cache)
    ok(await held(path) > cache.most)
    db.query({ t: 'commit' })
    equal(rows(db), [])
    await trim(path, cache)
    ok(await held(path) <= 64 * 1024)
  } finally {
    close()
  }
})

test('a malformed cache is removed for its owner to rebuild', async () => {
  let { dir, path, db } = damaged
  db.query({ t: 'pragma', name: 'wal_checkpoint', value: 'truncate' })
  db.close()
  let file = io.openSync(path, { write: true })
  file.seekSync(4096, io.SeekMode.Start)
  file.writeSync(new Uint8Array(4096).fill(0xff))
  file.close()
  try {
    ok(await trim(path, { most: 64 * 1024, tables }) > 0)
    equal([...io.readDirSync(dir)].map((e) => e.name), ['kept.ts'])
  } finally {
    io.removeSync(dir, { recursive: true })
  }
})
