// The native-session `standing` facet (T-17855): the O(1) fact SessionDot reads
// instead of scanning the whole entry log per render (was 157ms/dot). These
// drive the facet through the RUNNER's own write path — append() then cast(),
// which never dispatches effects — so cast is what maintains it. The facet
// equals standingOf(the log) at every turn edge, and holds the last edge value
// between edges (a steady 'running' through a tool loop). This file holds that
// seam without the server, browser, or a subprocess — a lean file (no git
// scratch repo) so each test is just an in-memory graph write.
Deno.env.set('DB_PATH', ':memory:')

import { assert, assertEquals } from '@std/assert'
import { type Change } from './types.ts'
import { apply, db } from './db.ts'
import {
  maintainStanding,
  maintainStandingFor,
  standingBackfill,
} from './sessions.ts'
import { append, cancelEntry, readEntries, takeEntry } from './entries.ts'
import { standingOf } from './entry_log.ts'
import { runnerSessions } from './managed_codex.ts'
import { sessionRow } from './session_store.ts'

let uid = () => crypto.randomUUID()

// Component/edge tables are keyed by the integer `entity` spine id now; eids stay
// the wire identity, so raw SQL translates at the boundary.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`

// Mirror the server's cast: it maintains the facet on every broadcast batch, and
// maintainStandingFor's stamp casts back through this same cast (as a `session`
// change, never a turn-edge comp — so it cannot recurse).
let heard: Change[] = []
let cast = (c: Change[]) => {
  heard.push(...c)
  maintainStandingFor(c, cast)
}

// A native (graph-born, managed-codex) session: origin managed, no lifecycle
// status, provider codex. graphSession() also needs a non-imported entry, which
// the turns below supply.
let native = () => {
  let eid = uid()
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: uid(), provider: 'codex' },
  }])
  db.prepare(`update session set origin = 'managed' where ${OWNED}`).run(eid)
  return eid
}

let standing = (eid: string) => sessionRow(db, eid)?.standing ?? null
let finishedAt = (eid: string) => sessionRow(db, eid)?.finished_at ?? null

// Drive a session through one whole turn to `terminal`: a user prompt, a
// generation, its delivery, and the final-answer output.
let toTerminal = (eid: string) => {
  let input = uid(), gen = uid()
  cast(
    append(
      db,
      eid,
      [{ message: { role: 'user' }, content: { body: 'go' } }],
      null,
      [input],
    )
      .changes,
  )
  cast(
    append(
      db,
      eid,
      [{ generation: { through: input, provider: 'codex', model: 'm' } }],
      null,
      [gen],
    )
      .changes,
  )
  cast(apply(db, [{ eid: gen, name: 'delivered', comp: { at: 'now' } }]))
  cast(
    append(db, eid, [{
      output: { source: gen, phase: 'final_answer' },
      message: { role: 'agent' },
      content: { body: 'done' },
    }]).changes,
  )
}

// Arm a wake for a session — a `wake` aimed at it via deliver.to, undelivered.
let arm = (to: string) => {
  let w = uid()
  cast(apply(db, [
    { eid: w, name: 'wake', comp: { at: 'now' } },
    { eid: w, name: 'deliver', comp: { to } },
  ]))
  return w
}

Deno.test('native standing tracks the log across turn edges', () => {
  let eid = native()
  let truth = () => standingOf(readEntries(db, eid))

  // A turn opens: a user prompt, then a generation → busy.
  let input = uid(), gen = uid()
  cast(
    append(
      db,
      eid,
      [{
        message: { role: 'user' },
        content: { body: 'go' },
      }],
      null,
      [input],
    ).changes,
  )
  cast(
    append(
      db,
      eid,
      [{
        generation: { through: input, provider: 'codex', model: 'm' },
      }],
      null,
      [gen],
    ).changes,
  )
  assertEquals(standing(eid), 'busy')
  assertEquals(standing(eid), truth())

  // The turn closes: delivered + a final-answer output → terminal.
  cast(apply(db, [{ eid: gen, name: 'delivered', comp: { at: 'now' } }]))
  cast(
    append(db, eid, [{
      output: { source: gen, phase: 'final_answer' },
      message: { role: 'agent' },
      content: { body: 'done' },
    }]).changes,
  )
  assertEquals(standing(eid), 'terminal')
  assertEquals(standing(eid), truth())

  // A user turn reopens it — out of terminal (idle), not busy.
  cast(
    append(db, eid, [{
      message: { role: 'user' },
      content: { body: 'again' },
    }]).changes,
  )
  assertEquals(standing(eid), 'idle')
  assertEquals(standing(eid), truth())
})

Deno.test('cancelling a leased turn leaves its standing idle', () => {
  let eid = native()
  let input = append(db, eid, [{ message: { role: 'user' } }]).eids[0]
  let gen = append(db, eid, [{
    generation: { through: input, provider: 'codex', model: 'm' },
  }]).eids[0]
  let runner = uid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: uid() } }])
  let lease = takeEntry(db, gen, runner)!
  cast(lease.changes)
  assertEquals(standing(eid), 'busy')

  cast(append(db, eid, [{ cancel: { target: gen } }]).changes)
  assertEquals(standing(eid), 'busy')
  cast(cancelEntry(db, lease.token))
  assertEquals(standing(eid), 'idle')
  assertEquals(standing(eid), standingOf(readEntries(db, eid)))
})

