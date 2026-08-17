// The comms bus over the REAL db, not the fake graph. bus_test.ts proves the
// narrow queries answer what the corpus answers; this proves the queries run
// at all against SQLite — the exact thing fakeGraph cannot, since it parses the
// filter through query.ts but never reaches a column.
//
// This is the guard the deliver{to} migration wanted and did not have: when
// `to_eid` was dropped from knock/wake/mail but busRows still asked
// `.knock.to_eid=<mine>`, every verb run by a session HOLDING A CLAIM 400'd
// with `no such column: to_eid` — the reply door and task_claim both. A session
// with no claims skipped the arm and looked fine, which is why it hid. So the
// case here is precisely a claim-holder with an addressed knock: bus() must
// resolve and serve it, never throw. Revert busRows' `.deliver.to` back to
// `.knock.to_eid` and this test is what goes red.

import { assertEquals } from '@std/assert'
import { bus, inboxItem, inboxRows, query } from './client.ts'
import { slow } from './testing.ts'
import type { Change } from './types.ts'

// This case drives a REAL server over HTTP, so it is slow(): the fast run skips
// it — and must not boot the server or claim a socket a parallel worker would
// collide on. Boot only under the heavy tier: an ephemeral port, handed back
// before the server claims it (a fixed port collides on a shared box).
Deno.env.set('DB_PATH', ':memory:')
let U = ''
let alone = { sanitizeOps: false, sanitizeResources: false }
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
  Deno.env.set('TASKS_HOST', U)
}

let post = async (changes: Change[]) => {
  let res = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`apply ${res.status}: ${await res.text()}`)
}

let ent = (
  eid: string,
  num: number,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: { eid, num } },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

let uid = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
let P = uid(1) // the project the session stands in
let S = uid(2) // the session under test — HOLDS a claim
let B = uid(3) // the session that knocked
let T = uid(4) // the task S claims
let K = uid(5) // a knock aimed at S
let C = uid(6) // the words the knock carried, as a comment on T

slow(
  'bus: a claim-holder with an addressed knock resolves, never 400s',
  alone,
  async () => {
    await post([
      ...ent(P, 1, {
        doc: { title: 'Home', body: '' },
        project: {},
        repo: { path: '/w' },
      }),
      ...ent(S, 2, {
        doc: { title: 'Work session', body: '' },
        session: { id: 'sess-real', cwd: '/w', actor: P, operator: 1 },
      }),
      ...ent(B, 3, {
        doc: { title: 'Other session', body: '' },
        session: { id: 'sess-b', actor: P },
      }),
      // The claim is the trigger: the arm that read the dropped column only fired
      // for a session that held one, which is why the bug hid from claim-less
      // sends.
      ...ent(T, 4, {
        doc: { title: 'Claimed work', body: '' },
        task: { status: 'wip' },
        claim: { session: S },
        created: { at: '2026-01-01', by: P },
      }),
      // A knock aimed at S — WHO rides the shared deliver.to (D-14945), the very
      // facet that replaced knock.to_eid.
      ...ent(K, 5, {
        created: { at: '2026-01-03', by: P, via: B },
        knock: { target: T },
        deliver: { to: S },
        delivered: { at: '2026-01-03', via: 'cast' },
      }),
      ...ent(C, 6, {
        created: { at: '2026-01-03', by: P, via: B },
        doc: { title: '', body: 'look here' },
        comment: { target: T },
      }),
    ])

    // The whole point: this call went through busRows' `.deliver.to` query
    // against real SQLite and did not throw. Pre-fix it raised
    // `no such column: to_eid` here.
    let got = await bus('sess-real', '/w')
    // The knock and its words both reach the operator — two lines, matching
    // bus_test's `a knock, with the words riding as a comment on its target`.
    assertEquals(got.lines.length, 2)
  },
)

// A notice (D-13858) minted on a claimed task reaches its claimant on the bus
// AND in the inbox, but is never a comment — the thread query that feeds the
// conversation view never returns it, and fanout (rooted in the comment table,
// mail.ts) cannot see it. This is the whole point of a separate representation:
// delivered like speech, counted as an event. Reuses P/S/T from the first case
// (S is the operator that claims T).
let N = uid(21) // a notice on T, emitted by another session

slow(
  'bus: a notice on a claimed task delivers but is not a comment',
  alone,
  async () => {
    await post([
      ...ent(N, 21, {
        created: { at: '2026-01-05', by: P, via: B },
        doc: { title: '', body: 'lease lapsed on T-4' },
        notice: { target: T, event: 'lapse' },
      }),
    ])

    // The bus serves it as its own line — emitted, but delivered like speech.
    let got = await bus('sess-real', '/w')
    let line = got.lines.find((l) => l.includes('lease lapsed on T-4'))
    assertEquals(!!line, true)
    assertEquals(line!.includes('notice'), true) // UNTRUSTED notice … : …

    // The inbox carries it too — addressed like a comment on the claimed task.
    let box = await inboxRows('sess-real', '/w')
    let keep = inboxItem(box.who!)
    assertEquals(box.rows.filter(keep).some((r) => r.eid == N), true)

    // But the conversation thread (a `.comment.target` query, what Comments.tsx
    // reads) never returns it: a notice is not a comment.
    let thread = await query([`.comment.target=${T}`])
    assertEquals(thread.some((r) => r.eid == N), false)
    assertEquals(thread.some((r) => !!r.comps.notice), false)
  },
)

// A recall floater has NO recipient facet — it lands in the session's own log
// keyed only by entry.session (recall.ts). busRows must have its own arm for it
// or the bus goes quiet: pre-fix (T-17476) recall entries were written but
// never supplied to channelEvents, so 47 wrote and 0 injected. Drop the
// `.recalled.source!` arm from busRows and this test goes red.
let RS = uid(11) // a fresh session that owns a recall floater
let RM = uid(12) // the source message the floater rose from
let RF = uid(13) // the recall-floater entry itself

slow(
  'bus: a recall floater in a session own log reaches that session',
  alone,
  async () => {
    await post([
      ...ent(RS, 11, {
        doc: { title: 'Reader session', body: '' },
        session: { id: 'sess-recall', cwd: '/w', actor: P, operator: 1 },
      }),
      // The message the recall rose from — an ordinary entry, never itself a
      // floater (no `recalled`), so it is not delivered, only pointed at.
      ...ent(RM, 12, {
        entry: { session: RS, seq: 1 },
        content: { body: 'should I escalate this?' },
        message: {},
      }),
      // The floater: the memories that surfaced, in the session's OWN log.
      // created.via is null (the effect writes it unattributed), so it passes
      // notices()' own-write self-filter and reaches its own session. Born NOW,
      // because busRows bounds the recall arm to the recent window (T-17487) —
      // a floater is worthless once its beat has passed.
      ...ent(RF, 13, {
        entry: { session: RS, seq: 2 },
        content: { body: 'M-1 · escalation is a bug report, not a decision' },
        recalled: { source: RM },
        created: { at: new Date().toISOString(), by: null, via: null },
      }),
    ])

    let got = await bus('sess-recall', '/w')
    // Exactly the floater, rendered as a recall line — the injection that was
    // silently missing.
    assertEquals(got.lines.length, 1)
    assertEquals(got.lines[0].includes('recall'), true)
    assertEquals(got.lines[0].includes('escalation is a bug report'), true)
  },
)
