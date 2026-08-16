// channelEvents builds its per-eid indexes (docs, created, delivered/errored,
// recipients, sessions, bodies, metas, born) in ONE pass over the batch
// (indexBatch, T-18331). This drives a single rich broadcast through it and
// asserts every branch that reads one of those indexes still fires correctly —
// the behavior the eight former per-name scans produced.

import { assertEquals } from '@std/assert'
import { channelEvents, type Ctx } from './channel.ts'
import type { Change } from './types.ts'

let ids: Record<string, string> = {
  S: 'S-1',
  TASK: 'T-9',
  X: 'T-5',
  HOME: 'P-1',
  'U-1': 'U-1',
  'U-2': 'U-2',
}

let ctx: Ctx = {
  sessionEid: 'S',
  actorEid: 'A',
  homeEid: 'HOME',
  operator: true,
  claimedEids: new Set(['TASK']),
  idOf: (e) => ids[e] ?? null,
}

Deno.test('channelEvents: one-pass indexing feeds every branch', () => {
  let batch: Change[] = [
    // comment aimed at the served session — reads docs + created(byline)
    { eid: 'c1', name: 'comment', comp: { target: 'S' } },
    { eid: 'c1', name: 'doc', comp: { title: '', body: 'hello session' } },
    { eid: 'c1', name: 'created', comp: { by: 'U-1' } },
    // comment on a CLAIMED task — names the task via `on`
    { eid: 'c2', name: 'comment', comp: { target: 'TASK' } },
    { eid: 'c2', name: 'doc', comp: { title: '', body: 'on the task' } },
    { eid: 'c2', name: 'created', comp: { by: 'U-2' } },
    // a `meta`-tagged comment on the session — must be SKIPPED (metas index)
    { eid: 'c3', name: 'comment', comp: { target: 'S' } },
    { eid: 'c3', name: 'doc', comp: { title: '', body: 'a dream memo' } },
    { eid: 'c3', name: 'meta', comp: {} },
    // a live knock to the session — recipients index + its note comment on X
    { eid: 'k1', name: 'knock', comp: { target: 'X' } },
    { eid: 'k1', name: 'deliver', comp: { to: 'S' } },
    { eid: 'n1', name: 'comment', comp: { target: 'X' } },
    { eid: 'n1', name: 'doc', comp: { title: '', body: 'look here' } },
    // a SETTLED knock — delivered outcome makes it a receipt, skipped live
    { eid: 'k2', name: 'knock', comp: { target: 'Y' } },
    { eid: 'k2', name: 'deliver', comp: { to: 'S' } },
    { eid: 'k2', name: 'delivered', comp: { at: '2026-08-16T00:00:00Z' } },
    // a verified mail arrival for the operator's home board
    {
      eid: 'm1',
      name: 'mail',
      comp: {
        target: 'HOME',
        verified: 1,
        received_at: '2026-08-16T00:00:00Z',
        from: 'x@bot.test',
      },
    },
    { eid: 'm1', name: 'doc', comp: { title: 'hi', body: 'a letter' } },
    // a recall floater in the session's own log — sessions + bodies indexes
    { eid: 'r1', name: 'recalled', comp: {} },
    { eid: 'r1', name: 'entry', comp: { session: 'S' } },
    { eid: 'r1', name: 'content', comp: { body: 'M-1 · a memory' } },
    // apply()'s echoed session-less `entry` stamp for r1 (the {eid,seq} ingest
    // coordinate) lands AFTER the real one — it must NOT erase r1's partition,
    // or the recall below is dropped. The load-bearing sessionsIn invariant.
    { eid: 'r1', name: 'entry', comp: { seq: 7 } },
  ]

  let evs = channelEvents(batch, ctx)

  assertEquals(evs.map((e) => e.meta.kind), [
    'comment', // c1
    'comment', // c2
    'knock', // k1
    'mail', // m1
    'recall', // r1  (proves the trailing session-less entry did NOT erase it)
  ])
  // c3 (meta) and k2 (settled) are absent.

  // comment on the session: bare, no `on`, byline from created
  assertEquals(evs[0].content, 'hello session')
  assertEquals(evs[0].meta.from, 'U-1')
  assertEquals(evs[0].meta.on, undefined)
  // comment on the claimed task: names the task, byline from created
  assertEquals(evs[1].content, 'on the task')
  assertEquals(evs[1].meta.on, 'T-9')
  assertEquals(evs[1].meta.from, 'U-2')
  // knock: head from recipients+target, note from the target's comment (docs)
  assertEquals(evs[2].content, 'look at T-5 — look here')
  // mail: verified arrival rendered from its doc
  assertEquals(evs[3].content, 'a letter')
  assertEquals(evs[3].meta.auth, 'VERIFIED')
  // recall: content from the bodies index
  assertEquals(evs[4].content, 'M-1 · a memory')
})
