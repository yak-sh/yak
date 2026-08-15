// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { cache, ent, mode } from '../live.ts'
import { type Ent } from '../types.ts'
import { LiveSession, trayKey, trayOpen, trayRecent } from './Tray.tsx'
import { mount } from './mount.ts'
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

Deno.test('a live session leads with model info then lists every claim', () => {
  let run = '11111111-1111-4111-8111-111111111111'
  let persona = '22222222-2222-4222-8222-222222222222'
  let one = '33333333-3333-4333-8333-333333333333'
  let two = '44444444-4444-4444-8444-444444444444'
  cache.value = {
    [run]: {
      entity: { eid: run, num: 2 },
      session: { eid: run, id: 'provider-run', status: 'running' },
      spawn: {
        eid: run,
        persona,
        model: 'gpt-5.6-sol',
        effort: 'high',
      },
      created: { eid: run, at: '2026-08-15T09:00:00-04:00' },
    },
    [persona]: {
      entity: { eid: persona, num: 3 },
      doc: { eid: persona, title: 'Ada', body: '' },
      persona: { eid: persona },
    },
    [one]: {
      entity: { eid: one, num: 4 },
      doc: { eid: one, title: 'First claim', body: '' },
      task: { eid: one, status: 'wip', priority: 0 },
      claim: { eid: one, session: run },
    },
    [two]: {
      entity: { eid: two, num: 5 },
      doc: { eid: two, title: 'Second claim', body: '' },
      task: { eid: two, status: 'open', priority: 1 },
      claim: { eid: two, session: run },
    },
  }

  let { root, free } = mount(h(LiveSession, { e: ent(run) }))
  let head = root.querySelector('.TrayLive_Head')!
  assertEquals(
    [...head.children].map((x) => x.className.split(' ')[0]),
    [
      'Dot',
      'TrayLive_Persona',
      'TrayLive_Model',
      'TrayLive_Effort',
      'Id',
      'Stamp',
    ],
  )
  assertEquals(head.querySelector('.TrayLive_Persona')?.textContent, 'Ada')
  assertEquals(
    head.querySelector('.TrayLive_Model')?.textContent,
    'GPT 5.6 Sol',
  )
  assertEquals(head.querySelector('.TrayLive_Effort')?.textContent, 'high')
  assertEquals(head.querySelector('.Id')?.textContent, 'S-2')
  assertEquals(
    [...root.querySelectorAll('.TrayLive_Task')]
      .map((x) => x.textContent.replace(/\s+/g, ' ').trim()).toSorted(),
    ['T-4 First claim', 'T-5 Second claim'],
  )
  free()
  cache.value = {}
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