Deno.test('the tool loop holds standing steady between edges', () => {
  let eid = native()
  let input = uid(), gen = uid()
  cast(
    append(
      db,
      eid,
      [{
        message: { role: 'user' },
        content: { body: 'go' },
      }],
      null,
      [input],
    ).changes,
  )
  cast(
    append(
      db,
      eid,
      [{
        generation: { through: input, provider: 'codex', model: 'm' },
      }],
      null,
      [gen],
    ).changes,
  )
  assertEquals(standing(eid), 'busy')

  // A tool call and its result land mid-turn. call/result are NOT turn edges, so
  // the cast hook does NOT recompute — deliberately. In production the runner
  // holds an operation lease across the loop, so standingOf reads busy anyway;
  // between operations it can momentarily read idle. The facet holds the last
  // edge value ('busy') across the loop, so the dot shows a steady 'running'
  // instead of flickering idle between tool calls — and the write path never
  // scans the log per tool call.
  let call = uid()
  cast(
    append(
      db,
      eid,
      [{
        output: { source: gen },
        call: { key: 'c1' },
        bash: { command: 'ls' },
      }],
      null,
      [call],
    ).changes,
  )
  cast(
    append(db, eid, [{
      result: { call },
      content: { body: 'ok' },
      exit: { code: 0 },
    }]).changes,
  )
  assertEquals(standing(eid), 'busy')

  // The turn's real close (delivered + final answer) reconciles it exactly.
  cast(apply(db, [{ eid: gen, name: 'delivered', comp: { at: 'now' } }]))
  cast(
    append(db, eid, [{
      output: { source: gen, phase: 'final_answer' },
      message: { role: 'agent' },
      content: { body: 'done' },
    }]).changes,
  )
  assertEquals(standing(eid), 'terminal')
  assertEquals(standing(eid), standingOf(readEntries(db, eid)))
})

Deno.test('standing backfill stamps native sessions and skips process ones', async () => {
  // Native: a log exists (raw append, NOT cast) so the facet was never stamped.
  let n = native()
  let input = uid()
  append(
    db,
    n,
    [{ message: { role: 'user' }, content: { body: 'go' } }],
    null,
    [input],
  )
  append(db, n, [{
    generation: { through: input, provider: 'codex', model: 'm' },
  }])
  assertEquals(standing(n), null)
  assert(runnerSessions(db).includes(n))

  // Process (non-native): no non-imported entry, so graphSession is false.
  let proc = uid()
  apply(db, [{
    eid: proc,
    name: 'session',
    comp: { id: uid(), provider: 'claude' },
  }])

  await standingBackfill(cast)
  assertEquals(standing(n), 'busy')
  assertEquals(standing(n), standingOf(readEntries(db, n)))

  // maintainStanding is a no-op on a process session (graphSession false).
  maintainStanding(proc, cast)
  assertEquals(standing(proc), null)
})

Deno.test('finished_at marks a truly-ended operator and clears on reawaken', () => {
  let eid = native()
  assertEquals(finishedAt(eid), null)

  // A terminal turn with no wake armed: the run is done → finished_at set.
  toTerminal(eid)
  assertEquals(standing(eid), 'terminal')
  assert(finishedAt(eid) != null, 'a terminal run with no wake is finished')

  // A new user turn reopens it → idle, no longer finished (the door reopened).
  cast(
    append(db, eid, [{ message: { role: 'user' }, content: { body: 'again' } }])
      .changes,
  )
  assertEquals(standing(eid), 'idle')
  assertEquals(finishedAt(eid), null)
})

Deno.test('a parked operator (terminal + pending wake) is never finished', () => {
  // Wake armed BEFORE the terminal edge — the operator schedules its own return
  // mid-turn, so the terminal edge sees it pending and never finishes it.
  let a = native()
  arm(a)
  toTerminal(a)
  assertEquals(standing(a), 'terminal')
  assertEquals(finishedAt(a), null)

  // Wake armed AFTER the terminal edge — arming re-derives the target, clearing
  // the finished stamp so the dot reads idle (parked), not completed.
  let b = native()
  toTerminal(b)
  assert(finishedAt(b) != null)
  arm(b)
  assertEquals(finishedAt(b), null)
})

Deno.test('a delivered wake lets a still-terminal operator finish', () => {
  // Parked (wake pending) → not finished. The wake then fires (delivered) and the
  // operator ends without a new turn; the next reconcile (boot backfill / edge)
  // sees no pending wake and finishes the terminal run.
  let eid = native()
  let w = arm(eid)
  toTerminal(eid)
  assertEquals(finishedAt(eid), null)
  // The wake fires: the server stamps `delivered` (at/via are server-owned, not
  // wire-writable) — mirror that with a direct insert.
  db.prepare(`insert into delivered (entity, at) values (${idOf}, ?)`).run(
    w,
    'now',
  )
  maintainStanding(eid, cast)
  assert(finishedAt(eid) != null)
})

Deno.test('finished_at holds steady across re-derives (no lastHeard churn)', () => {
  let eid = native()
  toTerminal(eid)
  let first = finishedAt(eid)
  assert(first != null)
  // Re-deriving a settled run must not move the stamp — a fresh lastHeard each
  // edge would churn updated.at and re-trigger every client.
  maintainStanding(eid, cast)
  maintainStanding(eid, cast)
  assertEquals(finishedAt(eid), first)
})
