// The stack band's write as the reader scrolls through apply()'s phases:
// each phase passed has happened, and each plate is in once the phase that
// writes it has run.
import { equal, test } from '@yaks/testing'
import { PHASES } from '@yaks/graph/plugin'
import { passed, standing } from './bands.ts'

let ran = new Set(PHASES.filter((p) => p != 'audit' && p != 'journal'))
let at = (upto: number) => {
  let s = standing(ran, upto)
  return {
    lit: PHASES.filter((p, i) => s.phase(p, i) == 'on').length,
    skipped: PHASES.filter((p, i) => s.phase(p, i) == 'skip'),
    plates: ['entity', 'doc', 'created'].filter((k) =>
      s.plate(k, k == 'created')
    ),
    stored: s.stored,
  }
}
let to = (p: string) => PHASES.indexOf(p as never)

test('the write happens as far as the reader has scrolled, and undoes as they go back', () => {
  equal(at(-1), { lit: 0, skipped: [], plates: [], stored: false })
  equal(at(to('mint')).plates, ['entity'])
  equal(at(to('mutate')).plates, ['entity', 'doc'])
  equal(at(to('stamp')), {
    lit: to('stamp') + 1,
    skipped: [],
    plates: ['entity', 'doc', 'created'],
    stored: false,
  })
  equal(at(to('commit')).skipped, ['journal'])
  equal(at(to('commit')).stored, true)
  equal(at(PHASES.length - 1).skipped, ['journal', 'audit'])
})

test('the reader is past each phase whose dot is above the reading line', () => {
  equal(
    [passed([500, 600], 400), passed([100, 600], 400), passed([1, 2], 400)],
    [-1, 0, 1],
  )
})
