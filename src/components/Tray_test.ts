// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import { type Ent } from '../types.ts'
import { trayKey, trayOpen, trayRecent } from './Tray.tsx'
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
