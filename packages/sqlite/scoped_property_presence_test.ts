// A session's provider check probes its entries, regardless of how much
// provider and imported-line history other sessions hold.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let comp = (properties = {}, index?: string[][]) => ({
  component: true,
  type: 'object',
  properties,
  ...index ? { index } : {},
})
let ref = { type: 'string', ref: 'entity' }
let vocab = loadVocab({
  $defs: {
    entry: comp({ session: ref, seq: { type: 'integer' } }, [[
      'session',
      'seq',
    ]]),
    using: comp({ provider: ref }),
    lines: comp(),
    hidden: comp(),
  },
})
let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
seed(s, [
  ...['target', 'other', 'provider', 'missing'].map((eid) => ({
    entity: { eid },
  })),
  {
    entity: { eid: 'managed' },
    entry: { session: 'target', seq: 1 },
    using: { provider: 'provider' },
  },
  { entity: { eid: 'blank' }, entry: { session: 'target', seq: 2 }, using: {} },
  {
    entity: { eid: 'imported' },
    entry: { session: 'target', seq: 3 },
    using: { provider: 'provider' },
    lines: {},
  },
  ...Array.from({ length: 4000 }, (_, i) => ({
    entity: { eid: `history${i}` },
    entry: { session: 'other', seq: i },
    using: { provider: 'provider' },
    lines: {},
  })),
])

for (let visibility of [undefined, { entity: '!hidden' }]) {
  for (let session of ['target', 'missing']) {
    let q = `.entry.session=${session}&.using.provider&!lines&.limit=1`
    s.rows(q, { visibility })
    s.rows(q, { visibility })
    test(`${visibility ? 'scoped' : 'plain'} provider presence reads only ${session}'s entries`, () => {
      let before = steps()
      let rows = s.rows(q, { visibility })
      let cost = steps() - before
      equal(rows.map((r) => r.eid), session == 'target' ? ['managed'] : [])
      ok(cost < 2000, `${cost} VM steps`)
    })
  }
}
