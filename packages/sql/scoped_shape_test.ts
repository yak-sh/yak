// Classified owner selection can prove local policies while references retain
// their own visibility; unsupported policies still use ordinary scoped reads.
import { equal, ok, test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { stepping } from '../sqlite/testing.ts'
import { type BindOpts, col, compile, eq, val } from './mod.ts'
import { ownerVocab as vocab, seedOwners } from './owner_fixture_test.ts'

let { driver, steps } = stepping()
let catalog = seedOwners(driver)
driver.query({
  t: 'create index',
  name: 'entity_archetype_num',
  on: 'entity',
  cols: [col('archetype'), col('num'), col('id')],
})
driver.query({
  t: 'update',
  table: 'post',
  set: { author: val(2) },
  where: eq(col('entity'), val(1)),
})
driver.query({
  t: 'update',
  table: 'post',
  set: { author: val(99999) },
  where: eq(col('entity'), val(1000)),
})
let line = '.post !comment .fields=post.title,post.author'
let cases: [string, string, BindOpts][] = [
  ['presence policy', line, { visibility: { entity: '!blocked' } }],
  ['hidden roots', line, { visibility: { entity: '.blocked' } }],
  ['nested presence policy', line, {
    visibility: { entity: '(!blocked&!comment)' },
  }],
  ['no presence predicate', '.fields=entity.eid', {
    visibility: { entity: '!blocked' },
  }],
  ['property policy', line, { visibility: { entity: '.post.title~=target' } }],
  ['alternating policy', line, {
    visibility: { entity: '!blocked|.entity.eid=closed' },
  }],
  ['empty policy', line, {
    visibility: { entity: { kind: 'and', clauses: [] } },
  }],
  ['masked property', line, {
    visibility: {
      entity: '!blocked',
      components: { post: '.entity.eid=target' },
    },
  }],
  ['masked policy component', line, {
    visibility: {
      entity: '!blocked',
      components: { blocked: '.entity.eid=none' },
    },
  }],
  ['incomplete catalog', line, {
    visibility: { entity: '!blocked' },
    archetypes: Object.assign(
      (p: Parameters<typeof catalog>[0]) =>
        p.none?.includes('tombstone') ? undefined : catalog(p),
      { held: true },
    ),
  }],
]
for (let [name, query, options] of cases) {
  let ordinary = driver.query(
    compile(parse(query), vocab, { ...options, archetypes: undefined }),
  )
  let actual = driver.query(compile(parse(query), vocab, {
    archetypes: catalog,
    ...options,
  }))
  test(`shape admission preserves ${name}`, () => equal(actual, ordinary))
}
let selected = driver.query(compile(parse(line), vocab, {
  visibility: { entity: '!blocked' },
  archetypes: catalog,
}))
test('shape-admitted roots still hide referenced targets and missing references', () => {
  equal(selected.filter((r) => r.eid == 'closed' || r.eid == 'grave'), [])
  equal(selected.find((r) => r.eid == 'target')?.['post.author'], null)
  equal(selected.find((r) => r.eid == 'unrelated-0')?.['post.author'], null)
})
let statement = compile(parse(line), vocab, {
  visibility: { entity: '!blocked' },
  archetypes: catalog,
})
driver.query(statement)
let at = steps(), rows = driver.query(statement), cost = steps() - at
test('shape-admitted owners do not repeat presence policy checks', () => {
  equal(rows, selected)
  ok(cost < 5000, `${cost} VM steps for ${rows.length} visible owners`)
})
