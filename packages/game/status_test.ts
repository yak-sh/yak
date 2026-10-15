// Games choose their own effect kinds; timing and modifiers remain generic.
import { equal, test } from '@yaks/testing'
import {
  applied,
  carries,
  elapsed,
  factor,
  labels,
  refreshed,
  type Status,
} from './status.ts'
let modifier = (
  s: Status[],
  target: string,
  stat: string,
  now: number,
  life?: number,
) => factor(s, target, stat, now, life, (k) => k == 'slow' ? -1 : 1, 0.1)
let refresh = (s: Status[], next: Status) =>
  refreshed(s, next, (k) => k == 'dot' || k == 'hot')

test('damage and healing tick exactly through expiry even after a late frame', () => {
  let dot = applied(
    { kind: 'burn', amount: 10, ms: 4000 },
    'mob',
    7,
    'Burn',
    0,
  )
  equal(elapsed(dot, 999).amount, 0)
  let one = elapsed(dot, 1000)
  equal(one.amount, 10)
  equal(elapsed({ ...dot, next: one.next }, 9000).amount, 30)
  equal(elapsed({ ...dot, next: 5000 }, 9000).amount, 0)
  let hot = applied(
    { kind: 'mend', amount: 10, ms: 3000 },
    'hero',
    0,
    'Mend',
    0,
  )
  equal(elapsed(hot, 3000).amount, 30)
})

test('buffs and debuffs affect only their carrier and lifetime', () => {
  let buff = applied(
    { kind: 'rally', stat: 'damage', share: .3, ms: 4000 },
    'hero',
    0,
    'Rally',
    0,
  )
  let debuff = applied(
    { kind: 'slow', stat: 'speed', share: .4, ms: 3000 },
    'mob',
    7,
    'Slow',
    0,
  )
  equal(modifier([buff, debuff], 'hero', 'damage', 1000), 1.3)
  equal(modifier([buff, debuff], 'mob', 'speed', 1000, 7), .6)
  equal(modifier([debuff], 'mob', 'speed', 1000, 8), 1)
  equal(modifier([buff], 'hero', 'damage', 4000), 1)
  equal(labels([buff], 1000), 'Rally 3s')
})

test('area refresh keeps one modifier and does not postpone periodic ticks', () => {
  let buff = applied(
    { kind: 'rally', stat: 'damage', share: .2, ms: 4000 },
    'hero',
    0,
    'Rally',
    0,
    'area:hero:buff',
  )
  let held: Status[] = [buff]
  for (let now = 1000; now <= 4000; now += 1000) {
    held = refresh(held, { ...buff, until: now + 4000 })
    equal(held.length, 1)
    equal(modifier(held, 'hero', 'damage', now), 1.2)
  }
  let kinds: ('dot' | 'hot')[] = ['dot', 'hot']
  for (let kind of kinds) {
    let st = { ...buff, kind, stat: undefined, amount: 5, next: 1000 }
    let tick = elapsed(
      refresh([st], { ...st, next: 2000, until: 5000 })[0],
      1000,
    )
    equal(tick.amount, 5)
    let next = refresh([{ ...st, next: tick.next }], {
      ...st,
      next: 3000,
      until: 6000,
    })[0]
    equal(elapsed(next, 2000).amount, 5)
  }
})

test('carriers accept only the game kinds and labels discard markup', () => {
  let s = applied(
    { kind: 'poison', amount: 2, ms: 2000 },
    'foe',
    7,
    '<Poison>',
    0,
  )
  let kind = (k: string): k is 'poison' => k == 'poison'
  equal(carries([s, { ...s, kind: 'other' }, {}, null], kind), [s])
  equal(carries(null, kind), [])
  equal(labels([s], 1000), 'Poison 1s')
  equal(labels([s], 2000), '')
})
