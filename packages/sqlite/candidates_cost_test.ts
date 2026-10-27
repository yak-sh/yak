// The entities a read names as its candidates (`eids`) drive it, one lookup
// each: naming four times as many costs four times as much, ordered and paged
// as a transcript's newest-first lookup asks, under a visibility scope.
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ok, test } from '@yaks/testing'
import { stepping } from './testing.ts'
import { storage } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entry: {
      component: true,
      properties: {
        session: { type: 'string', ref: 'entity' },
        seq: { type: 'integer' },
      },
    },
    hidden: { component: true },
    sending: { component: true },
  },
})
let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
let g = graph({
  storage: s,
  vocab,
  plugins: [{ name: 'scope', scope: () => ({ entity: '!hidden' }) }],
})
let eids = Array.from({ length: 2000 }, (_, i) => `line-${i}`)
await s.tx((tx) =>
  tx.patch(eids.map((eid, i) => ({
    entity: { eid },
    entry: { session: 'S', seq: i + 1 },
  })))
)
let cost = async (n: number) => {
  let before = steps()
  await g.rows(
    '.entry.session=S&.sending&.order=-entry.seq&.limit=1&.fields=entity.eid',
    { eids: eids.slice(0, n) },
  )
  return steps() - before
}
let few = await cost(500), many = await cost(2000)

test('a read naming 2,000 candidates costs four times one naming 500', () =>
  ok(many < few * 6, `${many} steps naming 2,000, ${few} naming 500`))
