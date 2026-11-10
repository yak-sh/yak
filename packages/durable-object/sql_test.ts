// Cursor metrics are charged once to the statement and its enclosing spans.
import { equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { during, peek, record } from '@yaks/trace'
import { and, col, effect, eq, insert, or, select, table, val } from '@yaks/sql'
import { driver, type DurableStorage } from './sql.ts'
import { durable } from './testing.ts'

let calls = 0
let fail = false
let held: DurableStorage = {
  sql: {
    exec: () => {
      calls++
      return {
        rowsRead: 17,
        rowsWritten: 4,
        toArray: () => {
          if (fail) throw new Error('engine failure')
          return [{ value: 1 }]
        },
        *[Symbol.iterator]() {},
      }
    },
  },
  transactionSync: (run) => run(),
}
let measured: [number | undefined, number | undefined][] = []
let d = driver(
  held,
  undefined,
  (read, written) => measured.push([read, written]),
)
let stmt = select({ from: table('book') })

let commandStorage = durable()
let commands = 0
let commandExec = commandStorage.sql.exec.bind(commandStorage.sql)
commandStorage.sql.exec = (sql, ...params) => {
  commands++
  return commandExec(sql, ...params)
}
let commandDriver = driver(commandStorage)
commandDriver.query({
  t: 'create table',
  name: 'resultless',
  cols: [{ name: 'price', type: 'integer' }],
})
commandDriver.query(insert('resultless', { price: 1 }))

test('a resultless command changes its row with one engine operation', () => {
  commands = 0
  effect(commandDriver, {
    t: 'update',
    table: 'resultless',
    set: { price: val(2) },
  })
  equal(commands, 1)
  equal(
    commandDriver.query(select({
      cols: [col('price')],
      from: table('resultless'),
    })),
    [{ price: 2 }],
  )
})

test('a statement past the engine variable limit binds what it may and writes the rest', () => {
  let big = driver(durable())
  big.query({
    t: 'create table',
    name: 'many',
    cols: [{ name: 'n', type: 'integer' }, { name: 'label' }],
  })
  effect(big, insert('many', { n: 250, label: "it's" }))
  effect(big, insert('many', { n: 251, label: 'other' }))
  let wanted = Array.from({ length: 300 }, (_, i) => eq(col('n'), val(i)))
  equal(
    big.query(select({
      cols: [col('n')],
      from: table('many'),
      where: and(
        or(...wanted),
        eq(col('label'), val("it's")),
      ),
    })),
    [{ n: 250 }],
  )
})

test('SQL spans report billed cursor rows, including failures, without extra SQL', () => {
  equal(d.query(stmt), [{ value: 1 }])
  equal(calls, 2) // constructor pragma and the unobserved query
  let target = {}
  let captured = record(target, () => {
    let c = ok(peek(target))
    return during(c.begin({ kind: 'request', name: 'request' }), () => {
      d.query(stmt)
      fail = true
      assertThrows(() => d.query(stmt), Error, 'engine failure')
    })
  })
  equal(calls, 4)
  equal(measured, Array.from({ length: 4 }, () => [17, 4]))
  equal(captured.spans.map((e) => e.name), [
    'request',
    'book select',
    'book select',
  ])
  equal(captured.spans[0].counts, {
    statements: 2,
    rowsRead: 34,
    rowsWritten: 8,
  })
  equal(captured.spans[1].counts, {
    statements: 1,
    rowsRead: 17,
    rowsWritten: 4,
  })
  equal(captured.spans[2].counts, captured.spans[1].counts)
  equal(captured.spans[2].outcome, 'error')
})

test('an engine refusal names the statement it refused, without its values', () => {
  let refusing: DurableStorage = {
    sql: {
      exec: (sql) => {
        if (sql.startsWith('pragma')) return durable().sql.exec(sql)
        throw new Error('nested too deep: SQLITE_ERROR')
      },
    },
    transactionSync: (run) => run(),
  }
  let said = console.error, lines: unknown[][] = []
  console.error = (...line) => void lines.push(line)
  try {
    let e = assertThrows(() =>
      driver(refusing).query(
        select({ from: table('book'), where: eq(col('title'), val('Dune')) }),
      )
    ) as Error
    equal(e.message, 'nested too deep: SQLITE_ERROR')
    equal(e.cause, {
      statement: 'select * from "book" where "title" = ?',
      length: 38,
    })
    equal(lines.length, 1)
    ok(!JSON.stringify(lines).includes('Dune'))
  } finally {
    console.error = said
  }
})
