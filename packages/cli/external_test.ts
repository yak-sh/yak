// Fallback decisions and readiness failures without touching the owner's
// graph, service manager or launching background workers.

import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { PROCESS, type Store } from '@yaks/process'
import { fallback, missing, ready } from './external.ts'

let processes = (rows: Bundle[]): Store => ({
  apply: (rows) => rows,
  get: (eids) => rows.filter((row) => eids.includes(row.entity.eid)),
  running: () => rows.filter((row) => !row.exit),
  services: () => [],
})

let row = (eid: string, roles: string[], exit = false): Bundle => ({
  entity: { eid },
  [PROCESS]: { pid: 123, roles },
  ...exit ? { exit: { code: 0 } } : {},
})

test('only live unexited duty roles cover the fallback', async () => {
  let store = processes([
    row('web', ['graph', 'web']),
    row('pool', ['graph', 'effects']),
    row('dead', ['wake']),
    row('ended', ['process'], true),
  ])
  assertEquals(
    await missing(
      store,
      ['effects', 'wake', 'process'],
      (eid) => Promise.resolve(eid == 'dead'),
    ),
    ['wake', 'process'],
  )
})

test('empty or covered duties start no worker; partial coverage starts only missing', async () => {
  let starts: string[][] = []
  let inspected = 0
  let uncovered = () => {
    inspected++
    return Promise.resolve([])
  }
  let start = (roles: string[]) => {
    starts.push(roles)
    return Promise.resolve()
  }
  await fallback([], uncovered, start)
  assertEquals(inspected, 0)
  await fallback(['effects'], uncovered, start)
  assertEquals(starts, [])
  await fallback(['effects', 'wake'], () => Promise.resolve(['wake']), start)
  assertEquals(starts, [['wake']])
})

let child = (status = new Promise<{ code: number }>(() => {})) => {
  let unrefs = 0
  let kills = 0
  return {
    process: {
      pid: 123,
      status,
      unref: () => unrefs++,
      kill: (_signal: 'SIGTERM') => kills++,
    },
    counts: () => ({ unrefs, kills }),
  }
}

test('ready worker is detached and never stopped', async () => {
  let run = child()
  let reads = 0
  await ready(
    run.process,
    () => Promise.resolve(++reads == 1 ? '999\n' : '123\n'),
    100,
    () => Promise.resolve(),
    () => 0,
  )
  assertEquals(reads, 2)
  assertEquals(run.counts(), { unrefs: 1, kills: 0 })
})

test('worker exit is an explicit readiness error, not a successful launch', async () => {
  let run = child(Promise.resolve({ code: 7 }))
  await assertRejects(
    () => ready(run.process, () => Promise.resolve('123\n')),
    Error,
    'exited before readiness (code 7)',
  )
  assertEquals(run.counts(), { unrefs: 1, kills: 0 })
})

test('bounded readiness timeout stops only this failed launch', async () => {
  let run = child()
  let time = 0
  await assertRejects(
    () =>
      ready(
        run.process,
        () => Promise.resolve(undefined),
        100,
        () => {
          time += 50
          return Promise.resolve()
        },
        () => time,
      ),
    Error,
    'did not become ready within 100ms',
  )
  assertEquals(run.counts(), { unrefs: 1, kills: 1 })
})

test('launch failure propagates instead of hiding missing duties', async () => {
  await assertRejects(
    () =>
      fallback(
        ['wake'],
        () => Promise.resolve(['wake']),
        () => Promise.reject(new Error('setsid unavailable')),
      ),
    Error,
    'setsid unavailable',
  )
})
