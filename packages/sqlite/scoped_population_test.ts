// Whole scoped tallies read stored public populations and only sparse private
// owners; incomplete catalogs and masking must still use the ordinary reader.
import { equal, ok, test } from '@yaks/testing'
import { open } from './db.ts'
import { population } from './population.ts'
import { rows } from './read.ts'
import { compile, type Driver, render, type Stmt } from '@yaks/sql'
import { parse } from '@yaks/query/core'
import {
  seedTallies,
  tallyScope,
  tallyVocab,
} from '../sql/scoped_tally_fixture_test.ts'
let d = open(':memory:')
let fixture = seedTallies(d, 128)
let expected = rows(d, tallyVocab, '.tally=entity.archetype', {
  ...tallyScope,
  archetypes: fixture.catalog,
})
population(d)
let statements: Stmt[] = []
let driver: Driver = {
  ...d,
  query: (s) => {
    statements.push(s)
    return d.query(s)
  },
}
let actual = rows(driver, tallyVocab, '.tally=entity.archetype', {
  ...tallyScope,
  archetypes: fixture.catalog,
})
let query = statements.findLast((s) =>
  render(s).sql.includes('__tally_groups')
)!
let plan = d.query({ t: 'explain query plan', of: query })
test('scoped public population tally preserves private owner counts', () =>
  equal(actual, expected))
test('scoped public population tally does not scan public owners', () => {
  let sql = render(query).sql
  ok(sql.includes('_yaks_population'))
  ok(!plan.some((r) => /SCAN entity|SCAN __.*entity/.test(String(r.detail))))
})
let hidden = rows(d, tallyVocab, '.tally=entity.archetype', {
  visibility: { entity: '!archetype&(!draft|.draft.by=reader)' },
  archetypes: fixture.catalog,
})
test('population tally still screens hidden descriptor references', () =>
  equal(hidden, []))
let incomplete = Object.assign(
  (p: Parameters<typeof fixture.catalog>[0]) =>
    p.all?.includes('draft') ? undefined : fixture.catalog(p),
  { held: true },
)
let fallback = rows(d, tallyVocab, '.tally=entity.archetype', {
  ...tallyScope,
  archetypes: incomplete,
})
test('incomplete population catalog falls back without authorizing private owners', () =>
  equal(fallback, expected))
let masked = {
  ...tallyScope,
  visibility: {
    ...tallyScope.visibility,
    components: { note: '.entity.eid=mine' },
  },
}
let maskedActual = rows(d, tallyVocab, '.tally=entity.archetype', {
  ...masked,
  archetypes: fixture.catalog,
})
let maskedExpected = d.query(
  compile(parse('.tally=entity.archetype'), tallyVocab, masked),
)
test('component masks retain ordinary scoped tally semantics', () =>
  equal(maskedActual, maskedExpected))
