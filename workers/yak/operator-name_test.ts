// Every space from before Operators had names is given one, clear of the
// names its people's other Operators go by.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { NAMES, operatorNameRule, pick } from './operator-name.ts'

let vocab = loadVocab([kernelDoc, {
  $defs: {
    space: { component: true, type: 'object', properties: {} },
    member: {
      component: true,
      type: 'object',
      properties: { space: { type: 'string' }, person: { type: 'string' } },
    },
    operator: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
let seat = (space: string, person: string) => ({
  entity: { eid: `${space}-${person}` },
  member: { space, person },
})
// Two spaces whose names would start at the same place, and a third that
// already goes by that name; another person's space shares nothing.
let first = pick('a')
await g.apply([
  { entity: { eid: 'a' }, space: {} },
  { entity: { eid: 'b' }, space: {} },
  { entity: { eid: 'c' }, space: {}, operator: { name: first } },
  { entity: { eid: 'd' }, space: {} },
  seat('a', 'ana'),
  seat('b', 'ana'),
  seat('c', 'ana'),
  seat('d', 'bo'),
], { trusted: true, stamp: false })
let read = (line: string) => g.read(line) as Bundle[]
let rows = await g.read(operatorNameRule.find)
let named = Object.fromEntries(
  rows.map((row) => [
    row.entity.eid,
    (operatorNameRule.move(row, read)[0].operator as { name: string }).name,
  ]),
)

test('every unnamed Operator is named, apart from the ones its people reach', () => {
  assertEquals(Object.keys(named).sort(), ['a', 'b', 'd'])
  for (let name of Object.values(named)) {
    assertEquals(NAMES.includes(name), true)
  }
  assertEquals(new Set([named.a, named.b, first]).size, 3)
  assertEquals(named.d, pick('d'))
})
