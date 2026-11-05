// The apply() band's write as the reader scrolls through its phases: each
// phase passed has happened, and the line apply() stamps is written once the
// reader passes stamp.
import { equal, test } from '@yaks/testing'
import { PHASES } from '@yaks/graph/plugin'
import { passed, standing } from './bands.ts'

let ran = new Set(PHASES.filter((p) => p != 'audit' && p != 'journal'))
let at = (upto: number) => {
  let s = standing(ran, upto)
  return {
    lit: PHASES.filter((p, i) => s.phase(p, i) == 'on').length,
    skipped: PHASES.filter((p, i) => s.phase(p, i) == 'skip'),
    rows: ['entity', 'doc', 'created'].filter((key) =>
      s.row({ key, stamped: key == 'created' } as never)
    ),
    now: s.now,
  }
}
let to = (p: string) => PHASES.indexOf(p as never)

test('the write happens as far as the reader has scrolled, and undoes as they go back', () => {
  equal(at(-1), {
    lit: 0,
    skipped: [],
    rows: ['entity', 'doc'],
    now: undefined,
  })
  equal(at(to('mutate')).rows, ['entity', 'doc'])
  equal(at(to('stamp')), {
    lit: to('stamp') + 1,
    skipped: [],
    rows: ['entity', 'doc', 'created'],
    now: 'stamp',
  })
  equal(at(to('commit')).skipped, ['journal'])
  equal(at(to('commit')).now, 'commit')
  equal(at(PHASES.length - 1).skipped, ['journal', 'audit'])
})

test('the reader is past each phase whose dot is above the reading line', () => {
  equal(
    [passed([500, 600], 400), passed([100, 600], 400), passed([1, 2], 400)],
    [-1, 0, 1],
  )
})
