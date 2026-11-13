// An object's SQL is counted where it runs: a scan and a runaway are told as
// they happen, and an object that refuses stops until its window ends.
import { equal, ok, test } from '@yaks/testing'
import { assertRejects, assertThrows } from '@std/assert'
import { compile, insert, select, table } from '@yaks/sql'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { bounded, ceiling, type Options, Stopped } from './ceiling.ts'
import { driver, type DurableStorage, freely } from './sql.ts'
import { durable } from './testing.ts'

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

let vocab = loadVocab({
  $defs: {
    effect: {
      component: true,
      properties: { state: { type: 'string', index: true } },
    },
  },
})

// Cursor costs and answers supplied by the runtime, through the driver door.
let aggregate = (rows: { n: number }[]) => {
  let read = 0, told: string[] = []
  let held: DurableStorage = {
    sql: {
      exec: () => ({
        rowsRead: read,
        rowsWritten: 0,
        toArray: () => rows,
        *[Symbol.iterator]() {},
      }),
    },
    transactionSync: (run) => run(),
  }
  bounded(held, {
    windows: [{ ms: 60_000, read: 1_000_000, written: 1_000 }],
    report: (error) => told.push(error.name),
  })
  let sql = driver(held)
  read = 146_266
  return { sql, told }
}

for (let line of ['.effect.state=done .count', '.effect .tally=effect.state']) {
  let rows = line.endsWith('.count')
    ? [{ n: 48_755 }]
    : [{ n: 40_000 }, { n: 8_755 }]
  let { sql, told } = aggregate(rows)
  let query = compile(parse(line), vocab)
  test(`${line} represents its counted inputs without losing billed rows`, () => {
    equal(sql.query(query), rows)
    equal(told, [])
    for (let i = 0; i < 6; i++) sql.query(query)
    equal(told, ['Runaway'])
  })
}

for (let n of [0, 3]) {
  let { sql, told } = aggregate([{ n }])
  let query = compile(parse('.effect.state=done .count'), vocab)
  test(`an aggregate with ${n} matches still reports excess input reads`, () => {
    sql.query(query)
    equal(told, ['Scan'])
  })
}

