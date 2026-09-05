// channelEvents builds its per-eid indexes (docs, created, delivered/errored,
// recipients, sessions, bodies, metas, born) in ONE pass over the batch
// (indexBatch, T-18331). This drives a single rich broadcast through it and
// asserts every branch that reads one of those indexes still fires correctly —
// the behavior the eight former per-name scans produced.

import { assertEquals } from '@std/assert'
import { link } from './edge.ts'
import { attentionOf, channelEvents, type Ctx } from './channel.ts'
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

Deno.test('attentionOf derives model receipt from transcript references', () => {
  let changes: Change[] = [
    { eid: 'E1', name: 'entry', comp: { session: 'S' } },
    ...link('E1', 'referenced', 'C1'),
    { eid: 'E2', name: 'entry', comp: { session: 'OTHER' } },
    ...link('E2', 'referenced', 'C2'),
  ]
  assertEquals([...attentionOf(changes, 'S')].sort(), ['C1', 'E1'])
})

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

  // deprecated direct-session compatibility: bare, no `on`
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

// A notice (D-13858) is served beside comments, keyed the same way — about
// the session or a claimed task — but as its own `notice` kind, with the
// emitter's byline. A notice about an unrelated entity reaches nobody here.
Deno.test('channelEvents: notices serve beside comments', () => {
  let batch: Change[] = [
    { eid: 'nz', name: 'notice', comp: { target: 'S', event: 'lapse' } },
    { eid: 'nz', name: 'doc', comp: { title: '', body: 'lease lapsed' } },
    { eid: 'nz', name: 'created', comp: { by: 'U-1' } },
    { eid: 'nt', name: 'notice', comp: { target: 'TASK', event: 'sweep' } },
    { eid: 'nt', name: 'doc', comp: { title: '', body: 'sweep found it' } },
    { eid: 'nt', name: 'created', comp: { by: 'U-2' } },
    // about an entity that is neither the session nor a claimed task — dropped
    { eid: 'nx', name: 'notice', comp: { target: 'OTHER', event: 'scene' } },
    { eid: 'nx', name: 'doc', comp: { title: '', body: 'not for me' } },
  ]
  let evs = channelEvents(batch, ctx)
  assertEquals(evs.map((e) => e.meta.kind), ['notice', 'notice'])
  // on the session: bare, byline from created
  assertEquals(evs[0].content, 'lease lapsed')
  assertEquals(evs[0].meta.on, undefined)
  assertEquals(evs[0].meta.from, 'U-1')
  // on the claimed task: names the task
  assertEquals(evs[1].content, 'sweep found it')
  assertEquals(evs[1].meta.on, 'T-9')
})

// A session's OWN write is never a message back to itself (T-20163). The skip
// lived only in notices() (client.ts), so the live channel push path echoed a
// session its own comments. It now lives in the shared selector, so BOTH
// consumers filter identically. The edge case the blanket guard must NOT harm:
// a self-directed cadence knock ("your pass resumes"), which a wake mints on
// the actor's behalf with created.via == null — never the reading session.
Deno.test('channelEvents: own writes skipped, cadence self-knock kept', () => {
  // The unified operator: its actor IS its home project (D-19459), so a knock
  // delivered to the home board passes the recipient gate as the actor knock.
  let opIds: Record<string, string> = { S: 'S-31', T: 'T-9', P: 'P-19' }
  let op: Ctx = {
    sessionEid: 'S',
    actorEid: 'P',
    homeEid: 'P',
    operator: true,
    claimedEids: new Set(['T']),
    idOf: (e) => opIds[e] ?? null,
  }
  let batch: Change[] = [
    // the session's OWN comment on its claimed task — created.via == S, so
    // this is the write it just made; it must NOT be served back to itself.
    { eid: 'mine', name: 'comment', comp: { target: 'T' } },
    { eid: 'mine', name: 'doc', comp: { title: '', body: 'my own note' } },
    { eid: 'mine', name: 'created', comp: { by: 'P', via: 'S' } },
    // a DIFFERENT session's comment on the same claimed task — a message to the
    // claimant; via is that other session, so it IS served.
    { eid: 'them', name: 'comment', comp: { target: 'T' } },
    { eid: 'them', name: 'doc', comp: { title: '', body: 'someone else' } },
    { eid: 'them', name: 'created', comp: { by: 'P', via: 'S2' } },
    // a cadence self-resume knock: wake-minted for the actor (via == null),
    // aimed at the home board and delivered there — the pass resuming. The
    // blanket own-write guard must leave it untouched.
    { eid: 'wake', name: 'knock', comp: { target: 'P' } },
    { eid: 'wake', name: 'deliver', comp: { to: 'P' } },
    { eid: 'wake', name: 'created', comp: { by: 'P', via: null } },
  ]

  let evs = channelEvents(batch, op)

  // own comment ('mine') is gone; the other session's comment and the
  // self-knock both survive.
  assertEquals(evs.map((e) => e.meta.kind), ['comment', 'knock'])
  assertEquals(evs[0].content, 'someone else')
  assertEquals(evs[0].meta.on, 'T-9')
  assertEquals(evs[1].content, 'your pass resumes on P-19')
})
