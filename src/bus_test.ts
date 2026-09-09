// The comms bus has two suppliers and ONE selection. `noticesFor` hands it the
// whole graph; `bus` hands it a handful of keyed queries. This is the
// differential between them: for every shape below, the narrow fetch must
// answer exactly what the corpus answers — same lines, same stamps.
//
// An arm the candidate queries forget shows up here as a line the snapshot
// found and the queries did not. In production that is silence: a comment, a
// knock or a letter that simply never reaches the operator, with nothing
// failing anywhere. It is the whole reason this file exists.
//
// The fake door parses the filter line through query.ts, so a candidate query
// is answered as narrowly as the server would answer it (graph_fake.ts).

import { assertEquals, assertRejects } from '@std/assert'
import {
  bus,
  contextDigest,
  contextSnapshot,
  noticesFor,
  readerFor,
  rowOf,
  rows,
} from './client.ts'
import { followInbox, inboxDelta } from './inbox_follow.ts'
import { answers, fakeGraph } from './graph_fake.ts'
import type { Change, Snapshot } from './types.ts'

let U = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`
let P = U(1) // the project the session stands in
let S = U(2) // the session under test
let B = U(3) // another session — the one doing the talking
let T = U(4) // a task this session claims
let X = U(5) // a task it does not
let N = U(6) // the persona it wears
let Y = U(8) // a PERSON, an actor that is not itself a project
let H = U(9) // a project with no checkout — reachable only through N.home

let ent = (
  eid: string,
  num: number,
  comps: Record<string, Record<string, unknown>>,
): Change[] => [
  { eid, name: 'entity', comp: { eid, num } },
  ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
]

// One session standing in one project, holding one claim — the ordinary shape
// every case below varies.
let world = (sess: Record<string, unknown> = {}): Change[] => [
  // The project IS the repo, as it is in the graph — so a cwd under /w
  // places the session in P and its mail lands.
  ...ent(P, 1, {
    doc: { title: 'Home', body: '' },
    project: {},
    repo: { path: '/w' },
  }),
  ...ent(N, 6, { doc: { title: 'voice', body: '' }, persona: { home: H } }),
  ...ent(S, 2, {
    doc: { title: 'Work session', body: '' },
    session: {
      id: 'sess-x',
      cwd: '/w',
      actor: P,
      persona: N,
      operator: 1,
      ...sess,
    },
  }),
  ...ent(H, 9, { doc: { title: 'Venture', body: '' }, project: {} }),
  ...ent(Y, 8, {
    doc: { title: 'Someone', body: '' },
    person: {},
    email: { address: 'someone@example.test' },
  }),
  ...ent(B, 3, {
    doc: { title: 'Other session', body: '' },
    session: { id: 'sess-b', actor: P },
  }),
  ...ent(T, 4, {
    doc: { title: 'Claimed work', body: '' },
    task: {},
    claim: { session: S },
    created: { at: '2026-01-01', by: P },
  }),
  ...ent(X, 5, {
    doc: { title: 'Someone else', body: '' },
    task: {},
    created: { at: '2026-01-01', by: P },
  }),
]

let said = (
  eid: string,
  num: number,
  target: string,
  body: string,
  at = '2026-01-02',
  via = B,
) =>
  ent(eid, num, {
    created: { at, by: P, via },
    doc: { title: '', body },
    comment: { target: target },
  })

// A knock is born NOW: the bus drops one older than a week (client.ts
// notices), so a fixed fixture date would age out of the very case it feeds.
let knocked = (eid: string, num: number, to: string, target: string) =>
  ent(eid, num, {
    created: { at: new Date().toISOString(), by: P, via: B },
    knock: { target: target },
    // WHO it is for rides the shared deliver.to now (D-14945).
    deliver: { to },
    // Settled delivered (D-14945) — the inbox sweep surfaces it regardless,
    // the same as the old acted_at receipt it replaces.
    delivered: { at: '2026-01-03', via: 'cast' },
  })

let letter = (
  eid: string,
  num: number,
  target: string,
  comp: Record<string, unknown> = {},
) =>
  ent(eid, num, {
    created: { at: '2026-01-04', by: P, via: B },
    doc: { title: 'hello', body: 'mail body' },
    mail: {
      target: target,
      from: 'friend@example.test',
      received_at: '2026-01-04',
      message_id: `m-${num}`,
      verified: 1,
      ...comp,
    },
  })

let instruction = (
  eid: string,
  num: number,
  target: string,
  mode: 'watch' | 'mute',
) =>
  ent(eid, num, {
    created: { at: '2026-01-01', by: P },
    subscription: { actor: P, target: target, mode },
  })

// A recall floater in the session's OWN log (recall.ts): no recipient facet,
// keyed only by entry.session, its lines in `content`. `at` is its birth — a
// fresh floater rings, one that missed its beat (older than the recall window,
// T-17487) is gone. The default is right now; a stale case passes an old `at`.
let floater = (
  eid: string,
  num: number,
  body: string,
  at = new Date().toISOString(),
) =>
  ent(eid, num, {
    entry: { session: S, seq: num },
    content: { body },
    recalled: { source: T },
    created: { at, by: null, via: null },
  })

let graph = (...extra: Change[][]): Snapshot => ({
  changes: [...world(), ...extra.flat()],
  deps: [],
})

// Each case: what it exercises, the graph it exercises it in, and how many
// lines it is worth — a count spelled out here, because two suppliers that
// both find nothing agree perfectly and prove nothing.
let cases: [string, Snapshot, number][] = [
  ['nothing waiting', graph(), 0],
  ['a comment on the claimed task', graph(said('c1', 20, T, 'heads up')), 1],
  [
    'a comment aimed at the session entity is not delivered',
    graph(said('c2', 21, S, 'ping')),
    0,
  ],
  [
    // Three comments sharing one created.at, inserted num-DESCENDING so the
    // whole-snapshot supplier (rows(), insertion order) and the bus (uniq(),
    // num order) feed notices() in OPPOSITE orders. bornAt ties for all three,
    // so without a total-order tie-break the two suppliers render the lines in
    // different orders and this differential fails — the parallel-bus flake of
    // T-15463. The eid tie-break makes both orders identical.
    'tied timestamps resolve identically for both suppliers',
    graph(
      said('z3', 42, T, 'gamma', '2026-01-05'),
      said('z2', 41, T, 'beta', '2026-01-05'),
      said('z1', 40, T, 'alpha', '2026-01-05'),
    ),
    3,
  ],
  [
    'a comment on a task nobody here claims',
    graph(said('c3', 22, X, 'away')),
    0,
  ],
  [
    'a comment this very session wrote',
    graph(said('c4', 23, T, 'my own note', '2026-01-02', S)),
    0,
  ],
  // Said to the venture, not to one of its sessions: the operator loop hears
  // it, the same door the inbox predicate opens.
  [
    'a comment aimed at the actor reaches its operator loop',
    graph(said('c5', 24, P, 'to the venture')),
    1,
  ],
  [
    'a knock, with the words riding as a comment on its target',
    graph(
      knocked('k1', 25, S, T),
      said('c6', 26, T, 'look here', '2026-01-03'),
    ),
    2,
  ],
  ['a knock aimed at the actor', graph(knocked('k2', 27, P, T)), 1],
  // The knock's words ride as a comment on its TARGET, which is nothing this
  // session holds — so nothing else in the gather would have pulled it in.
  [
    'a knock at something this session does not hold',
    graph(
      knocked('k5', 46, S, X),
      said('c12', 47, X, 'look here', '2026-01-03'),
    ),
    1,
  ],
  // A recall floater born now rings, exactly like a comment on the session —
  // the delivery T-17476 restored.
  [
    'a fresh recall floater',
    graph(floater('rf1', 70, 'M-1 · fresh recall')),
    1,
  ],
  // One that missed its beat is gone (T-17487): both suppliers must drop it, or
  // the narrow bus and the whole-snapshot digest disagree — busRows' query
  // bound excludes it, channelEvents' born bound excludes it, and this count
  // pins them together. `world`'s clock is months back, so this `at` is stale.
  [
    'a stale recall floater',
    graph(floater('rf2', 71, 'M-2 · stale recall', '2026-01-02')),
    0,
  ],
  ['verified project mail', graph(letter('m1', 28, P)), 1],
  ['unverified project mail', graph(letter('m2', 29, P, { verified: 0 })), 0],
  ['a letter to the session itself', graph(letter('m3', 30, S)), 1],
  [
    'a human-opened letter still reaches the agent',
    graph(letter('m4', 31, P), ent('m4', 31, { opened: {} })),
    1,
  ],
  [
    'a letter already archived',
    graph(letter('m5', 32, P), ent('m5', 32, { archived: {} })),
    0,
  ],
  [
    'human notification state does not hide an agent item',
    graph(said('c7', 33, T, 'told you'), ent('c7', 33, { notified: {} })),
    1,
  ],
  [
    'everything at once',
    graph(
      said('c8', 34, T, 'heads up'),
      said('c9', 35, S, 'ping'), // aimed at the session entity: not delivered
      said('ca', 36, X, 'away'),
      knocked('k3', 37, S, T),
      letter('m6', 38, P),
      letter('m7', 39, P, { verified: 0 }),
    ),
    3,
  ],
  [
    'more than one screenful',
    graph(
      ...Array.from(
        { length: 22 },
        (_, i) =>
          said(
            `o${i}`,
            50 + i,
            T,
            `message ${i}`,
            `2026-02-${String(i + 1).padStart(2, '0')}`,
          ),
      ),
    ),
    // ten served, one line counting the rest
    11,
  ],
  // A specialist hears direct address and its own claimed work, never the
  // project's mail or a knock aimed at the venture.
  [
    'a specialist, not the operator loop',
    {
      changes: [
        ...world({ operator: 0 }),
        ...said('c10', 40, T, 'heads up'),
        ...knocked('k4', 41, P, T),
        ...letter('m8', 42, P),
      ],
      deps: [],
    },
    1,
  ],
  // Scope by the worn persona's home instead of the cwd: the reader gather
  // has to walk session → persona → home, and project mail rides on it. The
  // home wins over the actor-as-project, so the letter to P stays unheard.
  [
    'a session standing nowhere on disk',
    {
      changes: [
        ...world({ cwd: '/elsewhere' }),
        ...letter('m9', 43, H),
        ...letter('m12', 49, P),
      ],
      deps: [],
    },
    1,
  ],
  // The worn persona's home is a DIFFERENT project from the actor, so the
  // scope is only reachable by walking session → persona → home.
  [
    'a persona whose home is not the actor',
    {
      changes: [
        ...world({ cwd: '/elsewhere', actor: Y }),
        ...letter('m11', 48, H),
      ],
      deps: [],
    },
    1,
  ],
  // WATCH AND MUTE DO NOT REACH THE BUS, and these two cases say so in code.
  // `inboxItem` is `addressed()` overridden by the standing instruction, and
  // it governs `task inbox`, the web Inbox tab and the TUI. The bus reads
  // through channelEvents, whose Ctx has no watching/muting field at all — so
  // a watch admits nothing here and a mute silences nothing. That is why the
  // candidate gather gathers from the address columns alone; the day the
  // selector grows a watch rule, busRows needs `.comment.target=<watched>`
  // in the same commit, and these two counts are what will change.
  [
    'a watch on something nothing here is aimed at',
    graph(
      instruction('s1', 60, X, 'watch'),
      said('c13', 61, X, 'watched, not addressed'),
    ),
    0,
  ],
  [
    'a mute on the very thing addressed to me',
    graph(
      instruction('s2', 62, T, 'mute'),
      said('c14', 63, T, 'muted, but still addressed'),
    ),
    1,
  ],
  // A session with no actor at all: no addresses, no subscriptions, no scope.
  [
    'a session acting for nobody',
    {
      changes: [
        ...world({ actor: undefined, persona: undefined }),
        ...said('c11', 44, T, 'heads up'),
        ...letter('m10', 45, P),
      ],
      deps: [],
    },
    2,
  ],
]

let against = async (snap: Snapshot, session: string) => {
  let { server, seen, host } = fakeGraph(snap)
  let was = Deno.env.get('TASKS_HOST')
  Deno.env.set('TASKS_HOST', host)
  try {
    return { got: await bus(session), seen }
  } finally {
    if (was) Deno.env.set('TASKS_HOST', was)
    else Deno.env.delete('TASKS_HOST')
    await server.shutdown()
  }
}

for (let [what, snap, want] of cases) {
  Deno.test(`bus reads narrowly and answers the same: ${what}`, async () => {
    let { got, seen } = await against(snap, 'sess-x')
    assertEquals(got, noticesFor(snap, 'sess-x'))
    assertEquals(got.lines.length, want)
    // and it never took the corpus to get there
    assertEquals(seen.filter((line) => line.startsWith('/snapshot')), [])
  })
}

Deno.test('context queries render the same digest as the whole graph', async () => {
  let snap = graph(said('context-note', 80, T, 'the narrow digest sees me'))
  let { server, seen, host } = fakeGraph(snap)
  let was = Deno.env.get('TASKS_HOST')
  Deno.env.set('TASKS_HOST', host)
  try {
    let narrow = await contextSnapshot('sess-x', '/w')
    assertEquals(
      contextDigest(narrow, 'sess-x', Date.now()),
      contextDigest(snap, 'sess-x', Date.now()),
    )
    assertEquals(seen.some((line) => line.startsWith('/snapshot')), false)
  } finally {
    if (was) Deno.env.set('TASKS_HOST', was)
    else Deno.env.delete('TASKS_HOST')
    await server.shutdown()
  }
})

Deno.test('bus: a session id naming nothing is silent, and asks nothing more', async () => {
  let { got, seen } = await against(graph(said('c1', 20, T, 'hi')), 'nobody')
  assertEquals(got, { lines: [], eids: [], at: '' })
  assertEquals(got, noticesFor(graph(said('c1', 20, T, 'hi')), 'nobody'))
  assertEquals(seen, ['/query?.kind=session&.session.id=nobody'])
})

Deno.test('inbox follow: snapshot delta shares the bus recipients and verification', () => {
  for (let [what, snap, want] of cases) {
    let all = rows(snap)
    let delta = inboxDelta(all, readerFor(all, 'sess-x'), new Set())
    // Follow alone consumes notified: the ordinary bus deliberately ignores it.
    let stamped = all.filter((r) => r.comps.notified).length
    assertEquals(
      delta.length,
      (what == 'more than one screenful' ? 22 : want) - stamped,
      what,
    )
    assertEquals(delta.every((item) => !item.line.includes('\n')), true, what)
  }
})

Deno.test('inbox follow: initial backlog, first lines, repeat and durable receipts', () => {
  let snap = graph(
    ...Array.from(
      { length: 12 },
      (_, i) =>
        said(`c-${i}`, 100 + i, T, `hello ${i}\nnot another notification`),
    ),
    said('settle', 120, T, 'S-3 completed · exit 0\nwork landed'),
    knocked('kn', 121, S, X),
    letter('ml', 122, P),
    letter('late', 123, P, { verified: 0 }),
  )
  let all = rows(snap)
  let who = readerFor(all, 'sess-x')
  let delta = inboxDelta(all, who, new Set())
  assertEquals(delta.length, 15) // no ten-item digest cap or summary pseudo-notice
  assertEquals(delta[0].line, 'comment · P-1 via S-3 · T-4 · hello 0')
  assertEquals(
    delta.find((x) => x.eid == 'settle')?.line,
    'comment · P-1 via S-3 · T-4 · S-3 completed · exit 0',
  )
  assertEquals(
    delta.find((x) => x.eid == 'ml')?.line,
    'mail · friend@example.test · P-1 · mail body',
  )
  let seen = new Set(delta.map((x) => x.eid))
  assertEquals(inboxDelta(all, who, seen), [])
  let stamped = rows({
    ...snap,
    changes: [
      ...snap.changes,
      ...delta.map(({ eid }) => ({ eid, name: 'notified', comp: {} })),
    ],
  })
  assertEquals(inboxDelta(stamped, who, new Set()), []) // restarted monitor
  // A newly verified, older letter is news even behind the latest timestamp.
  let later = rows({
    ...snap,
    changes: [...snap.changes, ...letter('late', 123, P)],
  })
  assertEquals(inboxDelta(later, who, seen).map((x) => x.eid), ['late'])
})

Deno.test('inbox follow: polls through silence, writes once, propagates server loss', async () => {
  let poll = 0
  let out: string[] = []
  let stamps: Change[] = []
  let sleeps: number[] = []
  let snap = graph(said('fresh', 100, T, 'wake me'))
  await assertRejects(
    () =>
      followInbox('sess-x', '/w', 25, (s) => out.push(s), {
        query: (filters) => {
          if (poll == 4) return Promise.reject(new Error('server gone'))
          let answer = answers(poll == 0 ? graph() : snap)
          return Promise.resolve(
            answer(filters.join('&')).map((r) =>
              rowOf(r as Record<string, unknown>)
            ),
          )
        },
        stamp: (cs) => {
          stamps.push(...cs)
          return Promise.resolve()
        },
        pause: (ms) => {
          sleeps.push(ms)
          poll++
          return Promise.resolve()
        },
      }),
    Error,
    'server gone',
  )
  assertEquals(out, ['comment · P-1 via S-3 · T-4 · wake me'])
  assertEquals(stamps, [{ eid: 'fresh', name: 'notified', comp: {} }])
  assertEquals(sleeps, [25, 25, 25, 25])
})

Deno.test('inbox follow: stamp failures and invalid intervals do not keep polling', async () => {
  let snap = graph(said('fresh', 100, T, 'wake me'))
  let io = {
    query: (filters: string[]) =>
      Promise.resolve(
        answers(snap)(filters.join('&')).map((r) =>
          rowOf(r as Record<string, unknown>)
        ),
      ),
    stamp: () => Promise.reject(new Error('stamp failed')),
    pause: () => {
      throw new Error('must not sleep')
    },
  }
  await assertRejects(
    () => followInbox('sess-x', '/w', 1, () => {}, io),
    Error,
    'stamp failed',
  )
  for (let interval of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    await assertRejects(
      () => followInbox('sess-x', '/w', interval, () => {}, io),
      Error,
      '--interval must be',
    )
  }
})
