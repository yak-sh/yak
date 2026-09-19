// What a declared rule WRITES, and in what order rules run. The fixpoint and
// the refusal are exercised end to end over a real store (@yaks/sqlite's
// declared_test.ts); these are the pure halves.

import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { emitted, firing, ready } from './declared.ts'

let vocab = loadVocab([{
  $defs: {
    entity: { component: true, wire: false, properties: {} },
    call: { component: true, properties: {} },
    result: {
      component: true,
      properties: {
        call: { type: 'string', ref: 'call' },
        ms: { type: 'number' },
      },
    },
  },
}])

let one = (match: string) => ready([{ name: 'r', match }])[0]

Deno.test('a gated rule writes the gate it fired on', () => {
  let out = emitted(
    one('.call, +!result'),
    { entities: ['c1'], vars: {} },
    vocab,
  )
  assertEquals(out, [{ entity: { eid: 'c1' }, result: {} }])
})

Deno.test('a written column takes the variable it named', () => {
  let out = emitted(
    one('$c .call; +result.call=$c, +result.ms=12'),
    { entities: ['c1', null], vars: { c: 'c1' } },
    vocab,
  )
  // The matched pattern writes nothing; the making one writes both columns,
  // the number read as a number.
  assertEquals(out.length, 1)
  assertEquals(out[0].result, { call: 'c1', ms: 12 })
})

Deno.test('a made entity is named from the firing, so it is the same one twice', () => {
  let rule = one('$c .call; +result.call=$c')
  let row = { entities: ['c1', null], vars: { c: 'c1' } }
  assertEquals(
    emitted(rule, row, vocab)[0].entity.eid,
    emitted(rule, row, vocab)[0].entity.eid,
  )
  // A different binding is a different entity.
  let other = { entities: ['c2', null], vars: { c: 'c2' } }
  assertEquals(
    emitted(rule, row, vocab)[0].entity.eid ==
      emitted(rule, other, vocab)[0].entity.eid,
    false,
  )
})

Deno.test('a resource a rule wrote is the value it stands for', () => {
  let out = emitted(
    one('.call, +!result, +result.ms=#Now'),
    { entities: ['c1'], vars: {} },
    vocab,
    () => 42,
  )
  assertEquals((out[0].result as { ms: number }).ms, 42)
})

Deno.test('a firing is the rule and what it bound', () => {
  assertEquals(
    firing({ name: 'settle', match: '.call' }, {
      entities: ['c1', null],
      vars: {},
    }),
    'settle(c1, ·)',
  )
})

Deno.test('order is declared, never the order a plugin was registered in', () => {
  let names = (rules: { name: string; match: string; before?: string[] }[]) =>
    ready(rules).map((r) => r.rule.name)
  // Alphabetical by default…
  assertEquals(
    names([{ name: 'b', match: '.call' }, { name: 'a', match: '.call' }]),
    ['a', 'b'],
  )
  // …refined by what a rule says it runs before, whichever order they arrive.
  assertEquals(
    names([
      { name: 'a', match: '.call' },
      { name: 'z', match: '.call', before: ['a'] },
    ]),
    ['z', 'a'],
  )
})

Deno.test('rules that run before each other are a circle, said out loud', () => {
  assertThrows(
    () =>
      ready([
        { name: 'a', match: '.call', before: ['b'] },
        { name: 'b', match: '.call', before: ['a'] },
      ]),
    Error,
    'circle',
  )
})
