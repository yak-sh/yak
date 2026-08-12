// Graph-native Session entries: ordered append, immutable facts, lazy root
// sync, and server-owned runner outcomes.
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import {
  append,
  cancelEntry,
  expiredLeases,
  failEntry,
  readEntries,
  readyEntries,
  reclaimEntry,
  renewEntry,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, delta, numbered, open, snapshot } = await import('./db.ts')

let session = (db: ReturnType<typeof open>, id = uuid()) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: { id } }])
  return eid
}

Deno.test('entries append in partition order and stay out of the root graph', () => {
  let db = open(':memory:')
  let a = session(db), b = session(db)
  let before = snapshot(db).cursor ?? 0
  let first = append(db, a, [
    { message: { role: 'user' }, content: { body: 'one' } },
    { attention: {} },
  ])
  let other = append(db, b, [{ message: { role: 'user' } }])

  assertEquals(readEntries(db, a).map((e) => e.seq), [1, 2])
  assertEquals(readEntries(db, b).map((e) => e.seq), [1])
  assertEquals(readEntries(db, a)[0].comps.content.body, 'one')
  assertEquals(readEntries(db, a)[0].comps.entity.num, null)
  assertEquals(numbered('entry'), false)
  let hidden = new Set([...first.eids, ...other.eids])
  assertEquals(
    snapshot(db).changes.some((c) => hidden.has(c.eid)),
    false,
  )
  assertEquals(delta(db, before).changes.some((c) => hidden.has(c.eid)), false)
  db.close()
})

Deno.test('entry facets are born together and immutable thereafter', () => {
  let db = open(':memory:')
  let sid = session(db)
  let { eids } = append(db, sid, [
    { message: { role: 'user' }, content: { body: 'fixed' } },
  ])
  assertThrows(
    () =>
      apply(db, [{ eid: eids[0], name: 'content', comp: { body: 'moved' } }]),
    Error,
    'immutable',
  )
  assertThrows(
    () => apply(db, [{ eid: eids[0], name: 'message', comp: null }]),
    Error,
    'immutable',
  )
  assertThrows(
    () =>
      apply(db, [{ eid: uuid(), name: 'content', comp: { body: 'orphan' } }]),
    Error,
    'needs entry in its batch',
  )
  assertThrows(
    () => apply(db, [{ eid: uuid(), name: 'entry', comp: {} }]),
    Error,
    'needs a session',
  )
  assertEquals(readEntries(db, sid)[0].comps.content.body, 'fixed')
  db.close()
})

Deno.test('the keyword-named apply facet round trips as one graph change', () => {
  let db = open(':memory:')
  let sid = session(db)
  let change = JSON.stringify({
    eid: uuid(),
    name: 'doc',
    comp: { title: 'x' },
  })
  append(db, sid, [{ apply: { change } }])
  assertEquals(readEntries(db, sid)[0].comps.apply.change, change)
  db.close()
})

