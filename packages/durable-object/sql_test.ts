// Cursor metrics are charged once to the statement and its enclosing spans.
import { equal, ok, test, throws } from '@yaks/testing'
import { during, peek, record } from '@yaks/trace'
import { select, table } from '@yaks/sql'
import { driver, type DurableStorage } from './sql.ts'

test('SQL spans report billed cursor rows, including failures, without extra SQL', () => {
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
  equal(d.query(stmt), [{ value: 1 }])
  equal(calls, 2) // constructor pragma and the unobserved query
  let target = {}
  let captured = record(target, () => {
    let c = ok(peek(target))
    return during(c.begin({ kind: 'request', name: 'request' }), () => {
      d.query(stmt)
      fail = true
      throws(() => d.query(stmt))
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
