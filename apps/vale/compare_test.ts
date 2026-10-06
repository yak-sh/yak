// A range reads with one sign and unit, and a number is coloured only where
// it would change.
import { equal, ok, test } from '@yaks/testing'
import {
  rangeText,
  statName,
  statRangeValue,
  stepRange,
  toRange,
} from './compare.ts'
import { drawn } from './dom_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { piece, type Stat } from './rarity.ts'

test('stat ranges carry one positive sign and one unit', () => {
  for (
    let [stat, low, high, text] of [
      ['force', .01, .05, '+1-5%'],
      ['luck', .015, .035, '+1.5-3.5%'],
      ['speed', 0, .08, '+0-8%'],
      ['haste', .02, .02, '+2%'],
      ['hp', 1, 5, '+1-5'],
      ['armour', 0, 4, '+0-4'],
      ['dmg', 1.2, 2.4, '1.2-2.4×'],
      ['force', -.05, -.01, '-5--1%'],
      ['force', -.01, .05, '-1-5%'],
    ] as [Stat | 'dmg', number, number, string][]
  ) {
    equal(statRangeValue(stat, low, high), text, stat)
  }
  for (
    let [low, high, text] of [
      ['0.50 s', '0.75 s', '0.50-0.75 s'],
      ['1 m', '2 m', '1-2 m'],
      ['5%', '10%', '5-10%'],
      ['12', '14', '12-14'],
      ['2 m', '2 m', '2 m'],
    ]
  ) equal(rangeText(low, high), text)
})

test('upgrade ranges use the compact text and the icons of finished gear', () => {
  seedItems()
  let h = { eid: 'weapon', kind: 'sword1', n: 1, lvl: 1 }
  let p = piece(h)
  for (
    let [stat, low, high, text] of [
      ['force', .01, .05, '+1-5%'],
      ['haste', .01, .03, '+1-3%'],
      ['hp', 1, 5, '+1-5'],
    ] as [Stat, number, number, string][]
  ) {
    let side = (value: number) => ({
      label: 'Piece',
      p: { ...p, [stat]: value },
      worn: { main: h },
    })
    let line = [
      ...drawn(stepRange(
        { lvl: 1, learned: [] },
        side(0),
        side(low),
        side(high),
      )).querySelectorAll('.ValeStats_Stat'),
    ].find((l) => l.textContent!.startsWith(statName(stat)))!
    ok(line, stat)
    ok(line.textContent!.endsWith(` → ${text}`), line.textContent!)
    ok(line.querySelector('.ValeStats_Mark svg'), `${stat} has its icon`)
  }
})

test('a number is coloured only where it would change, Better or Worse as it goes', () => {
  let secs = (n: number) => `${n.toFixed(2)} s`
  for (
    let [more, now, low, high, marks, shows = String] of [
      [true, 3, 3, 3, []],
      [true, 3, 4, 6, [['Better', '4-6']]],
      [true, 3, 1, 2, [['Worse', '1-2']]],
      [true, 3, 1, 5, []],
      [true, 0, 0, 17, []],
      [false, 5, 4, 4, [['Better', '4']]],
      [false, 5, 5, 6, []],
      [false, 0.5, 0.498, 0.499, [], secs],
    ] as [boolean, number, number, number, string[][], typeof String?][]
  ) {
    let ems = drawn(toRange(more, now, low, high, shows)).querySelectorAll('em')
    equal(
      [...ems].map((
        e,
      ) => [e.className.replace('ValeStats_', ''), e.textContent]),
      marks,
      `${now} → ${low}-${high}`,
    )
  }
})
