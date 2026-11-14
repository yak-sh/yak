import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { rulesIn } from './rules.ts'
import { loadVocab } from './vocab.ts'
import { storable } from './validate.ts'
import { meta } from './testing.ts'

let doc = {
  $defs: {
    entity: { component: true, wire: false, properties: {} },
    call: { component: true, properties: {} },
    settle: {
      rule: true,
      description: 'every call gets a result',
      match: '$c .call, results=; +result.call=$c',
      before: ['sweep'],
    },
    listing: { rule: true, match: '.call, +!seen' },
  },
}

test('a rule declaration is a name, a query, and what it runs before', () => {
  assertEquals(rulesIn(doc), [
    {
      name: 'settle',
      match: '$c .call, results=; +result.call=$c',
      before: ['sweep'],
      description: 'every call gets a result',
    },
    { name: 'listing', match: '.call, +!seen' },
  ])
})

test('loadVocab passes over a rule, and plants no table for it', () => {
  let v = loadVocab(doc)
  assertEquals(v.all.includes('settle'), false)
  assertEquals(v.all.sort(), ['call', 'entity'])
})

test('a rule with no match is a declaration that says nothing', () => {
  assertThrows(
    () => rulesIn({ $defs: { broke: { rule: true } } }),
    Error,
    'declares no match',
  )
})

test('a rule declaration validates as one', () => {
  let { check } = meta()
  assertEquals(check(doc), true)
  // The storable profile passes over it: a rule plants no table.
  assertEquals(storable(doc), [])
  // An entry cannot be two things at once.
  assertEquals(
    check({ $defs: { both: { rule: true, component: true, match: '.call' } } }),
    false,
  )
  // Nor can it declare a word the rule shape does not have.
  assertEquals(
    check({ $defs: { r: { rule: true, match: '.call', noun: 'x' } } }),
    false,
  )
})

let kinds = (k: Record<string, unknown>) => rulesIn({ kinds: k } as never)

test("a kind's `with` values are the rules that complete it", () => {
  assertEquals(
    kinds({
      design: { with: { doc: true, proposed: {} } },
      product: { with: { shelf: { aisle: 'Z', bay: 3 } } },
      decision: { is: ['task', 'decision'], with: { open: { note: 'a, b' } } },
    }),
    [
      {
        name: 'design.proposed',
        match: '.design, +!proposed',
        description: 'a design carries proposed',
      },
      {
        name: 'product.shelf',
        match: '.product, +!shelf, +shelf.aisle=Z, +shelf.bay=3',
        description: 'a product carries shelf',
      },
      {
        name: 'decision.open',
        match: '.task, .decision, +!open, +open.note="a, b"',
        description: 'a decision carries open',
      },
    ],
  )
  // `true` is the writer's to supply: no rule
  assertEquals(kinds({ task: { with: { doc: true } } }), [])
})

test('a kind gives no value a rule cannot write', () => {
  for (let v of [{ x: 1 }, [1], null, '$x', '#Now']) {
    assertThrows(
      () => kinds({ p: { with: { shelf: { aisle: v } } } }),
      Error,
      "kind 'p' gives shelf.aisle a value no rule can write",
    )
  }
  assertThrows(
    () =>
      rulesIn([{ kinds: { p: { with: { s: {} } } } }, {
        kinds: { p: { with: { s: {} } } },
      }]),
    Error,
    "rule 'p.s' is declared twice",
  )
})
