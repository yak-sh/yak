import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { reader } from './host_testing.ts'
import { trayLive, traySessions } from './sessions.ts'
import { applyLocal, cache, ent } from './live.ts'
import {
  allSessionsQuery,
  sessionCap,
  trayActiveQuery,
  trayProcessQuery,
  trayRecentQuery,
} from './tray_query.ts'

let session = (n: number, extra: Partial<Bundle> = {}): Bundle => ({
  entity: {
    eid: `eeee6386-0000-4000-8000-${String(n).padStart(12, '0')}`,
    num: n,
  },
  session: { id: `s-${n}`, operator: true, status: 'pending' },
  created: { at: new Date(Date.UTC(2026, 8, n)).toISOString() },
  doc: {
    title: `Session ${n}`,
    body: 'A long transcript must stay off the strip',
  },
  ...extra,
})

test('standing session queries exclude automation and bound every arm', () => {
  let human = Array.from({ length: 20 }, (_, i) => session(i + 1))
  let automatic = [
    session(21, { session: { id: 'unmarked' } }),
    session(22, {
      session: { id: 'agent', operator: false, status: 'pending' },
    }),
    session(23, { spawned: { parent: human[0].entity.eid } }),
    session(24, {
      session: { id: 'builder', operator: true, source: 'request' },
    }),
    session(25, { session: { id: 'spawned-root', operator: false } }),
  ].map((b) => ({ ...b, process: { pid: 123 } }))
  let read = reader([
    ...human.map((b) => ({ ...b, process: { pid: 123 } })),
    ...automatic,
  ], { computed: { 'session.status': (b) => (b.session as Comp)?.status } })
  for (let query of [trayActiveQuery, trayProcessQuery, trayRecentQuery]) {
    let rows = read(query)
    assertEquals(
      rows.map((b) => b.entity.eid),
      human.slice(-sessionCap).reverse().map((b) => b.entity.eid),
    )
  }
  assertEquals(reader([...human, ...automatic])(allSessionsQuery).length, 25)
})

test('session selection is capped after putting current runners ahead of newest history', () => {
  let prior = cache.peek()
  let rows = Array.from({ length: 20 }, (_, i) => session(i + 1))
  cache.value = {}
  applyLocal(
    rows.flatMap((b) =>
      Object.entries(b).map(([name, comp]) => ({
        eid: b.entity.eid,
        name,
        comp: comp as Comp,
      }))
    ),
  )
  let first = rows[0].entity.eid
  let now = Date.parse('2026-10-01T00:00:00Z')
  let leases = { [first]: { holder: 'worker', until: '2026-10-01T00:01:00Z' } }
  try {
    let selected = traySessions(
      rows.map((b) => [b.entity.eid, ent(b.entity.eid)]),
      leases,
      now,
    )
    assertEquals(selected.length, sessionCap)
    assertEquals(selected[0][0], first)
    assertEquals(trayLive(selected[0][1], leases[first], now + 60_000), false)
    assertEquals(
      selected.slice(1).map(([eid]) => eid),
      rows.slice(-7).reverse().map((b) => b.entity.eid),
    )
  } finally {
    cache.value = prior
  }
})
