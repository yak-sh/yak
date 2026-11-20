import { equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { page, plan, raised, tips } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { type Asked, copy, type Copying, ranges } from './copy.ts'
import { assertRejects } from '@std/assert'
import { Interrupted } from '@yaks/tools/errors'

// A source over a file of its own, read out the way the Builder's door reads
// one (workers/yak/store-copy.ts), a page of two rows at a time.
let source = open(':memory:')
source.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
for (let body of ['a', 'b', 'c']) {
  source.query({
    t: 'insert',
    into: 'note',
    cols: ['body'],
    rows: [[val(body)]],
  })
}
let empty = open(':memory:')
// A copy into a fresh file.
let into = () => ({ ...open(':memory:'), close: () => {} })
let asking = (sql: typeof source) =>
(
  _: string,
  asked: Asked,
): Promise<Copying> => {
  let made = plan(sql)
  if (!asked.table) {
    return Promise.resolve({ plan: made, tips: tips(sql, made) })
  }
  let t = made.tables.find((t) => t.name == asked.table)!
  let { rows, last, ended } = page(
    sql,
    t,
    asked.after ?? 0,
    raised(),
    2,
    Infinity,
    asked.until,
  )
  return Promise.resolve({ rows, cols: t.cols, last, ended })
}

test('a space’s store is copied table by table, and one with none says so', async () => {
  let made = open(':memory:')
  let lines: string[] = []
  let stores = { ada: source, bea: empty }
  for (let [slug, sql] of Object.entries(stores)) {
    await copy({
      spaces: [{ eid: slug, slug }],
      page: asking(sql),
      open: () => ({ ...made, close: () => {} }),
      out: (line) => lines.push(line),
      stopping: new AbortController().signal,
    })
  }
  equal(lines, ['ada  1 tables, 3 rows', 'bea  no store'])
  equal(
    made.query(select({ cols: [col('body')], from: table('note') })),
    [{ body: 'a' }, { body: 'b' }, { body: 'c' }],
  )
})

test('a space’s tables are read at once, and nothing past a table’s last page', async () => {
  let sql = open(':memory:')
  for (let name of ['note', 'tag']) {
    sql.query({ t: 'create table', name, cols: [{ name: 'body' }] })
  }
  for (
    let [into, body] of [['note', 'a'], ['note', 'b'], ['note', 'c'], [
      'tag',
      'x',
    ]]
  ) {
    sql.query({ t: 'insert', into, cols: ['body'], rows: [[val(body)]] })
  }
  let read = asking(sql), asked: string[] = []
  let both = Promise.withResolvers<void>()
  let lines: string[] = []
  await copy({
    spaces: [{ eid: 'ada', slug: 'ada' }],
    page: async (space, at) => {
      if (at.table && asked.push(`${at.table}>${at.after}`) == 2) both.resolve()
      if (at.table) await both.promise
      return read(space, at)
    },
    open: into,
    out: (line) => lines.push(line),
    stopping: new AbortController().signal,
  })
  equal(asked, ['note>0', 'tag>0', 'note>2'])
  equal(lines, ['ada  2 tables, 4 rows'])
})

test('a range is split by how dense its first page ran, the last ending where it did', () => {
  equal(ranges(0, 2, 10, 8), [
    { after: 2, until: 4 },
    { after: 4, until: 6 },
    { after: 6, until: 8 },
    { after: 8, until: undefined },
  ])
  equal(ranges(0, 2, 100, 3).map((r) => r.until), [35, 68, undefined])
  equal(ranges(0, 50, 60, 8), [{ after: 50, until: undefined }])
  equal(ranges(4, 5, 8, 8, 8), [
    { after: 5, until: 6 },
    { after: 6, until: 7 },
    { after: 7, until: 8 },
  ])
})

test('a long table’s ranges are read at once, and every row arrives once', async () => {
  let sql = open(':memory:')
  sql.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
  let bodies = Array.from({ length: 11 }, (_, i) => `n${i}`)
  for (let body of bodies) {
    sql.query({
      t: 'insert',
      into: 'note',
      cols: ['body'],
      rows: [[val(body)]],
    })
  }
  let read = asking(sql), asked: Asked[] = []
  let made = into()
  await copy({
    spaces: [{ eid: 'ada', slug: 'ada' }],
    page: (space, at) => (at.table && asked.push(at), read(space, at)),
    open: () => made,
    out: () => {},
    stopping: new AbortController().signal,
  })
  equal(asked.slice(0, 5).map((a) => [a.after, a.until]), [
    [0, undefined],
    [2, 4],
    [4, 6],
    [6, 8],
    [8, 10],
  ])
  equal(
    made.query(select({ cols: [col('body')], from: table('note') }))
      .map((r) => r.body),
    bodies,
  )
})

test('a copy stops at the next page once its process stops', async () => {
  let stop = new AbortController()
  let asked = 0
  let read = asking(source)
  await assertRejects(
    () =>
      copy({
        spaces: [{ eid: 'ada', slug: 'ada' }],
        page: (space, at) => {
          if (++asked == 2) stop.abort()
          return read(space, at)
        },
        open: () => ({ ...open(':memory:'), close: () => {} }),
        out: () => {},
        stopping: stop.signal,
      }),
    Interrupted,
  )
  equal(asked, 2)
})

test('a copy stopped during a page releases its file without writing that page', async () => {
  let made = open(':memory:')
  let stopping = new AbortController()
  let closed = false
  let page = asking(source)
  await assertRejects(
    () =>
      copy({
        spaces: [{ eid: 'ada', slug: 'ada' }],
        page: (space, asked) => {
          if (asked.table) stopping.abort()
          return page(space, asked)
        },
        open: () => ({ ...made, close: () => void (closed = true) }),
        out: () => {},
        stopping: stopping.signal,
      }),
    Interrupted,
  )
  equal(closed, true)
  equal(made.query(select({ cols: [col('body')], from: table('note') })), [])
  made.close()
})

test('a store that migrates while it is copied is copied again under its new columns', async () => {
  let sql = open(':memory:')
  sql.query({ t: 'create table', name: 'wake', cols: [{ name: 'at' }] })
  sql.query({ t: 'insert', into: 'wake', cols: ['at'], rows: [[val('1')]] })
  let read = asking(sql), migrated = false
  let made: ReturnType<typeof open>[] = []
  await copy({
    spaces: [{ eid: 'ada', slug: 'ada' }],
    page: (space, asked) => {
      if (asked.table && !migrated) {
        migrated = true
        sql.query({ t: 'alter table', table: 'wake', add: { name: 'for' } })
      }
      return read(space, asked)
    },
    open: () => {
      made.push(open(':memory:'))
      return { ...made.at(-1)!, close: () => {} }
    },
    out: () => {},
    stopping: new AbortController().signal,
  })
  equal(made.length, 2)
  equal(
    made[1].query(
      select({ cols: [col('at'), col('for')], from: table('wake') }),
    ),
    [{ at: '1', for: null }],
  )
})

test('spaces are copied at once, and a space copied already is kept', async () => {
  let started: string[] = [], both = Promise.withResolvers<void>()
  let lines: string[] = []
  await copy({
    spaces: ['ada', 'bea', 'cy'].map((slug) => ({ eid: slug, slug })),
    page: async (space, asked) => {
      if (!asked.table && started.push(space) == 2) both.resolve()
      await both.promise
      return asking(source)(space, asked)
    },
    open: into,
    out: (line) => lines.push(line),
    stopping: new AbortController().signal,
    kept: (slug) => slug == 'cy',
    lanes: 2,
  })
  equal(started, ['ada', 'bea'])
  equal(lines.sort(), [
    'ada  1 tables, 3 rows',
    'bea  1 tables, 3 rows',
    'cy  kept: copied already',
  ])
})

test('a space that fails stops the others, and its failure is the answer', async () => {
  let asked: string[] = []
  await assertRejects(
    () =>
      copy({
        spaces: ['ada', 'bea', 'cy'].map((slug) => ({ eid: slug, slug })),
        page: (space, at) => {
          asked.push(space)
          if (space == 'bea') return Promise.reject(new Error('bea said 500'))
          return asking(source)(space, at)
        },
        open: into,
        out: () => {},
        stopping: new AbortController().signal,
        lanes: 2,
      }),
    Error,
    'bea: bea said 500',
  )
  equal(asked.includes('cy'), false)
})

test('a plan answered without one fails naming its space and the answer', async () => {
  await assertRejects(
    () =>
      copy({
        spaces: [{ eid: 'ada', slug: 'ada' }],
        page: () => Promise.resolve({ ok: true } as unknown as Copying),
        open: into,
        out: () => {},
        stopping: new AbortController().signal,
      }),
    Error,
    'ada: its plan was answered {"ok":true}',
  )
})
