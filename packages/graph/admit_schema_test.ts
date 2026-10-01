// A schema admission plugin reads a property's declaration from the document
// that owns it, including an extension of a component declared elsewhere.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { Refused } from './admit.ts'
import { admitSchema } from './admit_schema.ts'
import { graph } from './graph.ts'
import { memory } from './testing.ts'

test('schema admission validates an extension property', async () => {
  let vocab = loadVocab([
    {
      $defs: {
        move: { component: true, type: 'object', properties: {} },
      },
    },
    {
      $defs: {
        move: {
          component: true,
          extends: true,
          properties: {
            reach: { type: 'number', minimum: 0, maximum: 3, validate: true },
          },
        },
      },
    },
  ])
  let g = graph({ storage: memory(), vocab, plugins: [admitSchema(vocab)] })
  await g.apply([{ entity: { eid: 'move-1' }, move: { reach: 2 } }])
  await assertRejects(
    async () =>
      await g.apply([{
        entity: { eid: 'move-1' },
        move: { reach: 4 },
      }]),
    Refused,
  )
})

test('schema admission keeps an ordered tree through partial writes', async () => {
  let vocab = loadVocab({
    $defs: {
      joints: {
        component: true,
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            validate: true,
            tree: { key: 'id', parent: 'up' },
            items: { type: 'object' },
          },
        },
      },
    },
  })
  let g = graph({ storage: memory(), vocab, plugins: [admitSchema(vocab)] })
  let nodes = [{ id: 'root' }, { id: 'child', up: 'root' }]
  await g.apply([{ entity: { eid: 'tree' }, joints: { nodes } }])
  for (
    let invalid of [
      [{ id: 'root', up: 'root' }],
      [{ id: 'child', up: 'root' }, { id: 'root' }],
      [{ id: 'root' }, { id: 'root' }],
      [{ id: 'child', up: 'missing' }],
    ]
  ) {
    await assertRejects(
      async () =>
        g.apply([{
          entity: { eid: 'tree' },
          joints: { nodes: invalid },
        }]),
      Refused,
      'parents must precede',
    )
  }
  assertEquals((await g.get(['tree']))[0].joints, { nodes })
})
