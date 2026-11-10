// An object's SQL is counted where it runs: a scan and a runaway are told as
// they happen, and an object that refuses stops until its window ends.
import { equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { insert, select, table } from '@yaks/sql'
import { bounded, ceiling, type Options, Stopped } from './ceiling.ts'
import { driver, type DurableStorage } from './sql.ts'

// A ceiling on a clock the test moves, and what it told.
let bound = (options: Options = {}) => {
  let clock = { at: 0 }
  let told: string[] = []
  let c = ceiling({
    windows: [
      { ms: 60_000, read: 1_000_000, written: 1_000 },
      { ms: 3_600_000, read: 3_000_000, written: 3_000 },
    ],
    now: () => clock.at,
    report: (e, { fault, tags }) =>
      told.push(`${e.name} ${fault.split('|')[1]} ${tags.window ?? tags.rows}`),
    ...options,
  })
  let ran = (rowsRead: number, returned = rowsRead, rowsWritten = 0) =>
    c.count({ shape: () => 'select "t"', rowsRead, rowsWritten, returned })
  return { c, clock, told, ran }
}

test('a statement that reads far more than it returns is told once an hour', () => {
  let { clock, told, ran } = bound()
  ran(99_999, 0)
  ran(200_000, 5_000)
  equal(told, [])
  ran(200_000, 3)
  ran(200_000, 3)
  equal(told.length, 1)
  ok(told[0].startsWith('Scan '))
  ok(told[0].endsWith(' 200000'))
  clock.at = 3_600_000
  ran(200_000, 3)
  equal(told.length, 2)
})

test('an object past a window is told once and takes nothing until it ends', () => {
  let { c, clock, told, ran } = bound({ refuse: true })
  ran(600_000)
  c.admit(false)
  ran(600_000)
  ran(600_000)
  equal(told, ['Runaway read 1 min'])
  let refused = assertThrows(() => c.admit(false), Stopped)
  equal(refused.retry, { after: 60_000, defer: true })
  equal(refused.status, 429)
  assertThrows(() => c.admit(true), Stopped)
  clock.at = 45_000
  equal(c.stopped(), 15_000)
  clock.at = 60_000
  c.admit(false)
  // The hour holds what its minutes spent: 1.8 million, then 1.5 more.
  ran(900_000)
  clock.at = 120_000
  ran(600_000)
  equal(told, ['Runaway read 1 min', 'Runaway read 1 h'])
  equal(c.stopped(), 3_480_000)
})

test('past its written rows an object still reads, and keeps what it must', () => {
  let { c, told, ran } = bound({ refuse: true })
  ran(0, 0, 1_001)
  equal(told, ['Runaway written 1 min'])
  c.admit(false)
  assertThrows(() => c.admit(true), Stopped)
  equal(c.free(() => (c.admit(true), 'kept')), 'kept')
  equal(c.stopped(false), 0)
})

test('an object that does not refuse is told and goes on', () => {
  let { c, told, ran } = bound()
  ran(2_000_000)
  equal(told, ['Runaway read 1 min'])
  c.admit(true)
  equal([c.stopped(), c.refusal()], [0, null])
})

test('an object spared after it stopped takes every statement again', () => {
  let { c, ran } = bound({ refuse: true })
  ran(2_000_000)
  ok(c.refusal(false) instanceof Stopped)
  c.spare()
  c.admit(false)
  equal(c.stopped(), 0)
})

test('every driver over one storage counts against its one ceiling', () => {
  let cost = { rowsRead: 0, rowsWritten: 0 }
  let held: DurableStorage = {
    sql: {
      exec: () => ({ ...cost, toArray: () => [], *[Symbol.iterator]() {} }),
    },
    transactionSync: (run) => run(),
  }
  let told: string[] = []
  bounded(held, {
    windows: [{ ms: 60_000, read: 1_000, written: 10 }],
    now: () => 0,
    report: (e, { tags }) => told.push(`${e.name} ${tags.statement}`),
    refuse: true,
  })
  let a = driver(held), b = driver(held)
  cost = { rowsRead: 600, rowsWritten: 0 }
  a.query(select({ from: table('book') }))
  b.query(select({ from: table('book') }))
  equal(told, ['Runaway undefined'])
  assertThrows(() => a.query(select({ from: table('book') })), Stopped)
  let keep = insert('kept', { v: 'x' })
  assertThrows(() => b.query(keep), Stopped)
  bounded(held).free(() => b.query(keep))
})
