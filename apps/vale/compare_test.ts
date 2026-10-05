// A range reads with one sign and unit, and keeps its stat's presentation.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { rangeText, statRangeValue, stepRange } from './compare.ts'
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

test('upgrade ranges use the same compact text and colored stat icons as finished gear', () => {
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
    let html = stepRange(
      { lvl: 1, learned: [] },
      side(0),
      side(low),
      side(high),
    )
    let { document } = parseHTML(html)
    let range = document.querySelector(`.Stat-${stat} em`)!
    ok(range, `${stat} has its own colored range`)
    equal(range.textContent, text)
    ok(range.parentElement!.querySelector('.Glyph'), `${stat} has its icon`)
  }
})
