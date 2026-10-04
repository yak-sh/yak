// Identity gathers must seek their owners even when statistics predate history.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { archetypeDoc } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import {
  type Driver,
  insert,
  type Param,
  render,
  type Row,
  type Stmt,
} from '@yaks/sql'
import { get, storage } from './mod.ts'
import { driver } from './native.ts'
import { reclassify } from './archetype.ts'
import { sqlitePath } from './sqlitepath.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    session: {
      component: true,
      type: 'object',
      properties: {
        id: { type: 'string' },
        actor: { type: 'string', ref: 'entity' },
        source: { type: 'string', ref: 'entity' },
        persona: { type: 'string', ref: 'entity' },
        log: { type: 'string', ref: 'entity' },
      },
    },
    call: {
      component: true,
      type: 'object',
      properties: {
        to: { type: 'string', ref: 'entity' },
        id: { type: 'string' },
        args: { type: 'object' },
        source: { type: 'string', ref: 'entity' },
      },
    },
  },
}])

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

for (let name of ['session', 'call']) {
  test(`${name} identity gathers seek a few rows despite stale small-table statistics`, () => {
    let db = new Database(':memory:'), d = driver(db)
    try {
      storage(d, vocab).install()
      let add = (start: number, count: number, facets: boolean) => {
        for (let offset = 0; offset < count; offset += 500) {
          let ids = Array.from(
            { length: Math.min(500, count - offset) },
            (_, i) => start + offset + i,
          )
          d.query(insert('entity', ...ids.map((id) => ({ id, eid: `e${id}` }))))
          if (facets) {
            d.query(insert(
              name,
              ...ids.map((entity): Record<string, Param> =>
                name == 'session'
                  ? {
                    entity,
                    id: `s${entity}`,
                    actor: 90,
                    source: 91,
                    persona: 92,
                    log: 93,
                  }
                  : {
                    entity,
                    to: 90,
                    id: `c${entity}`,
                    args: '{"hello":"world"}',
                    source: 91,
                  }
              ),
            ))
          }
        }
      }
      add(1, 100, false)
      let facets = Array.from({ length: 61 }, (_, i) => i + 1)
      d.query(
        insert(
          name,
          ...facets.map((entity): Record<string, Param> =>
            name == 'session'
              ? {
                entity,
                id: `s${entity}`,
                actor: 90,
                source: 91,
                persona: 92,
                log: 93,
              }
              : {
                entity,
                to: 90,
                id: `c${entity}`,
                args: '{"hello":"world"}',
                source: 91,
              }
          ),
        ),
      )
      reclassify(d, ['e1'])
      // The optimizer learned a small component; history subsequently grows.
      d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
      add(20000, 20000, true)
      let m = measured(db, d)
      let cold = m.read(() => get(m.driver, vocab, ['e1']))
      let warm = m.read(() => get(m.driver, vocab, ['e1']))
      assertEquals(warm.value, cold.value)
      assertEquals(
        cold.value[0][name],
        name == 'session'
          ? {
            id: 's1',
            actor: 'e90',
            source: 'e91',
            persona: 'e92',
            log: 'e93',
          }
          : {
            to: 'e90',
            id: 'c1',
            args: { hello: 'world' },
            source: 'e91',
          },
      )
      for (let [phase, result] of [['cold', cold], ['warm', warm]] as const) {
        let costs = result.costs.filter((c) =>
          c.sql.includes(`"${name}"`) || c.sql.includes('"eid"')
        )
        assert(costs.length > 0)
        for (let c of costs) {
          assert(
            c.scans == 0,
            `${phase}: ${c.scans} full-scan advances\n${c.sql}\n${
              c.plan.join('\n')
            }`,
          )
          assert(
            c.steps < 300,
            `${phase}: ${c.steps} VM instructions\n${c.sql}\n${
              c.plan.join('\n')
            }`,
          )
        }
      }
    } finally {
      db.close()
    }
  })
}
