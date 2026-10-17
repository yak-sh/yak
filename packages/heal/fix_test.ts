// Fixer lifetime decisions distinguish native transcript work from managed
// process startup and exit. Time is an input, so no process or clock is needed.

import { equal, test } from '@yaks/testing'
import { active, STARTING } from './fix.ts'

let now = Date.parse('2026-10-17T13:45:00Z')
let managed = {
  entity: { eid: 'managed' },
  created: { at: new Date(now - STARTING - 1).toISOString() },
}

test('managed fixers retain their bounded startup window and process lifetime', () => {
  equal(active(managed, now), false)
  equal(active(managed, now - 2), true)
  equal(active({ ...managed, process: { pid: 1 } }, now), true)
  equal(active({ ...managed, process: { pid: 1 }, exit: {} }, now), false)
})

test('native fixer slots follow transcript work rather than startup age or process', () => {
  for (let status of ['pending', 'running', 'queued']) {
    let native = { ...managed, native: {}, session: { status } }
    equal(active(native, now), true)
    equal(active({ ...native, stop: {} }, now), false)
    equal(active({ ...native, session: { status, ended: true } }, now), false)
  }
  for (let status of ['empty', 'settled', 'stopped', 'failed']) {
    equal(
      active({
        ...managed,
        native: {},
        session: { status },
        process: { pid: 1 },
      }, now),
      false,
    )
  }
})
