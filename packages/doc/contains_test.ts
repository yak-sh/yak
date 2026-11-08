// A newest-first substring read of document bodies seeks its matching texts,
// including bodies stored by address, rather than walking document history.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { storage } from '@yaks/sqlite'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { compile, statements } from '@yaks/sql'
import { parse } from '@yaks/query'
import { adopt, indexed, search } from '@yaks/fts'
import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'
import { equal, ok, test } from '@yaks/testing'
import { docDoc } from './comp.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
}).symbols.sqlite3_stmt_status

let world = (n: number, addressed: boolean) => {
  let vocab = loadVocab([docDoc, {
    $defs: {
      entity: { component: true },
      task: { component: true },
      updated: { component: true },
      created: {
        component: true,
        properties: {
          at: { type: 'string', format: 'date-time', index: true },
        },
      },
    },
  }], addressed ? [blobKeywords] : [])
  let db = new Database(':memory:'), d = driver(db)
  let derived = blobRead(vocab)
  let store = storage(d, vocab, { derived })
  store.install()
  store.raise()
  for (let s of blobSchema()) d.query(s)
  let g = graph({
    vocab,
    storage: store,
    plugins: addressed ? [blobs(vocab, sqliteBlobs(statements(store)))] : [],
  })
  g.apply([
    ...Array.from({ length: n }, (_, i) => ({
      entity: { eid: `doc-${i}` },
      doc: {
        body: i == 0
          ? 'a wyrmling hatched'
          : i == 1
          ? 'wyr yrm rml mli lin ing'
          : `a dragon ${i}`,
      },
      created: { at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() },
    })),
    {
      entity: { eid: 'private' },
      doc: { body: 'a wyrmling and a dragon' },
      created: { at: '2027-01-01T00:00:00.000Z' },
      task: {},
    },
  ])
  let fields = indexed(vocab)
  adopt(d, fields, derived)
  return (needle: string, dated = false) => {
    let q = compile(
      parse(
        `.doc.body~=${needle} ${
          dated ? '.created.at>2025-01-01' : ''
        } ?task ?created ?updated .order=-created.at .limit=30`,
      ),
      vocab,
      {
        derived,
        visibility: { entity: '!task' },
        extend: [search(fields, d)],
      },
    )
    let stmt = db.prepare(q.sql)
    try {
      let rows = stmt.all(...q.params)
      return {
        eids: rows.map((r) => r.eid),
        steps: status(stmt.unsafeHandle, 4, 0),
      }
    } finally {
      stmt.finalize()
    }
  }
}

let bounded = (small: number, large: number) =>
  ok(large < small + 100, `${small} then ${large} VM instructions`)

for (let addressed of [false, true]) {
  let [small, large] = [64, 512].map((n) => world(n, addressed))
  test(`document substring reads seek their matches (${addressed ? 'stored' : 'plain'} bodies)`, () => {
    for (let needle of ['wyrmling', 'basilisk']) {
      let a = small(needle), b = large(needle)
      equal(b.eids, needle == 'wyrmling' ? ['doc-0'] : [])
      bounded(a.steps, b.steps)
    }
  })
  test(`a short document substring walks only its page (${addressed ? 'stored' : 'plain'} bodies)`, () => {
    let a = small('dr'), b = large('dr')
    equal(b.eids, Array.from({ length: 30 }, (_, i) => `doc-${511 - i}`))
    bounded(a.steps, b.steps)
  })
  test(`a date range keeps the substring seek (${addressed ? 'stored' : 'plain'} bodies)`, () => {
    let a = small('wyrmling', true), b = large('wyrmling', true)
    equal(b.eids, ['doc-0'])
    bounded(a.steps, b.steps)
  })
}
