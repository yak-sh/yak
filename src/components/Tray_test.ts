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

let session = (): Ent => ({
  eid: 'session',
  num: 1,
  kind: 'session',
  session: {
    eid: 'session',
    id: 'run',
    origin: 'managed',
  },
  spawn: { eid: 'session', provider: 'codex' },
  refs: [],
  kids: [],
})

Deno.test('graph-native status follows work, final answers, and wakes', () => {
  let e = session()
  let log = { entries: [], busy: true, terminal: false, latest: 1 }
  assertEquals(graphStanding(e, undefined, false), 'running')
  assertEquals(graphStanding(e, log, false), 'running')
  assertEquals(graphStanding(e, { ...log, busy: false }, false), 'idle')
  assertEquals(
    graphStanding(e, { ...log, busy: false, terminal: true }, false),
    'completed',
  )
  assertEquals(
    graphStanding(e, { ...log, busy: false, terminal: true }, true),
    'idle',
  )
})
