/// <reference lib="deno.ns" />
// Transaction projections keep matching and visibility separate from gathering.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    summary: {
      component: true,
      properties: { value: { type: 'number', computed: true } },
    },
  },
}])
let computed = 0
let s = ram(vocab, {
  computed: { 'summary.value': () => (computed++, 7) },
})
s.tx((tx) =>
  tx.patch([{
    entity: { eid: 'one' },
    doc: { title: 'One' },
    summary: {},
  }])
)

test('transaction reads select components without gathering other computed values', () => {
  computed = 0
  let rows = s.tx((tx) => tx.read('.doc', undefined, []))
  assertEquals(rows, [{ entity: { eid: 'one' } }])
  assertEquals(computed, 0)
})

test('transaction read predicates still inspect unselected components', () => {
  let rows = s.tx((tx) => tx.read('.summary.value=7', undefined, ['doc']))
  assertEquals(rows[0].doc, { title: 'One' })
  assertEquals(rows[0].summary, undefined)
})

test('transaction read projection preserves visibility and whole defaults', () => {
  assertEquals(
    s.tx((tx) =>
      tx.read('.doc', { visibility: { entity: '.entity.eid=missing' } }, [])
    ),
    [],
  )
  assertEquals(s.tx((tx) => tx.read('.doc'))[0].summary, { value: 7 })
})
