// What a dead entity last held, folded from its journal's changes.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { heldBefore } from './graves.ts'

let at = (component: string, value?: Record<string, unknown>) => ({
  tx: '',
  target: '',
  component,
  value,
})

test('a grave holds what its history last told before its death', () => {
  let cases: [ReturnType<typeof at>[], unknown][] = [
    [[at('doc', { title: 'a' }), at('entity')], { doc: { title: 'a' } }],
    [[at('doc', { title: 'a' }), at('doc', { body: 'b' }), at('entity')], {
      doc: { title: 'a', body: 'b' },
    }],
    [[at('doc', { title: 'a' }), at('doc'), at('entity')], {}],
    // Revived and died again: only the second life.
    [[
      at('doc', { title: 'a' }),
      at('entity'),
      at('space', { slug: 's' }),
      at('entity'),
    ], {
      space: { slug: 's' },
    }],
  ]
  for (let [changes, held] of cases) assertEquals(heldBefore(changes), held)
})
