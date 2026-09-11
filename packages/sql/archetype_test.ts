import { assert, assertEquals } from '@std/assert'
import { Archetypes } from '@yaks/archetype'
import { absent, and, or, parse, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { archetypeSet, bind, compile } from './mod.ts'

let v = loadVocab({
  $defs: {
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    task: { type: 'object', kind: true, before: ['doc'] },
    claim: { type: 'object' },
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

Deno.test('archetype plans: facets/kinds use the spine, only values add joins', () => {
  for (
    let [query, expected] of [
      ['.task', [12, 13]],
      ['.doc!', [11, 12]],
      ['!.claim', [10, 11, 12]],
      ['.kind=doc', [11]],
      ['.kind=tasks', [12, 13]],
    ] as const
  ) {
    let r = bind(parse(query), v, { archetypes })
    let sql = compile(parse(query), v, { archetypes })
    assertEquals(r.joins, [], query)
    assert(sql.sql.includes('"entity"."archetype" in ('), sql.sql)
    assertEquals(sql.params, [...expected], query)
  }
  let r = bind(parse('.task .doc! !.claim .title=hello'), v, { archetypes })
  assertEquals(r.joins.map((j) => j.source), ['"doc"'])
  assertEquals(bind(parse('?doc'), v, { archetypes }).joins, [])
  let empty = archetypeSet(new Archetypes(), new Map())
  assertEquals(compile(parse('.doc!'), v, { archetypes: empty }).params, [])
  assert(compile(parse('.doc!'), v, { archetypes: empty }).sql.includes('0'))
})

Deno.test('archetype matching caches content, not a rolled-back id assignment', () => {
  assertEquals(archetypes({ all: ['task'], none: ['claim'] }), [12])
  let learned = cache.intern(['doc', 'claim'])
  let next = archetypeSet(cache, new Map([[learned.eid, 12]]))
  assertEquals(next({ all: ['task'] }), [])
  assertEquals(next({ all: ['claim'] }), [12])
  assertEquals(archetypes({ all: ['task'] }), [12, 13])
})

Deno.test('boolean presence trees retain their composition without component joins', () => {
  let ast = and(or(present('doc'), present('task')), absent('claim'))
  let r = bind(ast, v, { archetypes })
  assertEquals(r.joins, [])
  let sql = compile(ast, v, { archetypes })
  assert(sql.sql.includes(' or '), sql.sql)
  assertEquals(sql.params, [11, 12, 12, 13, 10, 11, 12])
})

// A conjunction of facets is one question, not one per facet. `.kind=K`
// expands to K present and every earlier kind absent, and a list per facet
// bound kinds × archetypes parameters — 20,228 on the fleet graph, past V8's
// spread and SQLite's variable ceiling (T-37437).
Deno.test('an AND of facets binds one archetype list, not one per facet', () => {
  let ids = (q: string) => compile(parse(q), v, { archetypes }).params
  let sql = compile(parse('.task .doc! !.claim'), v, { archetypes })
  assertEquals(
    sql.params,
    ids('.task').filter((x) =>
      ids('.doc!').includes(x) && ids('!.claim').includes(x)
    ),
  )
  assertEquals(sql.sql.split('"entity"."archetype" in (').length - 1, 1)
  assertEquals(bind(parse('.task .doc! !.claim'), v, { archetypes }).joins, [])
  // A facet beside a value keeps the value's own join and its parameter.
  let mixed = compile(parse('.task !.claim .title=hello'), v, { archetypes })
  assertEquals(mixed.params, [12, 'hello'])
})
