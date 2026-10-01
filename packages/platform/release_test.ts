import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { reloadLevel } from './mod.ts'
import type { Release } from './mod.ts'

let was: Release = {
  files: 'old',
  vocab: {
    $defs: {
      row: { type: 'object', properties: { value: { type: 'string' } } },
      call: { tool: true },
    },
  },
}

test('same files win over required marks, including a restored release', () => {
  assertEquals(reloadLevel(was, was, [{ reload: 'required' }]), undefined)
})
test('cosmetic changes and additions are optional, crossed marks only raise', () => {
  let next = { ...was, files: 'new' }
  assertEquals(reloadLevel(was, next), 'optional')
  assertEquals(
    reloadLevel(was, next, [{}, { reload: 'required' }, {}]),
    'required',
  )
  assertEquals(
    reloadLevel(was, {
      files: 'new',
      vocab: {
        $defs: {
          ...was.vocab.$defs,
          extra: { type: 'object' },
        },
      },
    }),
    'optional',
  )
})
test('dropping tools, components or properties and retyping require reload', () => {
  for (
    let vocab of [
      {},
      { $defs: { row: was.vocab.$defs!.row } },
      { $defs: { ...was.vocab.$defs, row: { type: 'object' } } },
      {
        $defs: {
          ...was.vocab.$defs,
          row: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
          },
        },
      },
    ]
  ) assertEquals(reloadLevel(was, { files: 'new', vocab }), 'required')
})
