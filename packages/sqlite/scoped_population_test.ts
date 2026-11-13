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
// The tally a scope reads through the populations, and how its statement
// plans.
let tallied = (opts: Parameters<typeof rows>[3]) => {
  statements.length = 0
  let got = rows(driver, tallyVocab, '.tally=entity.archetype', {
    ...opts,
    archetypes: fixture.catalog,
  })
  let query = statements.findLast((s) =>
    render(s).sql.includes('__tally_groups')
  )!
  return {
    got,
    sql: render(query).sql,
    scans: d.query({ t: 'explain query plan', of: query })
      .some((r) => /SCAN entity|SCAN __.*entity/.test(String(r.detail))),
  }
}
let actual = tallied(tallyScope)
test('scoped public population tally preserves private owner counts', () =>
  equal(actual.got, expected))
test('scoped public population tally does not scan public owners', () => {
  ok(actual.sql.includes('_yaks_population'))
  ok(!actual.scans)
})
// A reader's privacy, as @yaks/member keeps it: a floor on a few owners.
let floor = { visibility: { entity: '!apply_receipt&(!draft|!draft.floor)' } }
let floored = tallied(floor)
test('a floored scope reads populations and only its floored owners', () => {
  equal(floored.got, rows(d, tallyVocab, '.tally=entity.archetype', floor))
  ok(floored.sql.includes('_yaks_population'))
  ok(!floored.scans)
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
