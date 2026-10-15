// Critical hits, armour and life ledgers compute from a game's values.
import { equal, test } from '@yaks/testing'
import { blow, fallOf, hpOf, through } from './combat.ts'

test('blows and armour use the supplied game tuning', () => {
  let rules = {
    sure: false,
    luck: 0,
    greatAt: .88,
    greatScale: 1.8,
    spread: .2,
  }
  equal(blow(20, .05, rules), { dmg: 20, great: false })
  equal(blow(20, .05, { ...rules, sure: true }), { dmg: 36, great: true })
  equal(blow(20, .85, { ...rules, luck: .1 }).great, true)
  equal(blow(20, .5, { ...rules, spread: 0, greatAt: .4, greatScale: 3 }), {
    dmg: 60,
    great: true,
  })
  equal([0, 10, 30].map((n) => through(20, n, 5, 1)), [20, 13, 8])
  equal(through(20, 10, 10, 0), 10)
  equal(through(0, 10, 10, 0), 0)
  equal(through(0, 10, 5, 1), 1)
})

test('duplicate falls collapse until the next life, including dynamic respawns', () => {
  let rows = [{ at: 4000 }, { at: 1000 }, { at: 1200 }]
  equal(fallOf(rows, 20, 10000), { down: true, fell: 1000 })
  equal(rows[0].at, 4000)
  equal(fallOf(rows, 20, 21000), { down: false, fell: 1000 })
  equal(fallOf([...rows, { at: 21000 }], 20, 21000), {
    down: true,
    fell: 21000,
  })
  equal(fallOf([], 20, 0), { down: false, fell: 0 })
  equal(fallOf(rows, () => 30, 30000).down, true)
  equal(fallOf(rows, () => 30, 31000).down, false)
})

test('health counts all damage only in the target life and floors at zero', () => {
  let dealt = [
    { foe: 'a', life: 5, dmg: 10 },
    { foe: 'a', life: 5, dmg: 4 },
    { foe: 'b', life: 5, dmg: 100 },
    { foe: 'a', life: 4, dmg: 100 },
  ]
  equal(hpOf('a', 32, 5, dealt), 18)
  equal(hpOf('a', 32, 6, dealt), 32)
  equal(hpOf('a', 10, 5, dealt), 0)
})
