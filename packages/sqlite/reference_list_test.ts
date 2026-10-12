// Reference operands remain literal identities when lowered as a bounded
// values relation, including quotes, missing targets and pending identities.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { and, eq, list, ne, present } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { mem } from './testing.ts'
import { overlay } from './overlay.ts'
import { match } from '@yaks/graph'
import { matched } from './rules.ts'

let vocab = loadVocab({
  $defs: {
    player: { component: true },
    look: {
      component: true,
      properties: { player: { type: 'string', ref: 'entity', index: true } },
    },
  },
})
let sql = mem(), store = storage(sql, vocab)
store.install()
let stored = graph({ vocab, storage: store })
let memory = graph({ vocab, storage: ram(vocab) })
let names = [
  'ordinary',
  "O'Reilly",
  "x'); drop table entity; --",
  'back\\slash',
  'λ🦋',
  'part,one',
  'part..two',
  'line\nbreak',
  'nul\0inside',
]
let bundles = [
  ...names.map((eid) => ({ entity: { eid }, player: {} })),
  ...names.map((player, i) => ({
    entity: { eid: `look-${i}` },
    look: { player },
  })),
  { entity: { eid: 'no-player' }, look: {} },
]
for (let g of [stored, memory]) g.apply(bundles)
let ids = (rows: { entity: { eid: string } }[]) =>
  rows.map((r) => r.entity.eid).sort()
let cases = [
  names.slice(0, 8),
  [names[1], names[1], 'missing'],
  [],
  ['missing', 'also-missing'],
  [names[8], 'missing'],
  [...Array.from({ length: 101 }, (_, i) => `missing-${i}`), names[1]],
  ['🦋'.repeat(1100), names[1]],
]
for (let [i, values] of cases.entries()) {
  for (let compare of [eq, ne]) {
    let query = and(present('look'), compare('look.player', list(...values)))
    let expected = ids(await memory.read(query))
    test(`reference list membership case ${i}, ${compare == eq ? 'equal' : 'unequal'}`, () => {
      equal(store.rows(query).map((r) => String(r.eid)).sort(), expected)
    })
  }
}
let over = overlay(sql, vocab, [
  { entity: { eid: 'm1' }, player: {} },
  { entity: { eid: 'pending-look' }, look: { player: 'm1' } },
])
let pending = () =>
  matched(
    sql,
    match('.look.player=m1,missing'),
    vocab,
    {},
    { at: over.at },
    over.with,
  )
pending()
test('a reference list resolves pending identities through its overlay', () => {
  equal(
    pending().map((b) => String(b.entities[0])),
    ['pending-look'],
  )
})
