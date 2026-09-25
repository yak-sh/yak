// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import { type Ent, type Session } from '../types.ts'
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

// A session as ent() reads it: the row, when it was made, and what the host
// derived about it.
let run = (x: Partial<Ent> = {}, at?: string): Ent => ({
  eid: 'session',
  num: 1,
  kind: 'session',
  session: { eid: 'session', id: 'run' },
  ...(at ? { created: { eid: 'session', at } } : {}),
  refs: [],
  kids: [],
  ...x,
})

Deno.test('the tray keeps a newly started session visible', () => {
  let now = Date.parse('2026-08-12T00:30:00-04:00')
  assertEquals(trayRecent(run({}, '2026-08-12T00:20:00-04:00'), now), true)
  assertEquals(trayRecent(run({}, '2026-08-11T12:00:00-04:00'), now), false)
  assertEquals(trayRecent(run(), now), false)
})

Deno.test('tray sessions put the newest start at the top', () => {
  assertEquals(
    traySessions([
      ['unstarted', run()],
      ['older', run({}, '2026-08-12T10:00:00Z')],
      ['newer', run({}, '2026-08-12T11:00:00Z')],
    ]).map(([eid]) => eid),
    ['newer', 'older', 'unstarted'],
  )
})

let status = (s: Session['status'], standing?: string) =>
  run({ session: { eid: 'session', id: 'run', status: s, standing } })

// The dot's word is the status the host derived, idle between turns.
Deno.test('graph-native status follows the host', () => {
  assertEquals(graphStanding(status('pending')), 'pending')
  assertEquals(graphStanding(status('running')), 'running')
  assertEquals(graphStanding(status('running', 'idle')), 'idle')
  assertEquals(graphStanding(status('settled')), 'settled')
  assertEquals(graphStanding(status('stopped')), 'stopped')
  assertEquals(graphStanding(status('failed')), 'failed')
})

// A failure recorded on the session outranks whatever the transcript says.
Deno.test('a session exception reads failed while the session rests', () => {
  let e = status('running', 'idle')
  e.exception = {
    eid: e.eid,
    at: '2026-07-01T00:00:00Z',
    message: 'responses: failed',
  }
  assertEquals(graphStanding(e), 'failed')
})
