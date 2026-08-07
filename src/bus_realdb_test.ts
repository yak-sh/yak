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
import { bus } from './client.ts'
import type { Change } from './types.ts'

// An ephemeral port, handed back before the server claims it — a fixed port
// collides on a shared box (the same dance precondition_test does).
let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
let port = (seat.addr as Deno.NetAddr).port
seat.close()
Deno.env.set('PORT', String(port))
Deno.env.set('DB_PATH', ':memory:')
await import('./server.ts')
let U = `127.0.0.1:${port}`
Deno.env.set('TASKS_HOST', U)
// The server is a module-level singleton outliving the case; it never idles.
let alone = { sanitizeOps: false, sanitizeResources: false }

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

Deno.test(
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
        session: { id: 'sess-real', cwd: '/w', actor_eid: P, operator: 1 },
      }),
      ...ent(B, 3, {
        doc: { title: 'Other session', body: '' },
        session: { id: 'sess-b', actor_eid: P },
      }),
      // The claim is the trigger: the arm that read the dropped column only fired
      // for a session that held one, which is why the bug hid from claim-less
      // sends.
      ...ent(T, 4, {
        doc: { title: 'Claimed work', body: '' },
        task: { status: 'wip' },
        claim: { session_eid: S },
        created: { at: '2026-01-01', by: P },
      }),
      // A knock aimed at S — WHO rides the shared deliver.to (D-14945), the very
      // facet that replaced knock.to_eid.
      ...ent(K, 5, {
        created: { at: '2026-01-03', by: P, via: B },
        knock: { target_eid: T },
        deliver: { to: S },
        delivered: { at: '2026-01-03', via: 'cast' },
      }),
      ...ent(C, 6, {
        created: { at: '2026-01-03', by: P, via: B },
        doc: { title: '', body: 'look here' },
        comment: { target_eid: T },
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
