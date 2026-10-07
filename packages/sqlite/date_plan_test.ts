// Indexed dates must not walk unrelated history when planner statistics are stale.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import {
  compile,
  type Driver,
  insert,
  render,
  type Row,
  type Stmt,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object' },
    wake: {
      component: true,
      type: 'object',
      index: [['at']],
      properties: {
        at: { type: 'string', format: 'date-time' },
      },
    },
  },
})

// Native counters count full-scan advances and VM instructions, not returned
// rows. EQP supplies the indexed seeks; Cloudflare's row counter lives there.
let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
type Cost = { scans: number; steps: number; plan: string[]; sql: string }
let measured = (db: Database, d: Driver) => {
  let costs: Cost[] = []
  let active = false
  let query = (s: Stmt): Row[] => {
    if (!active || !['select', 'raw'].includes(s.t)) return d.query(s)
    let text = render(s), stmt = db.prepare(text.sql)
    try {
      let rows = stmt.all(...text.params)
      costs.push({
        scans: counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0),
        steps: counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
        plan: d.query({ t: 'explain query plan', of: s }).map((r) =>
          String(r.detail)
        ),
        sql: text.sql,
      })
      return rows
    } finally {
      stmt.finalize()
    }
  }
  return {
    driver: { ...d, query },
    read: <T>(fn: () => T) => {
      costs = []
      active = true
      try {
        return { value: fn(), costs }
      } finally {
        active = false
      }
    },
  }
}

for (let sparse of [false, true]) {
  test(`indexed dates seek ${sparse ? 'sparse' : 'empty'} wakes under stale statistics`, () => {
    let db = new Database(':memory:'), d = driver(db)
    try {
      storage(d, vocab).install()
      let add = (start: number, n: number) => {
        for (let i = start; i < start + n; i += 500) {
          d.query(
            insert(
              'entity',
              ...Array.from(
                { length: Math.min(500, start + n - i) },
                (_, j) => ({ id: i + j, eid: `e${i + j}`, num: i + j }),
              ),
            ),
          )
        }
      }
      add(1, 100)
      let at = (n: number) =>
        `2026-10-${String(n).padStart(2, '0')}T00:00:00.000Z`
      if (sparse) {
        d.query(
          insert(
            'wake',
            { entity: 1, at: at(1) },
            { entity: 2, at: at(1) },
            { entity: 3, at: at(5) },
            { entity: 4, at: null },
            { entity: 5, at: 'invalid' },
            { entity: 6, at: at(2) },
          ),
        )
      }
      d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
      let m = measured(db, d)
      for (let history of [100, 20000]) {
        if (history > 100) {
          add(101, history - 100)
          if (sparse) {
            d.query(
              insert(
                'wake',
                ...Array.from(
                  { length: 2000 },
                  (_, i) => ({ entity: i + 101, at: at(31) }),
                ),
              ),
            )
          }
        }
        for (
          let [q, expected] of [
            [`.wake.at<=${at(4)}&.order=wake.at`, ['e2', 'e1', 'e6']],
            [`.wake.at>${at(4)}&.order=wake.at&.limit=1`, ['e3']],
            [`.wake.at=${at(1)}&.order=-wake.at&.limit=1`, ['e2']],
            [`.wake.at>=${at(2)}&.wake.at<${at(6)}&.order=-wake.at&.limit=2`, [
              'e3',
              'e6',
            ]],
          ] as const
        ) {
          let stmt = compile(parse(q), vocab)
          for (let phase of ['cold', 'warm']) {
            let result = m.read(() => m.driver.query(stmt))
            assertEquals(
              result.value.map((r) => r.eid),
              sparse ? [...expected] : [],
            )
            for (let c of result.costs) {
              let label = `${history} ${phase} ${q}\n${c.sql}\n${
                c.plan.join('\n')
              }`
              assert(c.scans < 20, `${c.scans} full-scan advances: ${label}`)
              assert(c.steps < 500, `${c.steps} VM instructions: ${label}`)
              assert(c.plan.some((p) => /SEARCH wake .*wake_at/.test(p)), label)
            }
          }
        }
      }
    } finally {
      db.close()
    }
  })
}
