// A model's wrong reference is left out of its output, never its whole answer.
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { parse, resolve, type Wiring } from './answer.ts'
import { workshop } from './testing.ts'

let ref = (to: string, death = 'detach') => ({ type: 'string', ref: to, death })
let vocab = workshop([{
  $defs: {
    official: { component: true, type: 'object', properties: {} },
    speaker: { component: true, type: 'object', properties: {} },
    part: {
      component: true,
      type: 'object',
      properties: { ord: { type: 'number' } },
    },
    motion: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' }, mover: ref('official') },
    },
    vote: {
      component: true,
      type: 'object',
      properties: {
        motion: ref('motion', 'cascade'),
        member: ref('official'),
        cast: { type: 'string' },
      },
    },
    note: {
      component: true,
      type: 'object',
      properties: { parent: ref('entity'), vote: ref('vote') },
    },
  },
}])
let held: Bundle[] = [
  { entity: { eid: 'howard' }, official: {} },
  { entity: { eid: 'voice' }, speaker: {} },
]
let motion = (mover: string) => ({
  slot: 'motion 2',
  inputs: [],
  components: { part: { ord: 2 }, motion: { text: 'to adjourn', mover } },
})
let vote = (motion: string, member = 'howard') => ({
  slot: 'vote 2',
  inputs: [],
  components: { vote: { motion, member, cast: 'yes' } },
})
let line = { slot: 'part 1', inputs: [], components: { part: { ord: 1 } } }
let read = (outputs: unknown[], model = true, wiring: Wiring = {}) =>
  resolve(
    parse({ outputs }, [], vocab, (slot) => slot, wiring, model),
    held,
    vocab,
    wiring,
  )
type Case = {
  name: string
  outputs: unknown[]
  at: string
  components: Record<string, unknown>
  unresolved?: Record<string, string>
}
let slot = (specs: ReturnType<typeof read>, name: string) =>
  specs.find((s) => s.slot == name)!

for (
  let { name, outputs, at, components, unresolved } of <Case[]> [
    {
      name: 'a member and a sibling motion are kept',
      outputs: [motion('howard'), vote('$motion 2')],
      at: 'vote 2',
      components: {
        vote: { motion: 'motion 2', member: 'howard', cast: 'yes' },
      },
    },
    {
      name: 'a voice where a member belongs is left out',
      outputs: [motion('voice')],
      at: 'motion 2',
      components: { part: { ord: 2 }, motion: { text: 'to adjourn' } },
      unresolved: { 'motion.mover': 'voice' },
    },
    {
      name: 'a member nobody holds is left out',
      outputs: [motion('Trustee Howard')],
      at: 'motion 2',
      components: { part: { ord: 2 }, motion: { text: 'to adjourn' } },
      unresolved: { 'motion.mover': 'Trustee Howard' },
    },
    {
      name: 'a vote on a motion never written keeps nothing',
      outputs: [motion('howard'), vote('$motion 3')],
      at: 'vote 2',
      components: {},
      unresolved: { 'vote.motion': '$motion 3' },
    },
    {
      name: 'a vote on a line that is no motion keeps nothing',
      outputs: [line, vote('$part 1')],
      at: 'vote 2',
      components: {},
      unresolved: { 'vote.motion': '$part 1' },
    },
    {
      name: 'a reference to an output that kept nothing is left out',
      outputs: [
        vote('$motion 9'),
        {
          slot: 'aside',
          inputs: [],
          components: { note: { vote: '$vote 2' } },
        },
      ],
      at: 'aside',
      components: { note: {} },
      unresolved: { 'note.vote': '$vote 2' },
    },
  ]
) {
  test(`a model's reference: ${name}`, () => {
    let spec = slot(read(outputs), at)
    equal(spec.components, components)
    equal(spec.unresolved, unresolved)
  })
}

test("a code tool's reference to no sibling is refused", () => {
  assertThrows(
    () => read([vote('$motion 3')], false),
    Error,
    'vote 2 names no sibling output $motion 3',
  )
})

test('a wired reference is the design, never checked', () => {
  let wiring = { 'vote 2': { 'vote.motion': 'part 1' } }
  let spec = slot(read([line, vote('')], true, wiring), 'vote 2')
  equal(spec.components.vote?.motion, 'part 1')
  equal(spec.unresolved, undefined)
})
