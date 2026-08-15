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
import { append, readEntries } from './entries.ts'
import { standingOf } from './entry_log.ts'
import { runnerSessions } from './managed_codex.ts'
import { sessionRow } from './session_store.ts'

let uid = () => crypto.randomUUID()

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
  db.prepare("update session set origin = 'managed' where eid = ?").run(eid)
  return eid
}

let standing = (eid: string) => sessionRow(db, eid)?.standing ?? null

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
