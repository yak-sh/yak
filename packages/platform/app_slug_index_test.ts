import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { seed, stepping } from '@yaks/sqlite/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { platformDoc } from './vocab.ts'

let words = pick(platformDoc, ['app'])
let before = structuredClone(words)
delete before.$defs!.app.properties!.slug.index
let stamps = {
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    created: { component: true, properties: { at: { type: 'string' } } },
  },
}
let { driver, steps } = stepping()
let previous = storage(driver, loadVocab([stamps, before]), { number: true })
previous.install()
let created = { at: '2026-11-20T10:00:00Z' }
seed(previous, [
  ...Array.from({ length: 2400 }, (_, i) => ({
    entity: { eid: `row-${i}`, num: i + 1 },
    created,
  })),
  ...['first', 'second'].map((eid, i) => ({
    entity: { eid, num: 2401 + i },
    app: { slug: 'recipes' },
    created,
  })),
  { entity: { eid: 'other' }, app: { slug: 'notes' }, created },
])

let store = storage(driver, loadVocab([stamps, words]), {
  number: true,
  counts: 'lazy',
})
store.install()

test('a slug-only lookup seeks into an existing directory', async () => {
  let start = steps()
  let rows = await store.rows('.created&.app.slug=recipes')
  let cost = steps() - start
  equal(rows.map((row) => row.eid), ['first', 'second'])
  ok(cost < 500, `${cost} VM steps for ${rows.length} matching apps`)
})
