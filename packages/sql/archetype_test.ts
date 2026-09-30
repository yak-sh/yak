import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { Archetypes } from '@yaks/archetype'
import { absent, and, or, parse, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { archetypeSet, bind, compile, isRaw } from './mod.ts'

let v = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    task: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
    },
    claim: {
      component: true,
      type: 'object',
    },
  },
})
let cache = new Archetypes()
let ids = new Map([
  [cache.intern([]).eid, 10],
  [cache.intern(['doc']).eid, 11],
  [cache.intern(['doc', 'task']).eid, 12],
  [cache.intern(['task', 'claim']).eid, 13],
])
let archetypes = archetypeSet(cache, ids)

test('archetype plans: facets/kinds use the spine, only values add joins', () => {
  for (
    let [query, expected] of [
      ['.task', [12, 13]],
      ['.doc', [11, 12]],
      ['!claim', [10, 11, 12]],
      ['.kind=doc', [11]],
      ['.kind=tasks', [12, 13]],
    ] as const
  ) {
    let r = bind(parse(query), v, { archetypes })
    let sql = compile(parse(query), v, { archetypes })
    assertEquals(r.joins, [], query)
    assert(sql.sql.includes('"entity"."archetype" in ('), sql.sql)
    assertEquals(
      sql.params.map((p) => JSON.parse(String(p))),
      [[...expected]],
      query,
    )
  }
  let r = bind(parse('.task .doc !claim .title=hello'), v, { archetypes })
  assertEquals(r.joins?.map((j) => isRaw(j.src) && j.src.sql), ['"doc"'])
  assertEquals(bind(parse('?doc'), v, { archetypes }).joins, [])
  let empty = archetypeSet(new Archetypes(), new Map())
  assertEquals(compile(parse('.doc'), v, { archetypes: empty }).params, [])
  assert(compile(parse('.doc'), v, { archetypes: empty }).sql.includes('0'))
})

test('archetype matching caches content, not a rolled-back id assignment', () => {
  assertEquals(archetypes({ all: ['task'], none: ['claim'] }), [12])
  let learned = cache.intern(['doc', 'claim'])
  let next = archetypeSet(cache, new Map([[learned.eid, 12]]))
  assertEquals(next({ all: ['task'] }), [])
  assertEquals(next({ all: ['claim'] }), [12])
  assertEquals(archetypes({ all: ['task'] }), [12, 13])
})

test('boolean presence trees retain their composition without component joins', () => {
  let ast = and(or(present('doc'), present('task')), absent('claim'))
  let r = bind(ast, v, { archetypes })
  assertEquals(r.joins, [])
  let sql = compile(ast, v, { archetypes })
  assert(sql.sql.includes(' or '), sql.sql)
  assertEquals(sql.params.map((p) => JSON.parse(String(p))), [
    [11, 12],
    [12, 13],
    [10, 11, 12],
  ])
})

// A conjunction of facets is one question, not one per facet. `.kind=K`
// expands to K present and every earlier kind absent, and a list per facet
// bound kinds × archetypes parameters — 20,228 on the fleet graph, past V8's
// spread and SQLite's variable ceiling (T-37437).
test('an AND of facets binds one archetype list, not one per facet', () => {
  let ids = (q: string): number[] =>
    JSON.parse(String(compile(parse(q), v, { archetypes }).params[0] ?? '[]'))
  let sql = compile(parse('.task .doc !claim'), v, { archetypes })
  assertEquals(
    JSON.parse(String(sql.params[0])),
    ids('.task').filter((x) =>
      ids('.doc').includes(x) && ids('!claim').includes(x)
    ),
  )
  assertEquals(sql.sql.split('"entity"."archetype" in (').length - 1, 1)
  assertEquals(bind(parse('.task .doc !claim'), v, { archetypes }).joins, [])
  // A facet beside a value keeps the value's own join and its parameter.
  let mixed = compile(parse('.task !claim .title=hello'), v, { archetypes })
  assertEquals(mixed.params, ['[12]', 'hello'])
})

// A status ladder's filter is the presence tests it means, so it is answered
// by the archetype index rather than by a `case` evaluated for every row.
test('a status filter on a ladder binds as a lookup on the archetype index', () => {
  let v = loadVocab([
    {
      $defs: {
        task: {
          component: true,
          type: 'object',
          status: {
            cancelled: 'cancelled',
            completed: 'done',
            default: 'open',
          },
        },
        cancelled: { component: true, type: 'object' },
        completed: { component: true, type: 'object' },
        claim: { component: true, type: 'object' },
        doc: { component: true, type: 'object' },
      },
    },
    {
      $defs: {
        task: { component: true, extends: true, status: { claim: 'wip' } },
      },
    },
  ])
  let cache = new Archetypes()
  let ids = new Map([
    [cache.intern(['task']).eid, 11],
    [cache.intern(['task', 'completed']).eid, 12],
    [cache.intern(['task', 'claim']).eid, 13],
    [cache.intern(['task', 'cancelled', 'completed']).eid, 14],
    [cache.intern(['task', 'claim', 'completed']).eid, 15],
    [cache.intern(['doc', 'completed']).eid, 16],
    [cache.intern(['doc', 'task']).eid, 17],
  ])
  let archetypes = archetypeSet(cache, ids)
  let chosen = (q: string) => {
    let sql = compile(parse(q), v, { archetypes })
    assertEquals(bind(parse(q), v, { archetypes }).joins, [], q)
    assert(!sql.sql.includes('case'), sql.sql)
    return sql.params.flatMap((p) => JSON.parse(String(p))).sort()
  }
  assertEquals(chosen('.task.status=open'), [11, 17])
  assertEquals(chosen('.task.status=done'), [12, 15])
  assertEquals(chosen('.status=wip'), [13])
  assertEquals(chosen('.task.status=cancelled'), [14])
  assertEquals(chosen('.status=open,wip'), [11, 13, 17])
  // beside another presence test, still one lookup
  assertEquals(chosen('.doc .task.status=open'), [17])
  // a status no rung gives reads the `case`, and finds what it finds
  assert(compile(parse('.status=gone'), v, { archetypes }).sql.includes('case'))
})
