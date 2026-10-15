// A schema admission plugin reads a property's declaration from the document
// that owns it, including an extension of a component declared elsewhere.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { Refused } from './admit.ts'
import { admitSchema } from './admit_schema.ts'
import { graph } from './graph.ts'
import { memory } from './testing.ts'

let moves = loadVocab([
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

let joints = loadVocab({
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

let moved = graph({
  storage: memory(),
  vocab: moves,
  plugins: [admitSchema(moves)],
})
await moved.apply([{ entity: { eid: 'move-1' }, move: { reach: 2 } }])
test('schema admission validates an extension property', async () => {
  await assertRejects(
    async () =>
      await moved.apply([{
        entity: { eid: 'move-1' },
        move: { reach: 4 },
      }]),
    Refused,
  )
})

// Which trees are well formed is tree()'s, in admit_schema.ts.
let nodes = [{ id: 'root' }, { id: 'child', up: 'root' }]
let jointed = graph({
  storage: memory(),
  vocab: joints,
  plugins: [admitSchema(joints)],
})
await jointed.apply([{ entity: { eid: 'tree' }, joints: { nodes } }])
test('schema admission keeps an ordered tree through partial writes', async () => {
  await assertRejects(
    async () =>
      await jointed.apply([{
        entity: { eid: 'tree' },
        joints: { nodes: [{ id: 'child', up: 'root' }, { id: 'root' }] },
      }]),
    Refused,
    'parents must precede',
  )
  assertEquals((await jointed.get(['tree']))[0].joints, { nodes })
})
