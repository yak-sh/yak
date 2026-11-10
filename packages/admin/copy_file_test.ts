import { cleanup, equal, test } from '@yaks/testing'
import { open } from '@yaks/sqlite/db'
import { page, plan, raised } from '@yaks/durable-object'
import { insert, scan } from '@yaks/sql'
import { copy, type Copying } from './copy.ts'
import { copyFile } from './copy_file.ts'
import { assertRejects } from '@std/assert'

let dir = Deno.makeTempDirSync()
cleanup(() => Deno.removeSync(dir, { recursive: true }))
let source = open(':memory:')
cleanup(source.close)
source.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
source.query(insert('note', { body: 'kept' }))
let p = plan(source)
let asking = (_: string, asked: { table?: string; after?: number }) => {
  if (!asked.table) return Promise.resolve({ plan: p })
  let { rows, last } = page(source, p.tables[0], asked.after ?? 0, raised())
  return Promise.resolve({ rows, last })
}
let options = (to: string) => ({
  spaces: [{ eid: 'store', slug: 'ada' }],
  open: (slug: string) => copyFile(to, slug),
  page: asking,
  stopping: new AbortController().signal,
  out: () => {},
})
let read = (path: string) => {
  let sql = open(path, { readOnly: true })
  try {
    return scan(sql, 'note')
  } finally {
    sql.close()
  }
}

test('overlapping copies to one destination both finish with a complete file', async () => {
  let to = `${dir}/overlap`, o = options(to), started = false
  await copy({
    ...o,
    page: async (space, asked): Promise<Copying> => {
      if (asked.table && !started) {
        started = true
        await copy(o)
      }
      return asking(space, asked)
    },
  })
  equal(read(`${to}/ada.db`), [{ body: 'kept' }])
  equal([...Deno.readDirSync(to)].map((f) => f.name), ['ada.db'])
})

test('removing the public destination during a copy leaves its open file alone', async () => {
  let to = `${dir}/removed`, o = options(to)
  await copy(o)
  let removed = false
  await copy({
    ...o,
    page: (space, asked) => {
      if (asked.table && !removed) {
        Deno.removeSync(`${to}/ada.db`)
        removed = true
      }
      return asking(space, asked)
    },
  })
  equal(read(`${to}/ada.db`), [{ body: 'kept' }])
})

test('a failed copy keeps the previous destination and removes its private file', async () => {
  let to = `${dir}/failed`, o = options(to)
  await copy(o)
  await assertRejects(
    () =>
      copy({
        ...o,
        page: (space, asked) => {
          if (asked.table) {
            equal(read(`${to}/ada.db`), [{ body: 'kept' }])
            throw new Error('source unavailable')
          }
          return asking(space, asked)
        },
      }),
    Error,
    'source unavailable',
  )
  equal(read(`${to}/ada.db`), [{ body: 'kept' }])
  equal([...Deno.readDirSync(to)].map((f) => f.name), ['ada.db'])
})
