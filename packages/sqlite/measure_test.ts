// A file is measured on a connection of its own in a Worker: it answers what
// the walk here would, and a measurement aborted while it runs answers nothing.

import { equal, test } from '@yaks/testing'
import { col, val } from '@yaks/sql'
import { open } from './db.ts'
import { measure, walk } from './measure.ts'

let filed = () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-measure-' })
  let db = open(`${dir}/graph.db`)
  db.query({ t: 'create table', name: 'note', cols: [{ name: 'body' }] })
  db.query({
    t: 'create index',
    name: 'note_body',
    on: 'note',
    cols: [col('body')],
  })
  let body = [val('x'.repeat(100))]
  db.query({
    t: 'insert',
    into: 'note',
    cols: ['body'],
    rows: Array(40).fill(body),
  })
  return Object.assign(db, {
    [Symbol.dispose]: () => {
      db.close()
      Deno.removeSync(dir, { recursive: true })
    },
  })
}

test('a file is measured in a Worker, as the walk here measures it', async () => {
  using db = filed()
  equal(await measure(db), await walk(db))
})

test('a measurement aborted while its Worker runs answers nothing', async () => {
  using db = filed()
  let stop = new AbortController()
  let measuring = measure(db, stop.signal)
  stop.abort()
  equal(await measuring, undefined)
  equal(await measure(db, stop.signal), undefined)
})
