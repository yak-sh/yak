import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './mod.ts'
import { ready, settle } from './declared.ts'
import type { Bundle, Match } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    input: { component: true, properties: {} },
    other: { component: true, properties: {} },
    output: { component: true, properties: {} },
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
})
let output = (rows: Bundle[]) => rows.some((b) => b.output != null)
let unrelated = Array.from({ length: 1000 }, (_, i) => ({
  name: `unrelated-${i}`,
  match: '.other, +!output',
}))
let rules = ready([...unrelated, { name: 'input', match: '.input, +!output' }])
let storage = ram(vocab)
storage.tx((tx) => tx.patch([{ entity: { eid: 'old' }, input: {} }]))
// Compile outside the measured test, like an already-running frame loop.
storage.tx((tx) =>
  settle(rules, [{ entity: { eid: 'warm' }, input: {} }], tx, vocab)
)

test('declared rules do not evaluate unrelated plans on a warm batch', () => {
  let evaluated = 0
  let out = storage.tx((tx) =>
    settle(
      rules,
      [{ entity: { eid: 'old' }, doc: { title: 'unrelated edit' } }],
      {
        ...tx,
        bindings: (plans: Match[], ...args) => {
          evaluated += plans.length
          return tx.bindings!(plans, args[0])
        },
      },
      vocab,
    )
  ) as Bundle[]
  assertEquals(output(out), true)
  // One eligible plan each round (including the quiescence check), not a
  // thousand unrelated queries. Budget the storage door, not elapsed time.
  assertEquals(evaluated, 2)
})

let scenario = (match: string) =>
  graph({
    vocab,
    storage: ram(vocab),
    provenance: false,
    plugins: [{ name: 'rules', declared: [{ name: 'r', match }] }],
  })
let joined = scenario('$a .input; $b !output, +!doc')
let absent = scenario('!input, +!output')
let gone = scenario('-input, +!output')
let chained = graph({
  vocab,
  storage: ram(vocab),
  provenance: false,
  plugins: [{
    name: 'rules',
    declared: [
      { name: 'a', match: '.input, +!other' },
      { name: 'b', match: '.other, +!output' },
    ],
  }],
})
joined.apply([{ entity: { eid: 'source' }, input: {}, output: {} }])
gone.apply([{ entity: { eid: 'removed' }, input: {}, output: {} }])

test('an unguarded join pattern can anchor a rule on a different entity', () => {
  let rows = joined.apply([{
    entity: { eid: 'target' },
    other: {},
  }]) as Bundle[]
  assertEquals(
    rows.some((b) => b.entity.eid == 'target' && b.doc != null),
    true,
  )
})
test('absence-only rules remain eligible', () => {
  assertEquals(
    output(
      absent.apply([{ entity: { eid: 'absent' }, other: {} }]) as Bundle[],
    ),
    true,
  )
})
test('a removed component can select its rule', () => {
  assertEquals(
    output(
      gone.apply([{
        entity: { eid: 'removed' },
        input: null,
        output: null,
      }]) as Bundle[],
    ),
    true,
  )
})
test('a rule output selects another rule in the same fixpoint', () => {
  assertEquals(
    output(
      chained.apply([{ entity: { eid: 'chain' }, input: {} }]) as Bundle[],
    ),
    true,
  )
})
