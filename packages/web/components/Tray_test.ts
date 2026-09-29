// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { cache, ent, mode } from '../live.ts'
import { type Ent, type Session } from '../types.ts'
import { mount } from './mount.ts'
import {
  SessionRows,
  trayKey,
  trayLive,
  trayOpen,
  trayRecent,
  traySessions,
  trayShown,
} from './Tray.tsx'
import { graphStanding } from './session_status.tsx'

test('t opens and closes the tray only from normal mode', () => {
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

test('the tray keeps a newly started session visible', () => {
  let now = Date.parse('2026-08-12T00:30:00-04:00')
  assertEquals(trayRecent(run({}, '2026-08-12T00:20:00-04:00'), now), true)
  assertEquals(trayRecent(run({}, '2026-08-11T12:00:00-04:00'), now), false)
  assertEquals(trayRecent(run(), now), false)
})

test('old pending work is hidden without a runner; recent idle work remains visible', () => {
  let now = Date.parse('2026-09-27T12:00:00Z')
  let old = run(
    { session: { eid: 'session', id: 'run', status: 'pending' } },
    '2026-08-16T12:00:00Z',
  )
  let recent = run({
    session: { eid: 'session', id: 'run', status: 'pending' },
  }, '2026-09-27T11:00:00Z')
  let current = { holder: 'runner', until: '2026-09-27T12:01:00Z' }
  let expired = { holder: 'runner', until: '2026-09-27T11:59:00Z' }
  assertEquals(trayShown('old', old, undefined, now), false)
  assertEquals(trayShown('recent', recent, undefined, now), true)
  assertEquals(trayShown('old', old, current, now), true)
  assertEquals(trayShown('old', old, expired, now), false)
})

test('tray sessions put live work first, then recent work', () => {
  assertEquals(
    traySessions([
      ['unstarted', run()],
      ['older', run({}, '2026-08-12T10:00:00Z')],
      ['newer', run({}, '2026-08-12T11:00:00Z')],
      [
        'live',
        run(
          {
            session: { eid: 'live', id: 'live', status: 'settled' },
            process: { eid: 'live', pid: 123 },
          },
          '2026-08-12T09:00:00Z',
        ),
      ],
    ]).map(([eid]) => eid),
    ['live', 'newer', 'older', 'unstarted'],
  )
})

test('tray live classification uses a current lease or unexited process, never status', () => {
  let now = Date.parse('2026-08-12T12:00:00Z')
  let running = run({
    session: { eid: 'session', id: 'run', status: 'running' },
  })
  let settled = run({
    session: { eid: 'session', id: 'run', status: 'settled' },
  })
  assertEquals(trayLive(running, undefined, now), false)
  assertEquals(
    trayLive(settled, { holder: 'runner', until: '2026-08-12T12:01:00Z' }, now),
    true,
  )
  assertEquals(
    trayLive(running, { holder: 'runner', until: '2026-08-12T11:59:00Z' }, now),
    false,
  )
  assertEquals(
    trayLive(running, { until: '2026-08-12T12:01:00Z' }, now),
    false,
  )
  assertEquals(
    trayLive(run({ process: { eid: 'session', pid: 123 } }), undefined, now),
    true,
  )
  assertEquals(
    trayLive(
      run({
        process: { eid: 'session', pid: 123 },
        exit: { eid: 'session', code: 0 },
      }),
      undefined,
      now,
    ),
    false,
  )
})

test('the tray shows live and recent sessions in separate sections', () => {
  cache.value = {
    live: {
      entity: { eid: 'live', num: 1 },
      session: { eid: 'live', id: 'live', status: 'settled' },
      process: { eid: 'live', pid: 123 },
      brief: { eid: 'live', text: 'Active work' },
    },
    done: {
      entity: { eid: 'done', num: 2 },
      session: { eid: 'done', id: 'done', status: 'settled' },
      brief: { eid: 'done', text: 'Completed work' },
    },
  }
  let mounted = mount(h(SessionRows, {
    ls: [['done', ent('done')], ['live', ent('live')]],
  }))
  try {
    let groups = [...mounted.root.querySelectorAll('.Tray_Group')]
    assertEquals(
      groups.map((g) => g.querySelector('.Tray_Label')?.textContent),
      ['live', 'recent'],
    )
    assertEquals(
      groups.map((g) => g.querySelector('.SessionRow_Title')?.textContent),
      ['Active work', 'Completed work'],
    )
    assertEquals(groups.map((g) => g.querySelectorAll('.Tray_X').length), [
      0,
      1,
    ])
  } finally {
    mounted.free()
    cache.value = {}
  }
})

let status = (s: Session['status'], standing?: string) =>
  run({ session: { eid: 'session', id: 'run', status: s, standing } })

// The dot's word is the status the host derived, idle between turns.
test('graph-native status follows the host', () => {
  assertEquals(graphStanding(status('pending')), 'pending')
  assertEquals(graphStanding(status('running')), 'running')
  assertEquals(graphStanding(status('running', 'idle')), 'idle')
  assertEquals(graphStanding(status('settled')), 'settled')
  assertEquals(graphStanding(status('stopped')), 'stopped')
  assertEquals(graphStanding(status('failed')), 'failed')
})

// A failure recorded on the session outranks whatever the transcript says.
test('a session exception reads failed while the session rests', () => {
  let e = status('running', 'idle')
  e.exception = {
    eid: e.eid,
    at: '2026-07-01T00:00:00Z',
    message: 'responses: failed',
  }
  assertEquals(graphStanding(e), 'failed')
})
