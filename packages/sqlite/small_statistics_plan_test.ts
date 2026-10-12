// Keyed statements keep their seeks when statistics describe a small store.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { mem } from './testing.ts'
import {
  compile,
  doomSql,
  type Driver,
  insert,
  looseSql,
  type Stmt,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { fields, schema as ftsSchema, search } from '@yaks/fts'
import { get, read, removeSql, spines, storage } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    created: {
      component: true,
      type: 'object',
      properties: {
        via: { type: 'string', ref: 'entity', index: true },
        by: { type: 'string', ref: 'entity', index: true },
      },
    },
    wake: {
      component: true,
      type: 'object',
      index: [['at']],
      properties: { at: { type: 'string', format: 'date-time' } },
    },
    result: {
      component: true,
      type: 'object',
      properties: { call: { type: 'string', ref: 'entity', index: true } },
    },
    node: {
      component: true,
      type: 'object',
      properties: {
        of: { type: 'string', ref: 'entity', death: 'cascade' },
        also: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
    mark: {
      component: true,
      type: 'object',
      properties: { of: { type: 'string', ref: 'entity', death: 'release' } },
    },
    link: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity', death: 'detach' } },
    },
    doc: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string', search: true },
        enabled: { type: 'boolean' },
        metadata: { type: 'object' },
        boxed: { type: ['string', 'object'] },
      },
    },
  },
})

let ids = Array.from({ length: 827 }, (_, i) => `e${i}`)
let fixture = (() => {
  let base = mem(), statements: Stmt[] = []
  let d: Driver = {
    ...base,
    query(stmt) {
      statements.push(stmt)
      return base.query(stmt)
    },
  }
  let s = storage(d, vocab)
  s.install()
  for (let stmt of ftsSchema(fields(vocab))) d.query(stmt)
  d.query(insert('entity', ...ids.slice(0, 21).map((eid) => ({ eid }))))
  d.query(
    insert('created', { entity: 1, via: 3, by: 4 }, {
      entity: 2,
      via: 3,
      by: 4,
    }),
  )
  d.query(insert('wake', { entity: 4, at: '2026-10-11T12:00:00.000Z' }))
  d.query(insert('result', { entity: 5, call: 7 }, { entity: 6, call: 7 }))
  d.query(
    insert('node', { entity: 7, of: 1, also: 1 }, {
      entity: 8,
      of: 7,
      also: 1,
    }),
  )
  d.query(insert('mark', { entity: 10, of: 1 }))
  d.query(insert('link', { entity: 11, to: 1 }))
  d.query(insert('doc', { entity: 9, title: 'small statistics needle' }))
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'e8' },
      doc: {
        enabled: false,
        metadata: { labels: ['"quoted"', null] },
        boxed: 'string',
      },
    }])
  )
  d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
  d.query(insert('entity', ...ids.slice(21).map((eid) => ({ eid }))))
  return { d, statements }
})()

let plan = (stmt: Stmt): string[] =>
  fixture.d.query({
    t: 'explain query plan',
    of: stmt,
  }).map((row) => String(row.detail))
let explain = (stmt: Stmt): string => plan(stmt).join('\n')
let noScan = (stmt: Stmt, table: string) => {
  let details = explain(stmt)
  assert(!new RegExp(`\\bSCAN\\s+"?${table}"?\\b`).test(details), details)
}
let seek = (stmt: Stmt, alias: string) => {
  let details = explain(stmt)
  assert(
    new RegExp(`\\bSEARCH\\s+"?${alias}"?\\b`).test(details),
    details,
  )
}
let all = (query: string, extend?: ReturnType<typeof search>) =>
  compile(parse(query), vocab, extend ? { extend: [extend] } : {})

let cascades = doomSql(vocab, ['e0'])
let loose = looseSql(vocab, ['e0'])[0]
test('cascade seed seeks listed identities under stale statistics', () => {
  noScan(cascades[0], 'entity')
})
test('cascade edges seek incoming references under stale statistics', () => {
  noScan(cascades[0], 'node')
})
test('cascade closure still finds the referencing entities', () => {
  assertEquals(
    fixture.d.query(cascades[0]).map((row) => row.eid),
    ['e0', 'e6', 'e7'],
  )
})
test('release references seek owners under stale statistics', () => {
  noScan(loose, 'mark')
})
test('detach references seek owners under stale statistics', () => {
  noScan(loose, 'link')
})
test('loose reads still find references to the deleted entity', () => {
  let refs = fixture.d.query(loose)
  assert(refs.some((row) => row.comp == 'mark'))
  assert(refs.some((row) => row.comp == 'link'))
})

