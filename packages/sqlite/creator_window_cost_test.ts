// A window of one actor's creations is one seek of `created(by, at)`, however
// much that actor made before it: the box's busiest actor owns half a million
// rows, and a `by` index alone read every one to keep a day's worth.
import { equal, ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([archetypeDoc, provenanceDoc, {
  $defs: { note: { component: true, type: 'object' } },
}])

let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
s.raise()
let made = (eid: string, at: string) => ({
  entity: { eid },
  note: {},
  created: { by: 'busy', at },
})
s.tx((tx) =>
  tx.patch([
    { entity: { eid: 'busy' } },
    ...Array.from({ length: 2000 }, (_, i) =>
      made(`old-${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`)),
    made('today', '2026-11-20T12:00:00Z'),
  ])
)
s.rows('.note')
let window = compile(
  parse(
    '.note .created.by=busy .created.at>=2026-11-20 .created.at<2026-11-21',
  ),
  vocab,
  { archetypes: catalog(driver) },
)
driver.query(window)

test("a window of an actor's creations costs nothing for what it made before", () => {
  let before = steps()
  let rows = driver.query(window)
  let cost = steps() - before
  equal(rows.map((r) => r.eid), ['today'])
  ok(cost < 2000, `${cost} VM steps beside 2,000 earlier creations`)
})