test('an analysis reads every row it counts, and is no scan', () => {
  let { sql, told } = aggregate([])
  sql.query({ t: 'analyze', table: 'effect' })
  equal(told, [])
  sql.query(select({ from: table('effect') }))
  equal(told, ['Scan'])
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

test('work a stopped object runs free takes statements across its awaits, and what it leaves behind does not', async () => {
  let { c, ran } = bound({ refuse: true })
  ran(0, 0, 1_001)
  let later: Promise<void> | undefined
  let kept = await c.free(async () => {
    await Promise.resolve()
    c.admit(true)
    later = new Promise((r) => setTimeout(r, 0)).then(() => c.admit(true))
    return 'kept'
  })
  equal(kept, 'kept')
  await assertRejects(() => later!, Stopped)
  assertThrows(() => c.admit(true), Stopped)
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

// A storage whose every statement costs what `cost` says, bounded by a
// minute of 1,000 rows read and 10 written, and what its ceiling told.
let storage = () => {
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
  return { held, told, costs: (c: typeof cost) => void (cost = c) }
}

test('every driver over one storage counts against its one ceiling', () => {
  let { held, told, costs } = storage()
  let a = driver(held), b = driver(held)
  costs({ rowsRead: 600, rowsWritten: 0 })
  a.query(select({ from: table('book') }))
  b.query(select({ from: table('book') }))
  equal(told, ['Runaway undefined'])
  assertThrows(() => a.query(select({ from: table('book') })), Stopped)
  let keep = insert('kept', { v: 'x' })
  assertThrows(() => b.query(keep), Stopped)
  bounded(held).free(() => b.query(keep))
})

test('what an object runs freely is told and leaves it taking writes', () => {
  let { held, told, costs } = storage()
  costs({ rowsRead: 0, rowsWritten: 20 })
  freely(held).query(insert('copied', { v: 'x' }))
  freely(held).query(insert('copied', { v: 'y' }))
  equal(told.length, 1)
  ok(told[0].startsWith('Runaway '))
  costs({ rowsRead: 0, rowsWritten: 1 })
  driver(held).query(insert('kept', { v: 'x' }))
  equal(bounded(held).stopped(true), 0)
})

test('an object that spent nothing takes every statement, whatever its clock reads', () => {
  let { c, clock } = bound({ refuse: true })
  clock.at = -1
  equal([c.stopped(), c.stopped(true)], [0, 0])
})

// One object's storage, and each instance of it as it starts: a minute of
// 1,000 rows read and 10 written, on a clock the case moves, and how often
// the object kept its windows.
let lasting = () => {
  let held = durable(), clock = { at: 0 }, told: string[] = [], kept = 0
  let put = held.kv.put
  held.kv.put = (key, value) => (kept++, put(key, value))
  let instance = () => {
    let c = bounded(held, {
      windows: [{ ms: 60_000, read: 1_000, written: 10 }],
      now: () => clock.at,
      report: (e, { fault }) => told.push(`${e.name} ${fault}`),
      refuse: true,
    })
    let ran = (rowsRead: number, rowsWritten = 0) =>
      c.count({ shape: () => 'spent', rowsRead, rowsWritten, returned: 0 })
    return { c, ran }
  }
  return { held, clock, told, instance, kept: () => kept }
}

test('an object stopped before its instance ended is stopped after it', async () => {
  let { held, clock, told, instance } = lasting()
  let { ran } = instance()
  // The statement that passes the window unwinds its own transaction.
  assertThrows(() =>
    held.transactionSync(() => {
      ran(0, 11)
      throw new Error('stopped')
    })
  )
  await null
  clock.at = 15_000
  let { c, ran: again } = instance()
  equal(c.stopped(true), 45_000)
  again(0, 1)
  equal(told, ['Runaway runaway|written'])
})

test("a restarted object's lanes go on where they stood", async () => {
  let { instance } = lasting()
  let { c, ran } = instance()
  c.lane('drain', () => ran(0, 6))
  await null
  equal(instance().c.under(0.5, 0, 'drain'), 60_000)
})

test('an object restarted half way through a window spends only the rest of it', async () => {
  let { instance } = lasting()
  instance().ran(600)
  await null
  let { c, ran } = instance()
  ran(500)
  equal(c.stopped(), 60_000)
})

test('an object keeps its windows only as they pass half, and all, of what they may', async () => {
  let { clock, instance, kept } = lasting()
  let { ran } = instance()
  for (let i = 0; i < 4; i++) ran(100)
  await null
  equal(kept(), 0)
  for (let i = 0; i < 20; i++) (ran(100), await null)
  equal(kept(), 2)
  clock.at = 60_000
  let { c } = instance()
  equal(c.stopped(), 0)
})

test("a lane's share is of its own rows, and its rows still count toward the object's", async () => {
  let { c, ran } = bound()
  c.lane('drain', () => ran(0, 0, 400))
  equal(c.under(0.25, 0, 'intake'), 0)
  equal(c.under(0.25), 60_000)
  equal(c.under(0.25, 0, 'drain'), 60_000)
  // Across awaits, until the work settles.
  await c.lane('intake', async () => {
    await Promise.resolve()
    ran(0, 0, 250)
  })
  ran(0, 0, 100)
  equal(c.under(0.25, 0, 'intake'), 60_000)
  equal(c.under(0.5, 0, 'drain'), 0)
  ran(0, 0, 250)
  equal(c.stopped(), 0)
  equal(c.spent()[0].written, 1_000)
})

test('work that can wait is told how long until every window is under its share', () => {
  let { c, clock, ran } = bound()
  equal(c.under(0.5), 0)
  ran(0, 0, 499)
  equal(c.under(0.5), 0)
  ran(0, 0, 1)
  equal(c.under(0.5), 60_000)
  clock.at = 60_000
  equal(c.under(0.5), 0)
  // The hour holds what its minutes spent.
  ran(0, 0, 1_000)
  clock.at = 120_000
  equal(c.under(0.5), 3_480_000)
})

test('a written runaway names what wrote, never statements that only read', () => {
  let told: Record<string, string>[] = []
  let c = ceiling({
    windows: [{ ms: 60_000, read: 1e9, written: 100 }],
    now: () => 0,
    report: (_, { tags }) => told.push(tags),
  })
  c.count({
    shape: () => 'select',
    rowsRead: 5_000,
    rowsWritten: 0,
    returned: 1,
  })
  for (let i = 0; i < 11; i++) {
    c.count({
      shape: () => 'delete',
      rowsRead: 0,
      rowsWritten: 10,
      returned: 0,
    })
  }
  equal(told.map((t) => [t.statements, t.unnamed]), [[
    '[]',
    '110 rows written by statements too small or too many to name',
  ]])
})
