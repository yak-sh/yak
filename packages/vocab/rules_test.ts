import { assertEquals, assertThrows } from '@std/assert'
import { rulesIn } from './rules.ts'
import { loadVocab } from './vocab.ts'
import { storable } from './validate.ts'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { metaSchema } from './meta.ts'

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

Deno.test('a rule declaration is a name, a query, and what it runs before', () => {
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

Deno.test('loadVocab passes over a rule, and plants no table for it', () => {
  let v = loadVocab(doc)
  assertEquals(v.all.includes('settle'), false)
  assertEquals(v.all.sort(), ['call', 'entity'])
})

Deno.test('a rule with no match is a declaration that says nothing', () => {
  assertThrows(
    () => rulesIn({ $defs: { broke: { rule: true } } }),
    Error,
    'declares no match',
  )
})

Deno.test('a rule declaration validates as one', () => {
  let check = new Ajv2020({ strict: false }).compile(metaSchema)
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
