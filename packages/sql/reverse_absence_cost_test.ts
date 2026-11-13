// A reverse association's presence or absence is tested on each candidate's
// own key, before the scoped spine reads the owner for its visibility.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { equal, ok, test } from '@yaks/testing'
import { Archetypes } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { archetypeSet, col, compile, insert } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    call: { component: true, properties: {} },
    execution: { component: true, properties: {} },
    tool_async: { component: true, properties: {} },
    hidden: { component: true, properties: {} },
    result: {
      component: true,
      properties: { call: { type: 'string', ref: 'entity' } },
    },
  },
})
let db = new Database(':memory:'), sql = driver(db)
let cache = new Archetypes(), ids = new Map<string, number>()
ids.set(cache.intern(['call', 'execution']).eid, 1)
ids.set(cache.intern(['call', 'execution', 'hidden']).eid, 2)
ids.set(cache.intern(['result']).eid, 3)
ids.set(cache.intern(['call', 'execution', 'tool_async']).eid, 4)
for (
  let name of [
    'entity',
    'call',
    'execution',
    'tool_async',
    'hidden',
    'tombstone',
    'result',
  ]
) {
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
        : name == 'result'
        ? [{ name: 'call', type: 'integer' as const }]
        : [],
    ],
  })
}
sql.query({
  t: 'create index',
  name: 'entity_archetype_num',
  on: 'entity',
  cols: [col('archetype'), col('num')],
})
sql.query({
  t: 'create index',
  name: 'result_call',
  on: 'result',
  cols: [col('call')],
})
// A thousand claimed calls, every one answered but c6 (run by its own
// effect), c7, c8 (hidden) and c9 (dead).
let CALLS = 1000
for (let id = 1; id <= CALLS; id++) {
  sql.query(
    insert('entity', {
      id,
      eid: `c${id}`,
      num: id,
      archetype: id == 8 ? 2 : id == 6 ? 4 : 1,
    }),
  )
  sql.query(insert('call', { entity: id }))
  sql.query(insert('execution', { entity: id }))
  if (id == 6) sql.query(insert('tool_async', { entity: id }))
  if (id == 8) sql.query(insert('hidden', { entity: id }))
  if (id == 9) sql.query(insert('tombstone', { entity: id }))
  if (id >= 6 && id <= 9) continue
  let r = CALLS + id
  sql.query(insert('entity', { id: r, eid: `r${id}`, num: r, archetype: 3 }))
  sql.query(insert('result', { entity: r, call: id }))
}
let HELD = '.call .execution !results !tool_async'
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
// What a query answers, and how many VM steps the statement took.
let run = (q: string, visibility?: { entity: string }) => {
  let c = compile(parse(`${q} .fields=entity.eid`), vocab, {
    archetypes: archetypeSet(cache, ids),
    visibility,
  })
  let stmt = db.prepare(c.sql)
  try {
    let eids = stmt.all(...c.params).map((r) => r.eid)
    return {
      eids,
      steps: status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
    }
  } finally {
    stmt.finalize()
  }
}

for (
  let [name, visibility, expected] of [
    ['visible', undefined, ['c7', 'c8']],
    ['hidden owner', { entity: '!hidden' }, ['c7']],
  ] as const
) {
  test(`a reverse absence keeps the unanswered ${name} calls`, () =>
    equal(run(HELD, visibility).eids, [...expected]))
}
test('a reverse absence filters candidates before reading each owner', () => {
  // Read for its visibility before its results are probed, each answered
  // call costs 44 steps; probed first, 34.
  let { steps } = run(HELD, { entity: '!hidden' })
  ok(steps < 40 * CALLS, `${steps} VM steps`)
})
test('a reverse presence keeps the answered calls', () => {
  let { eids } = run('.call .execution .results', { entity: '!hidden' })
  equal(eids.length, CALLS - 4)
  ok(!eids.includes('c7') && !eids.includes('c9'))
})
