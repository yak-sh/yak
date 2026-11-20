import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { seed, stepping } from '@yaks/sqlite/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { platformDoc } from './vocab.ts'

let words = pick(platformDoc, ['app', 'written'])
let before = structuredClone(words)
delete before.$defs!.written.index
let numbered = {
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
  },
}

let { driver, steps } = stepping()
let previous = storage(driver, loadVocab([numbered, before]), {
  number: true,
})
previous.install()
let writes = Array.from({ length: 2400 }, (_, i) => ({
  // Numbers can arrive out of insert order in an imported history.
  entity: { eid: `write-${i}`, num: i + 3 - 2 * (i % 3) },
  written: {
    app: i % 2 ? 'notes' : 'recipes',
    by: i % 2 ? 'writer' : 'other',
    draft: i % 2 ? 'draft' : 'elsewhere',
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))).toISOString(),
  },
}))
seed(previous, [
  ...['notes', 'recipes', 'writer', 'other'].map((eid) => ({
    entity: { eid },
  })),
  ...writes,
])

let store = storage(driver, loadVocab([numbered, words]), {
  number: true,
  counts: 'lazy',
})
store.install()
let newest = writes.toSorted((a, b) =>
  b.written.at.localeCompare(a.written.at) || b.entity.num - a.entity.num
)

for (
  let [query, expected] of [
    ['.written&.order=-written.at&.limit=40', newest.slice(0, 40)],
    ['.written.app=notes&.order=-written.at&.limit=1&.written.at', [
      writes.at(-3)!,
    ]],
    ['.written.by=writer&.order=-written.at&.limit=1', [writes.at(-3)!]],
    ['.written.draft=draft&.order=written.at&.limit=1&.written.at', [
      writes[1],
    ]],
  ] as const
) {
  test(`${query} reads a page from an existing write history`, async () => {
    let start = steps()
    let rows = await store.rows(query)
    let cost = steps() - start
    equal(rows.map((row) => row.eid), expected.map((row) => row.entity.eid))
    ok(
      cost < 200 * rows.length + 500,
      `${cost} VM steps for ${rows.length} writes`,
    )
  })
}
