import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { archetypeDoc } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { col, eq, val } from '@yaks/sql'
import { storage } from './mod.ts'
import { componentTables } from './physical.ts'
import { preparedDriver, snapshot } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    player: {
      component: true,
      properties: { active: { type: 'boolean' } },
    },
    position: {
      component: true,
      properties: { x: { type: 'number' } },
    },
    details: {
      component: true,
      properties: {
        title: { type: 'string' },
        level: { type: 'number', default: 7 },
      },
    },
    summary: {
      component: true,
      properties: { value: { type: 'number', computed: true } },
    },
  },
}])
// A store over its own copy of the schema, holding these heroes, active.
let store = (...heroes: string[]) => {
  let d = preparedDriver(snapshot(vocab))
  let s = storage(d, vocab, {
    schemaReady: () => true,
    derived: { 'summary.value': { tag: 'number', expr: () => val(9) } },
  })
  graph({ vocab, storage: s }).apply(
    heroes.map((eid) => ({ entity: { eid }, player: { active: true } })),
  )
  s.get(heroes)
  return { d, s }
}
// The cases keep apart by their heroes. What a connection finds out once, the
// file's component tables (./physical.ts), is no case's subject.
let { d, s } = store('known', 'shaped', 'nested', 'gone', 'computed')
componentTables(d)
// Direct SQL makes the store forget what it held: that case has its own.
let raw = store('guarded')
// Every statement the store sends, and those that read a component table.
let calls = 0, census = 0
let query = d.query
d.query = (stmt) => {
  calls++
  if (
    stmt.t == 'select' && !Array.isArray(stmt.from) &&
    stmt.from && 't' in stmt.from && stmt.from.t == 'table' &&
    ['player', 'position', 'details', 'summary'].includes(stmt.from.name)
  ) census++
  return query(stmt)
}
let value = (rows: Bundle[]) => rows[0]?.player

test('projected transaction getters use their authoritative writes before classification', () => {
  s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'known' },
      position: { x: 7 },
      player: { active: false },
    }])
    calls = census = 0
    assertEquals(value(tx.get(['known'], ['player']) as Bundle[]), {
      active: false,
    })
    assertEquals(calls, 0)
  })
  // Its complete after-state already establishes its component presence;
  // settlement need not read every physical table to establish it again.
  assertEquals(census, 0)
})

test('projected transaction facts are detached and cannot survive rollback or direct SQL', () => {
  assertThrows(() =>
    raw.s.tx((tx) => {
      tx.patch([{
        entity: { eid: 'guarded' },
        position: { x: 7 },
        player: { active: false },
      }])
      let rows = tx.get(['guarded'], ['player']) as Bundle[]
      ;(rows[0].player as { active: boolean }).active = true
      assertEquals(value(tx.get(['guarded'], ['player']) as Bundle[]), {
        active: false,
      })
      raw.d.query({
        t: 'update',
        table: 'player',
        set: { active: val(true) },
        where: eq(col('entity'), val(1)),
      })
      assertEquals(value(tx.get(['guarded'], ['player']) as Bundle[]), {
        active: true,
      })
      throw Error('rollback')
    })
  )
  assertEquals(value(raw.s.get(['guarded'], ['player'])), { active: true })
  assertEquals(raw.s.get(['guarded'], ['position'])[0].position, undefined)
})

test('projected transaction getters preserve SQL coercion and defaults', () => {
  s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'shaped' },
      details: { title: 34 },
    }])
    let rows = tx.get(['shaped'], ['details']) as Bundle[]
    assertEquals(rows[0].details, { title: '34', level: 7 })
  })
})

test('projected transaction getters follow nested rollback to the outer write', () => {
  s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'nested' },
      player: { active: false },
    }])
    assertThrows(() =>
      s.tx((inner) => {
        inner.patch([{ entity: { eid: 'nested' }, player: { active: true } }])
        assertEquals(value(inner.get(['nested'], ['player']) as Bundle[]), {
          active: true,
        })
        throw Error('rollback inner')
      })
    )
    assertEquals(value(tx.get(['nested'], ['player']) as Bundle[]), {
      active: false,
    })
  })
  assertEquals(value(s.get(['nested'], ['player'])), { active: false })
})

test('projected transaction getters preserve tombstones and component removals', () => {
  s.tx((tx) => {
    tx.remove([{ eid: 'gone' }])
    let row = (tx.get(['gone'], ['player']) as Bundle[])[0]
    assertEquals(row.player, undefined)
    assertEquals(row.tombstone, {})
  })
})

test('projected transaction getters retain SQL computed values', () => {
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'computed' }, summary: {} }])
    assertEquals((tx.get(['computed'], ['summary']) as Bundle[])[0].summary, {
      value: 9,
    })
  })
})
