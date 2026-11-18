// Cache eviction returns disk space through the same inode and connection a
// running process already owns, while retaining entries it can still reuse.
import * as io from '@yaks/file/io'
import { col, insert, select, table } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { held, prune, trim } from './cache.ts'
import { open } from './db.ts'

let schema = (db: ReturnType<typeof open>) => {
  db.query({
    t: 'create table',
    name: 'entries',
    cols: [{ name: 'source' }, { name: 'data' }],
  })
  db.query({ t: 'create table', name: 'info', cols: [{ name: 'version' }] })
  db.query(insert('info', { version: 2 }))
}
let rows = (db: ReturnType<typeof open>) =>
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
  let db = open(path)
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
