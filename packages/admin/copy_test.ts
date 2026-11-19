import { equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { page, plan, raised } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { copy, type Copying } from './copy.ts'
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
let asking = (sql: typeof source) =>
(
  _: string,
  asked: { table?: string; after?: number },
): Promise<Copying> => {
  let made = plan(sql)
  if (!asked.table) return Promise.resolve({ plan: made })
  let t = made.tables.find((t) => t.name == asked.table)!
  let { rows, last } = page(sql, t, asked.after ?? 0, raised(), 2)
  return Promise.resolve({ rows, cols: t.cols, last })
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

// A copy into a fresh file, said as its lines once every space is read.
let into = () => ({ ...open(':memory:'), close: () => {} })

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