Deno.test('lease and usage facets are server-owned and one runner wins', () => {
  let db = open(':memory:')
  let sid = session(db)
  let runner = uuid(), rival = uuid()
  apply(db, [
    { eid: runner, name: 'runner', comp: { name: 'one' } },
    { eid: rival, name: 'runner', comp: { name: 'two' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: {
      through: input,
      provider: 'codex',
      model: 'gpt-test',
    },
  }]).eids[0]
  apply(db, [
    { eid: generation, name: 'lease', comp: {} },
    { eid: generation, name: 'usage', comp: {} },
  ])
  assertEquals(
    db.prepare('select 1 from lease where eid = ?').get(generation),
    undefined,
  )
  assertEquals(readyEntries(db, sid).map((e) => e.eid), [generation])
  let won = takeEntry(
    db,
    generation,
    runner,
    1000,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(takeEntry(db, generation, rival), undefined)
  assertEquals(readyEntries(db, sid), [])
  let settled = settleGeneration(db, won.token, {
    input: 10,
    cached: 4,
    output: 5,
    reasoning: 2,
  }, () => new Date('2026-08-10T12:00:01Z'))
  assertEquals(settled.map((c) => c.name), ['usage', 'delivered', 'lease'])
  let row = readEntries(db, sid).find((e) => e.eid == generation)!.comps
  assertEquals(row.usage, {
    eid: generation,
    input: 10,
    cached: 4,
    output: 5,
    reasoning: 2,
  })
  assertEquals(row.lease, undefined)
  assertEquals(readyEntries(db, sid), [])
  db.close()
})

Deno.test('only expired generation and graph_query leases can be reclaimed', () => {
  let db = open(':memory:')
  let sid = session(db), old = uuid(), next = uuid()
  apply(db, [
    { eid: old, name: 'runner', comp: { name: 'old' } },
    { eid: next, name: 'runner', comp: { name: 'next' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let stale = takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(
    reclaimEntry(
      db,
      stale.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.050Z'),
    ),
    undefined,
  )
  let won = reclaimEntry(
    db,
    stale.token,
    next,
    100,
    () => new Date('2026-08-10T12:00:00.200Z'),
  )!
  assertEquals(won.token.eid, generation)
  assertEquals(won.token.holder, next)
  assertEquals(won.kind, 'generation')
  assertEquals(settleGeneration(db, stale.token), [])

  let query = append(db, sid, [{
    output: { source: generation },
    call: { key: 'read-only' },
    graph_query: { query: '.task.status=open' },
  }]).eids[0]
  let queryLease = takeEntry(
    db,
    query,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  let queryRetry = reclaimEntry(
    db,
    queryLease.token,
    next,
    100,
    () => new Date('2026-08-10T12:00:00.200Z'),
  )!
  assertEquals(queryRetry.token.eid, query)
  assertEquals(queryRetry.kind, 'call')

  append(db, sid, [{
    output: { source: generation },
    call: { key: 'side-effect' },
    bash: { command: 'echo once' },
  }])
  let call = readEntries(db, sid).at(-1)!.eid
  let sideEffect = takeEntry(
    db,
    call,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(
    reclaimEntry(
      db,
      sideEffect.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.200Z'),
    ),
    undefined,
  )
  db.close()
})

Deno.test('a held lease renews forward, blocking a successor reclaim', () => {
  let db = open(':memory:')
  let sid = session(db), old = uuid(), next = uuid()
  apply(db, [
    { eid: old, name: 'runner', comp: { name: 'old' } },
    { eid: next, name: 'runner', comp: { name: 'next' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let held = takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  // The lease would lapse at 12:00:00.100; renew past it before it does.
  let renewed = renewEntry(
    db,
    held.token,
    100,
    () => new Date('2026-08-10T12:00:00.050Z'),
  )!
  assertEquals(renewed.token.until, '2026-08-10T12:00:00.150Z')
  assertEquals(renewed.token.holder, old)
  assertEquals(renewed.token.at, held.token.at)
  // A successor sees no expired lease and cannot reclaim it.
  assertEquals(expiredLeases(db, '2026-08-10T12:00:00.120Z'), [])
  assertEquals(
    reclaimEntry(
      db,
      held.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.120Z'),
    ),
    undefined,
  )
  // The holder's own settle still owns it: renewal left holder+at untouched.
  assert(
    settleGeneration(
      db,
      held.token,
      undefined,
      () => new Date('2026-08-10T12:00:00.130Z'),
    ).length,
  )
  db.close()
})

Deno.test('renewal refuses a cancelled or absent lease', () => {
  let db = open(':memory:')
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let held = takeEntry(db, generation, runner, 1000)!
  append(db, sid, [{ cancel: { target: generation } }])
  assertEquals(renewEntry(db, held.token, 1000), undefined)
  cancelEntry(db, held.token)
  assertEquals(renewEntry(db, held.token, 1000), undefined)
  db.close()
})

Deno.test('cancellation rejects late generation settlement', () => {
  let db = open(':memory:')
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let won = takeEntry(db, generation, runner)!
  append(db, sid, [{ cancel: { target: generation } }])
  assertEquals(
    settleGeneration(db, won.token, {
      input: 1,
      cached: 0,
      output: 1,
      reasoning: 0,
    }),
    [],
  )
  assertEquals(
    readEntries(db, sid).find((e) => e.eid == generation)!.comps
      .usage,
    undefined,
  )
  db.close()
})

Deno.test('failed leased work stays visible and cannot rerun', () => {
  let db = open(':memory:')
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let won = takeEntry(db, generation, runner)!
  let failed = failEntry(db, won.token, 'provider unavailable')
  assertEquals(failed.map((c) => c.name), ['error', 'lease'])
  assertMatch(
    String(
      readEntries(db, sid).find((e) => e.eid == generation)!.comps.error
        .message,
    ),
    /provider unavailable/,
  )
  assertEquals(readyEntries(db, sid), [])
  db.close()
})

Deno.test('readEntries returns the whole partition past the pagination cap', () => {
  let db = open(':memory:')
  let sid = session(db)
  // A long-lived Session outgrows one entriesOf page. The runner reads the
  // WHOLE partition every operation, so the newest generation and a late call
  // must both stay visible: a truncated tail is what stamped a live session
  // "no generation entry" (generate() found no generation row) and "reading
  // 'comps'" (rowOf() returned undefined for a call it could not see) — T-16793.
  let bulk = Array.from({ length: 504 }, () => ({
    message: { role: 'user' as const },
  }))
  let base = append(db, sid, bulk)
  let tail = append(db, sid, [
    {
      generation: { through: base.eids.at(-1)!, provider: 'codex', model: 'x' },
    },
    { call: { key: 'call_tail' }, bash: { command: 'echo hi' } },
  ])
  let rows = readEntries(db, sid)
  assertEquals(rows.length, 506)
  let [gen, call] = tail.eids
  assert(rows.find((e) => e.eid == gen)?.comps.generation)
  assert(rows.find((e) => e.eid == call)?.comps.call)
  db.close()
})

Deno.test('deleting a Session cascades its lazy entries', () => {
  let db = open(':memory:')
  let sid = session(db)
  append(db, sid, [{ message: { role: 'user' } }, { attention: {} }])
  apply(db, [{ eid: sid, name: 'entity', comp: null }])
  assertEquals(readEntries(db, sid), [])
  db.close()
})
