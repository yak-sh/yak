import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { archetypeDoc } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { col, eq, val } from '@yaks/sql'
import { storage } from './mod.ts'
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
let fixture = () => {
  let d = preparedDriver(snapshot(vocab))
  let s = storage(d, vocab, {
    schemaReady: () => true,
    derived: { 'summary.value': { tag: 'number', expr: () => val(9) } },
  })
  let g = graph({ vocab, storage: s })
  g.apply([{ entity: { eid: 'hero' }, player: { active: true } }])
  s.get(['hero'])
  let query = d.query, calls = 0, census = 0
  d.query = (stmt) => {
    calls++
    if (
      stmt.t == 'select' && !Array.isArray(stmt.from) &&
      stmt.from && 't' in stmt.from && stmt.from.t == 'table' &&
      ['player', 'position', 'details', 'summary'].includes(stmt.from.name)
    ) census++
    return query(stmt)
  }
  return {
    d,
    s,
    calls: () => calls,
    census: () => census,
    reset: () => {
      calls = 0
      census = 0
    },
  }
}
let value = (rows: Bundle[]) => rows[0]?.player

let known = fixture()
test('projected transaction getters use their authoritative writes before classification', () => {
  known.s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'hero' },
      position: { x: 7 },
      player: { active: false },
    }])
    known.reset()
    assertEquals(value(tx.get(['hero'], ['player']) as Bundle[]), {
      active: false,
    })
    assertEquals(known.calls(), 0)
  })
  // Its complete after-state already establishes its component presence;
  // settlement need not read every physical table to establish it again.
  assertEquals(known.census(), 0)
})

let guarded = fixture()
test('projected transaction facts are detached and cannot survive rollback or direct SQL', () => {
  assertThrows(() =>
    guarded.s.tx((tx) => {
      tx.patch([{
        entity: { eid: 'hero' },
        position: { x: 7 },
        player: { active: false },
      }])
      let rows = tx.get(['hero'], ['player']) as Bundle[]
      ;(rows[0].player as { active: boolean }).active = true
      assertEquals(value(tx.get(['hero'], ['player']) as Bundle[]), {
        active: false,
      })
      guarded.d.query({
        t: 'update',
        table: 'player',
        set: { active: val(true) },
        where: eq(col('entity'), val(1)),
      })
      assertEquals(value(tx.get(['hero'], ['player']) as Bundle[]), {
        active: true,
      })
      throw Error('rollback')
    })
  )
  assertEquals(value(guarded.s.get(['hero'], ['player'])), { active: true })
  assertEquals(guarded.s.get(['hero'], ['position'])[0].position, undefined)
})

let shaped = fixture()
test('projected transaction getters preserve SQL coercion and defaults', () => {
  shaped.s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'hero' },
      details: { title: 34 },
    }])
    let rows = tx.get(['hero'], ['details']) as Bundle[]
    assertEquals(rows[0].details, { title: '34', level: 7 })
  })
})

let nested = fixture()
test('projected transaction getters follow nested rollback to the outer write', () => {
  nested.s.tx((tx) => {
    tx.patch([{
      entity: { eid: 'hero' },
      player: { active: false },
    }])
    assertThrows(() =>
      nested.s.tx((inner) => {
        inner.patch([{ entity: { eid: 'hero' }, player: { active: true } }])
        assertEquals(value(inner.get(['hero'], ['player']) as Bundle[]), {
          active: true,
        })
        throw Error('rollback inner')
      })
    )
    assertEquals(value(tx.get(['hero'], ['player']) as Bundle[]), {
      active: false,
    })
  })
  assertEquals(value(nested.s.get(['hero'], ['player'])), { active: false })
})

let gone = fixture()
test('projected transaction getters preserve tombstones and component removals', () => {
  gone.s.tx((tx) => {
    tx.remove([{ eid: 'hero' }])
    let row = (tx.get(['hero'], ['player']) as Bundle[])[0]
    assertEquals(row.player, undefined)
    assertEquals(row.tombstone, {})
  })
})

let computed = fixture()
test('projected transaction getters retain SQL computed values', () => {
  computed.s.tx((tx) => {
    tx.patch([{ entity: { eid: 'hero' }, summary: {} }])
    assertEquals((tx.get(['hero'], ['summary']) as Bundle[])[0].summary, {
      value: 9,
    })
  })
})
