// Registered jobs retain graph tuning, state gates, and decision records.
// Unregistered historical roles have no behavior, even when marked running.
import { assertEquals, assertThrows } from '@std/assert'
import type { Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, cursorOf, readComp } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { registerSystem, stamp, systemSweep } = await import('./system_jobs.ts')
let { rejectJournal } = await import('./testdb.ts')
let heard: Change[] = []
let cast = (changes: Change[]) => heard.push(...changes)
let seed = (slug: string, comp: Record<string, unknown> = {}) => {
  let eid = crypto.randomUUID()
  apply(db, [
    { eid, name: 'alias', comp: { slug } },
    {
      eid,
      name: 'role',
      comp: { state: 'running', surface: 'managed', ...comp },
    },
  ])
  return eid
}

Deno.test('jobs require a running control and use graph tuning over defaults', () => {
  let calls: unknown[] = []
  registerSystem({
    alias: 'test-job',
    defaults: { quiet: 900, cooldown: 3600 },
    run: (t) => {
      calls.push(t)
      return { reason: 'nothing' }
    },
  })
  systemSweep(cast)
  assertEquals(calls, [])
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'alias', comp: { slug: 'test-job' } }])
  systemSweep(cast)
  assertEquals(calls, [])
  apply(db, [{ eid, name: 'role', comp: { state: 'running' } }])
  systemSweep(cast)
  assertEquals(calls, [{ quiet: 900, cooldown: 3600 }])
  apply(db, [{
    eid,
    name: 'role',
    comp: { quiet: 60, cooldown: 120, cap: 5 },
  }])
  let unregistered = seed('test-operator')
  systemSweep(cast)
  assertEquals(calls.at(-1), { quiet: 60, cooldown: 120 })
  assertEquals(readComp(db, eid, 'role')?.reason, 'nothing')
  assertEquals(readComp(db, unregistered, 'role')?.decision, null)
  apply(db, [{ eid, name: 'role', comp: { state: 'stopped' } }])
  systemSweep(cast)
  assertEquals(calls.length, 2)
  assertEquals(readComp(db, eid, 'role')?.reason, 'state stopped')
  apply(db, [{ eid, name: 'role', comp: null }])
  systemSweep(cast)
  assertEquals(calls.length, 2)
})

Deno.test('jobs record observed work and recover from errors', () => {
  let eid = seed('test-work', { cap: 5 })
  let failure = false
  let tuning: unknown
  registerSystem({
    alias: 'test-work',
    defaults: { quiet: 0, cooldown: 60, cap: 2 },
    run: (t) => {
      tuning = t
      if (failure) throw new Error('failed job')
      return { reason: '1 waiting', observed: eid }
    },
  })
  systemSweep(cast)
  assertEquals(tuning, { quiet: 0, cooldown: 60, cap: 5 })
  assertEquals(readComp(db, eid, 'role')?.observed, eid)
  assertEquals(readComp(db, eid, 'role')?.decision, 'spawn')
  failure = true
  systemSweep(cast)
  assertEquals(readComp(db, eid, 'error')?.message, 'Error: failed job')
  failure = false
  systemSweep(cast)
  assertEquals(readComp(db, eid, 'error'), undefined)
})

Deno.test('decision time changes only with the decision or observed work', () => {
  let eid = seed('test-stamp')
  let decide = (decision: string, reason: string, decided_at: string) =>
    stamp(eid, { decision, reason, decided_at, observed: null }, cast)
  decide('skip', '1 waiting', 'T1')
  decide('skip', '2 waiting', 'T2')
  assertEquals(readComp(db, eid, 'role')?.decided_at, 'T1')
  decide('spawn', '2 waiting', 'T3')
  assertEquals(readComp(db, eid, 'role')?.decided_at, 'T3')
  heard = []
  decide('spawn', '2 waiting', 'T4')
  assertEquals(heard, [])
})

Deno.test('a job decision and its error roll back when journaling fails', () => {
  let eid = seed('test-journal-failure')
  let before = readComp(db, eid, 'role')
  let cursor = cursorOf(db)
  heard = []
  let restore = rejectJournal(db)
  try {
    assertThrows(
      () =>
        stamp(eid, {
          decision: 'skip',
          reason: 'failed',
          error: 'unavailable',
        }, cast),
      Error,
      'journal unavailable',
    )
    assertEquals(readComp(db, eid, 'role'), before)
    assertEquals(readComp(db, eid, 'error'), undefined)
    assertEquals(cursorOf(db), cursor)
    assertEquals(heard, [])
  } finally {
    restore()
  }
})
