import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { bind } from './host.ts'
import { label } from './suggest.ts'

let none = () => {
  throw new Error('not asked')
}

test('a candidate is labelled by its human id and its title', () => {
  let was = bind({
    vocab: loadVocab([]),
    get: none,
    apply: none,
    problem: none,
    name: none,
    when: none,
    find: none,
    id: (b) => `T-${b.entity.num}`,
    kind: () => 'task',
  })
  try {
    let row = (num: number, comps = {}) => ({
      entity: { eid: 'e', num },
      ...comps,
    })
    assertEquals(label(row(1, { doc: { title: 'Older' } })), 'T-1 — Older')
    assertEquals(label(row(2, { rank: { title: 'Ranked' } })), 'T-2 — Ranked')
    assertEquals(label(row(3)), 'T-3 — task')
  } finally {
    bind(was)
  }
})
