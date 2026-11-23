import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { friendSide, side, type Standing, standings } from './friends.ts'

let me = crypto.randomUUID(), you = crypto.randomUUID()

// A side as its person left it: approved, declined, suggested or absent.
type Said = 'approved' | 'declined' | 'proposed' | null
let sideOf = (from: string, to: string, said: Said): Bundle[] =>
  !said ? [] : [
    friendSide(from, to, {
      ...said == 'proposed' ? { proposed: {} } : { decided: { verdict: said } },
    }),
  ]
let standing = (mine: Said, theirs: Said) =>
  standings(me, [...sideOf(me, you, mine), ...sideOf(you, me, theirs)])
    .get(you)?.standing ?? null

let cases: [Said, Said, Standing | null][] = [
  ['approved', 'approved', 'friend'],
  ['approved', null, 'asking'],
  ['approved', 'proposed', 'asking'],
  ['approved', 'declined', 'asking'],
  [null, 'approved', 'asked'],
  ['proposed', 'approved', 'asked'],
  ['proposed', 'proposed', 'suggested'],
  ['proposed', null, 'suggested'],
  ['declined', 'approved', null],
  ['declined', 'proposed', null],
  [null, 'proposed', null],
  [null, 'declined', null],
]
for (let [mine, theirs, want] of cases) {
  test(`my side ${mine}, theirs ${theirs}: ${want ?? 'nowhere'}`, () => {
    equal(standing(mine, theirs), want)
  })
}

test('a side is the relationship edge between its two people, one each way', () => {
  equal(side(me, you) == side(you, me), false)
  equal(friendSide(me, you).entity.eid, side(me, you))
})

test('a relationship other than friend is no friendship', () => {
  let brother = { ...friendSide(me, you), relationship: { role: 'brother' } }
  equal(standings(me, [brother, ...sideOf(you, me, 'approved')]).get(you), {
    standing: 'asked',
    at: '',
  })
})
