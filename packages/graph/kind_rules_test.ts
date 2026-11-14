import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab, rulesIn, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './mod.ts'
import { ready, settle } from './declared.ts'
import type { Bundle, Match } from './mod.ts'

let doc: VocabDoc = {
  $defs: {
    design: { component: true },
    proposed: { component: true, properties: { note: { type: 'string' } } },
    shelf: {
      component: true,
      properties: { aisle: { type: 'string' }, bay: { type: 'number' } },
    },
    product: { component: true },
    note: { component: true, properties: { title: { type: 'string' } } },
  },
  kinds: {
    design: { with: { proposed: {} } },
    product: {
      with: { note: true, shelf: { aisle: 'Aisle 9, east', bay: 3 } },
    },
  },
}
let vocab = loadVocab(doc)
let fresh = () => graph({ vocab, storage: ram(vocab), provenance: false })
let wrote = (b: Record<string, unknown>) =>
  (fresh().apply([{ entity: { eid: 'e' }, ...b }]) as Bundle[])[0]

test("a write of a kind's `is` comes out whole", () => {
  assertEquals(wrote({ design: {} }).proposed, {})
  assertEquals(wrote({ product: {} }).shelf, { aisle: 'Aisle 9, east', bay: 3 })
  // what the writer gave stands
  assertEquals(wrote({ design: {}, proposed: { note: 'mine' } }).proposed, {
    note: 'mine',
  })
  // a `true` entry is the writer's: nothing adds a note
  assertEquals(wrote({ product: {} }).note, undefined)
})

// Forty more kinds, each completed with a proposal.
let part = (i: number) =>
  `part${String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26)}`
let parts = Array.from({ length: 40 }, (_, i) => part(i))
let wide = loadVocab([doc, {
  $defs: Object.fromEntries(parts.map((p) => [p, { component: true }])),
  kinds: Object.fromEntries(
    parts.map((p) => [p, { with: { proposed: {} } }]),
  ),
}])
let rules = ready(rulesIn(wide.docs))
let storage = ram(wide)
// How many plans a batch asks the storage to evaluate.
let evaluated = (batch: Bundle[]) => {
  let n = 0
  storage.tx((tx) =>
    settle(rules, batch, {
      ...tx,
      bindings: (plans: Match[], ...args) => {
        n += plans.length
        return tx.bindings!(plans, args[0])
      },
    }, wide)
  )
  return n
}

test('a batch that names no `is` component evaluates no kind rule', () => {
  assertEquals(evaluated([{ entity: { eid: 'n' }, note: { title: 'x' } }]), 0)
  assertEquals(evaluated([{ entity: { eid: 'd' }, partab: {} }]) > 0, true)
})
