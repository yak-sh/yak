import { equal, test } from '@yaks/testing'
import { ownerOf, type OwnerSpot } from './owner.ts'

test('owner election ignores asleep and distant pages and includes the radius edge', () => {
  let players: [string, OwnerSpot][] = [
    ['d', { x: 0, z: 0, awake: true }],
    ['a', { x: 0, z: 0, awake: false }],
    ['b', { x: 3, z: 4.01, awake: true }],
    ['c', { x: 3, z: 4, awake: true }],
  ]
  let home = { x: 0, z: 0 }
  equal(ownerOf(players, home, 5), 'c')
  equal(ownerOf([...players].reverse(), home, 5), 'c')
  equal(ownerOf(players.filter(([id]) => id != 'c'), home, 5), 'd')
  equal(ownerOf(new Map(players), home, 0), 'd')
  equal(ownerOf(players, { x: 100, z: 100 }, 5), '')
  equal(ownerOf([], home, 5), '')
})
