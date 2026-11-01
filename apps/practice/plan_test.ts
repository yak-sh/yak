import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  calendar,
  clock,
  copy,
  hm,
  hmDay,
  length,
  longDate,
  minutes,
  move,
  ordered,
  timeline,
  weekAfter,
} from './plan.js'

let block = (eid: string, ord: number, mins: number, practice = 'p') => ({
  entity: { eid },
  block: { practice, ord, minutes: mins },
  doc: { title: eid },
})
type Row = { entity: { eid: string } }
let ids = (rows: Row[]) => rows.map((r) => r.entity.eid)

let practice = (eid: string, date: string, start = '15:30') => ({
  entity: { eid },
  practice: { date, start, team: 'Varsity' },
  doc: { title: '' },
})

test('a practice runs on a gym clock from its start', () => {
  let blocks = [
    block('warm', 1, 15),
    block('serve', 2, 20),
    block('run', 3, 10),
  ]
  let line = timeline('15:30', blocks)
  assertEquals(line.map((s: { from: number }) => hm(s.from)), [
    '3:30',
    '3:45',
    '4:05',
  ])
  assertEquals(hmDay(line.at(-1)!.to), '4:15 pm')
  assertEquals([hmDay(clock('09:05')!), hmDay(clock('12:00')!)], [
    '9:05 am',
    '12:00 pm',
  ])
  assertEquals([clock('25:00'), clock('3pm'), minutes('0'), minutes(' 15 ')], [
    null,
    null,
    null,
    15,
  ])
})

test('blocks keep their own practice and their running order', () => {
  let blocks = [block('b', 2, 5), block('x', 1, 5, 'other'), block('a', 1, 5)]
  assertEquals(ids(ordered(blocks, 'p')), ['a', 'b'])
})

test('moving a block swaps it with its neighbour and stops at the ends', () => {
  let blocks = [block('a', 1, 5), block('b', 2, 5), block('c', 3, 5)]
  assertEquals(move(blocks, 'b', -1), [
    { entity: { eid: 'b' }, block: { ord: 1 } },
    { entity: { eid: 'a' }, block: { ord: 2 } },
  ])
  assertEquals(move(blocks, 'a', -1), [])
  assertEquals(move(blocks, 'c', 1), [])
})

test('practices to come are soonest first, practices run latest first', () => {
  let all = [
    practice('old', '2026-10-27'),
    practice('late', '2026-11-03', '18:00'),
    practice('soon', '2026-11-03'),
    practice('older', '2026-10-20'),
  ]
  let { next, past } = calendar(all, '2026-11-03')
  assertEquals(ids(next), ['soon', 'late'])
  assertEquals(ids(past), ['old', 'older'])
})

test('a copy is one batch on the new date with every block in order', () => {
  let p = practice('p', '2026-11-03')
  let bundles = copy(
    p,
    [block('a', 4, 15), block('b', 9, 20)],
    weekAfter('2026-11-03'),
  )
  assertEquals(bundles[0].practice, {
    date: '2026-11-10',
    start: '15:30',
    team: 'Varsity',
  })
  assertEquals(
    bundles.slice(1).map((b) => [b.block!.practice, b.block!.ord, b.doc.title]),
    [['$practice', 1, 'a'], ['$practice', 2, 'b']],
  )
})

test('dates and lengths read the way a coach says them', () => {
  assertEquals(longDate('2026-11-03'), 'Tuesday, November 3')
  assertEquals(weekAfter('2026-12-29'), '2027-01-05')
  assertEquals([length(45), length(60), length(105)], [
    '45 min',
    '1 hr',
    '1 hr 45 min',
  ])
})
