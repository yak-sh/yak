// A schema admission plugin reads a property's declaration from the document
// that owns it, including an extension of a component declared elsewhere.

import { assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { Refused } from './admit.ts'
import { admitSchema } from './admit_schema.ts'
import { graph } from './graph.ts'
import { memory } from './testing.ts'

Deno.test('schema admission validates an extension property', async () => {
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
