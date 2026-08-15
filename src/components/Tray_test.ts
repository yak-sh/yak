// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import { type Ent } from '../types.ts'
import { trayKey, trayOpen, trayRecent, traySessions } from './Tray.tsx'
import { graphStanding } from './session_status.tsx'

Deno.test('t opens and closes the tray only from normal mode', () => {
  trayOpen.value = false
  mode.value = 'insert'
  assertEquals(trayKey('t'), false)
  mode.value = 'normal'
  assertEquals(trayKey('t', false, true), false)
  assertEquals(trayKey('t', true), false)
  assertEquals(trayKey('t', false, false, true), false)
  assertEquals(trayKey('x'), false)
  assertEquals(trayKey('t'), true)
  assertEquals(trayOpen.value, true)
  assertEquals(trayKey('t'), true)
  assertEquals(trayOpen.value, false)
})

Deno.test('the tray keeps a newly started session visible', () => {
  let now = Date.parse('2026-08-12T00:30:00-04:00')
  assertEquals(
    trayRecent({
      eid: 'session',
      id: 'run',
      started_at: '2026-08-12T00:20:00-04:00',
    }, now),
    true,
  )
  assertEquals(
    trayRecent({
      eid: 'session',
      id: 'run',
      started_at: '2026-08-11T12:00:00-04:00',
    }, now),
    false,
  )
})

Deno.test('tray sessions put the newest start at the top', () => {
  let older = {
    eid: 'older',
    id: 'older',
    started_at: '2026-08-12T10:00:00Z',
    finished_at: '2026-08-12T12:00:00Z',
  }
  let newer = {
    eid: 'newer',
    id: 'newer',
    started_at: '2026-08-12T11:00:00Z',
  }
  assertEquals(
    traySessions([
      ['unstarted', { eid: 'unstarted', id: 'unstarted' }],
      ['older', older],
      ['newer', newer],
    ]).map(([eid]) => eid),
    ['newer', 'older', 'unstarted'],
  )
})

let session = (standing?: string): Ent => ({
  eid: 'session',
  num: 1,
  kind: 'session',
  session: {
    eid: 'session',
    id: 'run',
    origin: 'managed',
    standing,
  },
  spawn: { eid: 'session', provider: 'codex' },
  refs: [],
  kids: [],
})

// graphStanding reads the server-maintained `standing` facet O(1) now (T-17855),
// not a scanned log: busy → running, terminal → completed unless a wake is
// pending, everything else idle.
Deno.test('graph-native status follows work, final answers, and wakes', () => {
  assertEquals(graphStanding(session('busy')), 'running')
  assertEquals(graphStanding(session(undefined)), 'idle')
  assertEquals(graphStanding(session('idle')), 'idle')
  assertEquals(graphStanding(session('terminal')), 'completed')
  // A pending wake overrides a terminal facet — a woken session reads idle.
  assertEquals(graphStanding(session('terminal'), true), 'idle')
})

// finished_at is authoritative — an ENDED native session reads completed (or
// failed on error), NEVER idle, whatever the log-derived facet says. Guards the
// regression the O(1) facet introduced: a finished session with a null/idle
// `standing` (killed, log had no clean final answer, or the boot backfill hasn't
// reached it) was misdisplaying as idle instead of completed, fleet-wide.
let finished = (standing?: string, error = false): Ent => ({
  eid: 'session',
  num: 1,
  kind: 'session',
  session: {
    eid: 'session',
    id: 'run',
    origin: 'managed',
    standing,
    finished_at: '2026-07-01T00:00:00Z',
  },
  ...(error
    ? { error: { eid: 'session', at: '2026-07-01T00:00:00Z', message: 'x' } }
    : {}),
  spawn: { eid: 'session', provider: 'codex' },
  refs: [],
  kids: [],
})

Deno.test('a finished native session reads completed, never idle', () => {
  assertEquals(graphStanding(finished(undefined)), 'completed') // null facet, still done
  assertEquals(graphStanding(finished('idle')), 'completed') // killed / no final answer
  assertEquals(graphStanding(finished('terminal')), 'completed')
  assertEquals(graphStanding(finished('busy')), 'completed') // a stale busy facet on an ended session
  assertEquals(graphStanding(finished(undefined, true)), 'failed') // error wins over finished
  // a pending wake cannot revive a finished session
  assertEquals(graphStanding(finished(undefined), true), 'completed')
})
