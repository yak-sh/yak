// Definition wiring supplies references independently of a tool's answer.
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { parse, type Wiring } from './answer.ts'
import { workshop } from './testing.ts'

let vocab = workshop([{
  $defs: {
    note: {
      component: true,
      type: 'object',
      properties: {
        parent: { type: 'string', ref: 'entity' },
        text: { type: 'string' },
      },
    },
  },
}])
let wiring = { main: { 'note.parent': 'sibling' } }
let output = (slot: string, components: Record<string, unknown> = {}) => ({
  slot,
  inputs: [],
  components,
})

for (
  let { name, components, sibling, error } of [
    { name: 'wired', components: {}, sibling: true },
    {
      name: 'model-supplied junk overridden',
      components: { note: { parent: '$missing', text: '$missing' } },
      sibling: true,
    },
    {
      name: 'sibling missing',
      components: {},
      sibling: false,
      error: 'wiring names no sibling output sibling',
    },
  ]
) {
  test(`output wiring: ${name}`, () => {
    let value = {
      outputs: [
        output('main', components),
        ...sibling ? [output('sibling', { doc: { body: 'Made' } })] : [],
      ],
    }
    let read = () => parse(value, [], vocab, (slot) => `${slot}-eid`, wiring)
    if (error) {
      assertThrows(read, Error, error)
      return
    }
    let [main] = read()
    equal(main.components.note?.parent, 'sibling-eid')
    equal(main.components.note?.text, components.note?.text)
    // Parsing never changes the recorded tool answer.
    equal(value.outputs[0].components, components)
  })
}

test('output wiring refuses a missing source slot or a nonreference property', () => {
  let value = { outputs: [output('main')] }
  for (
    let [wiring, error] of [
      [
        { missing: { 'note.parent': 'main' } },
        'wiring names no output missing',
      ],
      [{ main: { 'note.text': 'main' } }, 'needs a writable reference'],
      [{ main: { 'built.build': 'main' } }, 'needs a writable reference'],
      [{ main: { 'note.parent.extra': 'main' } }, 'needs a writable reference'],
    ] as [Wiring, string][]
  ) {
    assertThrows(
      () => parse(value, [], vocab, (slot) => slot, wiring),
      Error,
      error,
    )
  }
})