let removals = removeSql(
  ['created', 'wake', 'result', 'node', 'mark', 'link', 'doc'],
  [{ eid: 'e0' }],
  '2026-10-11T12:00:00.000Z',
)
for (let stmt of removals) {
  let name = stmt.t == 'delete' ? String(stmt.from) : 'tombstone insert'
  test(`remove ${name} seeks owners under stale statistics`, () => {
    if (stmt.t == 'delete') noScan(stmt, String(stmt.from))
    else noScan(stmt, 'entity')
  })
}

test('compiled eid-only query seeks listed identities under stale statistics', () => {
  let stmt = all('.entity.eid=e0,e1,e2'), rows = fixture.d.query(stmt)
  assertEquals(rows.map((row) => String(row.eid)).sort(), ['e0', 'e1', 'e2'])
  noScan(stmt, 'entity')
  seek(stmt, 'entity')
})

test('storage eid lists seek the identity spine under stale statistics', () => {
  let named = ['e0', 'e1', 'e2']
  fixture.statements.length = 0
  assertEquals(spines(fixture.d, named).size, named.length)
  let spine = fixture.statements[0]
  assert(spine)
  noScan(spine, 'e')
  seek(spine, 'e')
})

test('created.via queries seek matching markers under stale statistics', () => {
  let stmt = all('.created.via=e2'), rows = fixture.d.query(stmt)
  assertEquals(rows.map((row) => String(row.eid)).sort(), ['e0', 'e1'])
  noScan(stmt, 'created')
})

test('wake queries seek matching dates under stale statistics', () => {
  let stmt = all('.wake.at=2026-10-11T12:00:00.000Z'),
    rows = fixture.d.query(stmt)
  assertEquals(rows.map((row) => String(row.eid)), ['e3'])
  noScan(stmt, 'wake')
})

test('result queries seek matching calls under stale statistics', () => {
  let stmt = all('.result.call=e6'), rows = fixture.d.query(stmt)
  assertEquals(rows.map((row) => String(row.eid)).sort(), ['e4', 'e5'])
  noScan(stmt, 'result')
})

let facets = ['created', 'wake', 'result', 'node']
fixture.statements.length = 0
let gathered = get(fixture.d, vocab, ['e0', 'e3', 'e4', 'e8'], {}, facets)
let gathers = fixture.statements.filter((s) => s.t == 'select' || s.t == 'raw')
test('joined component gathers seek owners under stale statistics', () => {
  assert(gathers.length)
  for (let stmt of gathers) {
    let details = explain(stmt)
    for (let name of ['e', ...facets.map((_, i) => `@g${i}`)]) {
      assert(!details.includes(`SCAN ${name} `), details)
      assert(details.includes(`SEARCH ${name} `), details)
    }
  }
})
test('gathered components retain their values under stale statistics', () => {
  let rows = get(fixture.d, vocab, ['e0', 'e3', 'e4', 'e8'], {}, facets)
  assertEquals(rows.length, 4)
  assertEquals(rows, gathered)
  assert(rows.some((row) => row.entity.eid == 'e4' && row.result))
})

get(fixture.d, vocab, ['e8'], {}, ['doc'])
test('a keyed component read preserves JSON, booleans and nulls', () => {
  assertEquals(get(fixture.d, vocab, ['e8'], {}, ['doc'])[0].doc, {
    title: 'small statistics needle',
    enabled: false,
    metadata: { labels: ['"quoted"', null] },
    boxed: 'string',
  })
})

test('FTS selected doc reads seek matching documents', () => {
  let f = fields(vocab), extension = search(f)
  let stmt = all('needle', extension)
  assert(fixture.d.query(stmt).length > 0)
  noScan(stmt, 'entity')
  noScan(stmt, 'doc')
})
test('FTS reads return the matching document under stale statistics', () => {
  let f = fields(vocab)
  let found = read(fixture.d, vocab, 'needle', { extend: [search(f)] })
  assertEquals(found.map((row) => row.entity.eid), ['e8'])
})
