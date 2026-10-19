// Reference absence must not enumerate unrelated archetypes to reject a leaf.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { Archetypes } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { archetypeSet, compile, insert } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    doc: {
      component: true,
      properties: { via: { type: 'string', ref: 'entity' } },
    },
    session: { component: true, properties: {} },
    hidden: { component: true, properties: {} },
  },
})
let db = new Database(':memory:'), sql = driver(db)
let cache = new Archetypes(), ids = new Map<string, number>()
for (let n = 0; n < 1024; n++) {
  let tables = Array.from({ length: 10 }, (_, i) => i)
    .filter((i) => n & (1 << i)).map((i) => `shape${i}`)
  ids.set(cache.intern(tables).eid, n + 100)
}
ids.set(cache.intern(['session']).eid, 2000)
for (let name of ['entity', 'doc', 'session', 'hidden', 'tombstone']) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: name == 'entity' ? 'id' : 'entity', type: 'integer', pk: true },
      ...name == 'entity'
        ? [
          { name: 'eid', type: 'text' as const },
          { name: 'num', type: 'integer' as const },
          { name: 'archetype', type: 'integer' as const },
        ]
        : name == 'doc'
        ? [{ name: 'via', type: 'integer' as const }]
        : [],
    ],
  })
}
for (let id = 1; id <= 6; id++) {
  sql.query(insert('entity', {
    id,
    eid: `r${id}`,
    num: id,
    archetype: id == 1 ? 2000 : 100,
  }))
}
sql.query(insert('session', { entity: 1 }))
sql.query(insert('hidden', { entity: 6 }))
for (let [entity, via] of [[3, 1], [4, 2], [5, null], [6, 99]]) {
  sql.query(insert('doc', { entity, via }))
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let scopes = [
  ['visible', undefined, ['r4', 'r5', 'r6']],
  ['hidden owner', { entity: '!hidden' }, ['r4', 'r5']],
  ['hidden leaf', { components: { session: '.entity.eid!=r1' } }, [
    'r3',
    'r4',
    'r5',
    'r6',
  ]],
] as const
for (let [name, visibility, expected] of scopes) {
  let q = compile(parse('.doc !doc.via.session .fields=entity.eid'), vocab, {
    archetypes: archetypeSet(cache, ids),
    visibility,
  })
  test(`reference absence preserves ${name} and missing targets in a large catalog`, () => {
    let stmt = db.prepare(q.sql)
    try {
      equal(stmt.all(...q.params).map((r) => r.eid), [...expected])
      let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      ok(steps < 500, `${steps} VM steps`)
    } finally {
      stmt.finalize()
    }
  })
}
