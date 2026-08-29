// The server's inbox enumeration reads the SAME set the client predicate does.
// T-18105 moves inbox listing/counting off a whole-cache scan (live.ts
// unreadFor, Inbox.tsx) and onto a server query, so the enumeration MUST agree
// with today's predicate byte for byte or the badge and the list quietly
// diverge under a partial cache. The oracle here is the current predicate over
// the WHOLE graph — `all.filter(inboxItem(readerAt|readerFor(all, …)))` — and
// the challenger is the server path: a reader assembled from bounded queries
// (actorRows/readerRows over localQuery), its inbox enumerated by inboxFor over
// the same localQuery, screened by the same inboxItem/addressed. Equal sets, or
// the door forked the attention policy.
//
// localQuery is graph_query.ts's in-process /query answerer — the seam that
// lets the client.ts enumeration run against the live db with no round-trip.
// The fast tier proves the composition; the slow tier proves the retired HTTP
// door stays closed while the same rows remain available through /query.
import { assertEquals } from '@std/assert'
import {
  actorRows,
  addressed,
  inboxFor,
  inboxItem,
  readerAt,
  readerFor,
  readerRows,
  type Row,
  rows,
} from './client.ts'
import { slow } from './testing.ts'
import type { Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let { localQuery } = await import('./graph_query.ts')

let uid = (n: number) =>
  `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`
let ent = (
  eid: string,
  num: number,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: { eid, num } },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

let V = uid(1) // the venture — a project; the browsing actor AND the session's actor
let S1 = uid(2) // a session standing in /w, acting for V (an operator loop)
let T1 = uid(3) // a task S1 claims
let T2 = uid(4) // a task S1 claims but V has MUTED
let W = uid(5) // a task V WATCHES (nothing else addresses it)
let Cv = uid(10) // a comment on the venture — direct address to the operator loop
let Ct1 = uid(11) // a comment on a claimed task
let Ct2 = uid(12) // a comment on the muted claimed task — mute wins
let Cw = uid(13) // a comment on the watched task — watch pulls it in
let Ca = uid(14) // an archived comment on the venture — never in the inbox
let Nv = uid(20) // a notice about the venture — addressed like a comment
let Ks = uid(21) // a knock aimed at the session
let Min = uid(30) // an arrived letter to the venture (scope + to_addr arms)
let Mout = uid(31) // an outbound letter (no message_id) — born read, never inbox
let Sw = uid(40) // the watch subscription
let Sm = uid(41) // the mute subscription

// One graph exercising every arm of the union AND every override: direct
// venture/claim/session address, watch (include though unaddressed), mute (drop
// though addressed), an archived screen, a notice, a knock, arrived vs outbound
// mail. Both readers (browsing actor V, working session S1) read off it.
let world = () => {
  let db = bareDb()
  apply(db, [
    ...ent(V, 1, {
      doc: { title: 'Venture', body: '' },
      project: {},
      repo: { path: '/w' },
      email: { address: 'v@fleet' },
    }),
    ...ent(S1, 2, {
      doc: { title: 'Work session', body: '' },
      session: { id: 'sess-1', cwd: '/w', actor: V, operator: 1 },
    }),
    ...ent(T1, 3, {
      doc: { title: 'Claimed A', body: '' },
      task: {},
      claim: { session: S1 },
      created: { at: '2026-01-01', by: V },
    }),
    ...ent(T2, 4, {
      doc: { title: 'Claimed B (muted)', body: '' },
      task: {},
      claim: { session: S1 },
      created: { at: '2026-01-01', by: V },
    }),
    ...ent(W, 5, {
      doc: { title: 'Watched', body: '' },
      task: {},
      created: { at: '2026-01-01', by: V },
    }),
    ...ent(Cv, 10, {
      doc: { title: '', body: 'venture, look here' },
      comment: { target: V },
      created: { at: '2026-01-02', by: V },
    }),
    ...ent(Ct1, 11, {
      doc: { title: '', body: 'on claimed A' },
      comment: { target: T1 },
      created: { at: '2026-01-02', by: V },
    }),
    ...ent(Ct2, 12, {
      doc: { title: '', body: 'on muted B' },
      comment: { target: T2 },
      created: { at: '2026-01-02', by: V },
    }),
    ...ent(Cw, 13, {
      doc: { title: '', body: 'on watched' },
      comment: { target: W },
      created: { at: '2026-01-02', by: V },
    }),
    ...ent(Ca, 14, {
      doc: { title: '', body: 'old venture note' },
      comment: { target: V },
      archived: {},
      created: { at: '2026-01-02', by: V },
    }),
    ...ent(Nv, 20, {
      doc: { title: '', body: 'lease lapsed' },
      notice: { target: V, event: 'lapse' },
      created: { at: '2026-01-03', by: V },
    }),
    ...ent(Ks, 21, {
      knock: { target: T1 },
      deliver: { to: S1 },
      created: { at: '2026-01-03', by: V },
    }),
    ...ent(Min, 30, {
      doc: { title: 'hello venture', body: 'a letter' },
      mail: { target: V },
      created: { at: '2026-01-04', by: V },
    }),
    ...ent(Mout, 31, {
      doc: { title: 'outbound', body: 'going out' },
      mail: { target: V },
      created: { at: '2026-01-04', by: V },
    }),
    ...ent(Sw, 40, { subscription: { actor: V, target: W, mode: 'watch' } }),
    ...ent(Sm, 41, { subscription: { actor: V, target: T2, mode: 'mute' } }),
  ])
  // message_id/to_addr/received_at are server-stamped (types.ts), so apply()
  // will not take them off the wire — an arrived letter is minted by the edge.
  // Land the inbound mark straight on the row, the way inbound.ts does.
  db.prepare(
    `update mail set message_id = ?, to_addr = ?, received_at = ?
     where entity = (select id from entity where eid = ?)`,
  ).run('mid-1', 'v@fleet', '2026-01-04T00:00:00Z', Min)
  return db
}

let ids = (rs: Row[]) => [...new Set(rs.map((r) => r.eid))].sort()

// The server path, minus HTTP: build the reader from bounded queries and
// enumerate its inbox, both over the same in-process answerer.
let served = async (
  db: ReturnType<typeof bareDb>,
  who: Parameters<typeof inboxFor>[0],
  mode: 'inbox' | 'all' = 'inbox',
) => {
  let local = localQuery(db)
  let union = await inboxFor(who, [], mode, local)
  return union.filter(mode == 'all' ? addressed(who) : inboxItem(who))
}

Deno.test('server inbox == client predicate for a browsing actor', async () => {
  let db = world()
  let all = rows(snapshot(db))
  let want = all.filter(inboxItem(readerAt(all, V)))
  let who = readerAt(await actorRows(V, localQuery(db)), V)
  let got = await served(db, who)
  assertEquals(ids(got), ids(want))
  // Not vacuous, and the overrides bite: venture comment/notice, arrived mail,
  // and the watched-task comment are IN; the muted, archived, and outbound rows
  // are OUT.
  assertEquals(ids(got).includes(Cv), true)
  assertEquals(ids(got).includes(Nv), true)
  assertEquals(ids(got).includes(Min), true)
  assertEquals(ids(got).includes(Cw), true)
  assertEquals(ids(got).includes(Ct2), false)
  assertEquals(ids(got).includes(Ca), false)
  assertEquals(ids(got).includes(Mout), false)
})

Deno.test('server inbox == client predicate for a working session', async () => {
  let db = world()
  let all = rows(snapshot(db))
  let want = all.filter(inboxItem(readerFor(all, 'sess-1', '/w')))
  let who = readerFor(
    await readerRows('sess-1', localQuery(db)),
    'sess-1',
    '/w',
  )
  let got = await served(db, who)
  assertEquals(ids(got), ids(want))
  // The session hears its knock and its claimed-task comment; still muted on T2.
  assertEquals(ids(got).includes(Ks), true)
  assertEquals(ids(got).includes(Ct1), true)
  assertEquals(ids(got).includes(Ct2), false)
})

Deno.test('--all ignores watch/mute and keeps archived', async () => {
  let db = world()
  let all = rows(snapshot(db))
  let want = all.filter(addressed(readerFor(all, 'sess-1', '/w')))
  let who = readerFor(
    await readerRows('sess-1', localQuery(db)),
    'sess-1',
    '/w',
  )
  let got = await served(db, who, 'all')
  assertEquals(ids(got), ids(want))
  // Archived direct address returns, and the mute no longer drops T2's comment.
  assertEquals(ids(got).includes(Ca), true)
  assertEquals(ids(got).includes(Ct2), true)
})

// The HTTP boundary proves the wiring over SQLite: /inbox is retired and its
// ordinary query arm remains available. slow() boots one ephemeral server only
// under the heavy tier, the same discipline the other server tests keep.
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

slow(
  'the retired /inbox route yields to ordinary /query reads',
  alone,
  async () => {
    let post = async (changes: Change[]) => {
      let res = await fetch(`http://${U}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
      if (!res.ok) throw new Error(`apply ${res.status}: ${await res.text()}`)
    }
    // A distinct id space from the fast tier's rows (the live :memory: server
    // carries the demo seed too, so use the venture we mint here as the actor).
    let RV = uid(100),
      RS = uid(101),
      RT = uid(102),
      RC = uid(103),
      RN = uid(104)
    await post([
      ...ent(RV, 100, {
        doc: { title: 'Route venture', body: '' },
        project: {},
        repo: { path: '/route' },
      }),
      ...ent(RS, 101, {
        doc: { title: 'Route session', body: '' },
        session: { id: 'sess-route', cwd: '/route', actor: RV, operator: 1 },
      }),
      ...ent(RT, 102, {
        doc: { title: 'Route task', body: '' },
        task: {},
        claim: { session: RS },
        created: { at: '2026-02-01', by: RV },
      }),
      ...ent(RC, 103, {
        doc: { title: '', body: 'on route task' },
        comment: { target: RT },
        created: { at: '2026-02-02', by: RV },
      }),
      ...ent(RN, 104, {
        doc: { title: '', body: 'about the venture' },
        notice: { target: RV, event: 'lapse' },
        created: { at: '2026-02-02', by: RV },
      }),
    ])

    let retired = await fetch(`http://${U}/inbox?actor=${RV}`)
    assertEquals(retired.status, 404)

    // The browser's corresponding subscription arm speaks the shared query
    // grammar and receives the same ordinary row shape as every graph read.
    let { query } = await import('./client.ts')
    let got = ids(await query([`.notice.target=${RV}`, '.archived=']))
    assertEquals(got.includes(RN), true) // the venture notice reached the loop

    // Text retrieval is the same /query row shape with a transient rank
    // component. No parallel search response contract survives the migration.
    let ranked = await (await fetch(
      `http://${U}/query?${encodeURIComponent('Route')}&${
        encodeURIComponent('.order=search')
      }`,
    )).json() as Record<string, Record<string, unknown>>[]
    let task = ranked.find((r) =>
      (r.entity as { eid?: string } | undefined)?.eid == RT
    )
    assertEquals(typeof task?.rank?.score, 'number')
    assertEquals(typeof task?.rank?.title_hit, 'string')
    assertEquals(task?.rank?.open, RT)
  },
)
