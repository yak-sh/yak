// The headless client's pure half: dot-param grammar, row assembly,
// change builders, and the injection digest. No server, no db.
import {
  belongs,
  byBoard,
  checkRefs,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  derefParams,
  designChanges,
  edgesOf,
  find,
  hookClaim,
  inboxItem,
  inflate,
  isOperator,
  isUnread,
  jsonOf,
  ledger,
  mailAt,
  mailChanges,
  mailLine,
  me,
  memoryChanges,
  noticesFor,
  param,
  patches,
  readerAt,
  readerFor,
  recallIndex,
  replyChanges,
  repoAt,
  reSubject,
  type Row,
  rows,
  scopeFor,
  separated,
  sessionFor,
  sessionMeta,
  showMd,
  spawnChanges,
  spawnDefaults,
  spec,
  STUB,
  subChanges,
  taskBlock,
  taskChanges,
  threadOf,
  unreadMail,
  wrapChanges,
} from './client.ts'
import { matchQuery, parseQuery, resolveRefs } from './query.ts'
import { type Change, idOf, kindOf, type Snapshot } from './types.ts'
import { assertEquals, assertMatch, assertThrows } from '@std/assert'

// A tiny graph: one board-ordered pair of tasks, a session, a claim.
let S = 'aaaaaaaa-0000-4000-8000-000000000001'
let T1 = 'aaaaaaaa-0000-4000-8000-000000000002'
let T2 = 'aaaaaaaa-0000-4000-8000-000000000003'
let snap: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x', cwd: '/w' } },
    { eid: T1, name: 'entity', comp: { eid: T1, num: 2, created_at: '' } },
    { eid: T1, name: 'doc', comp: { title: 'First', body: '' } },
    { eid: T1, name: 'task', comp: { status: 'wip', priority: 0 } },
    { eid: T1, name: 'claim', comp: { session_eid: S } },
    { eid: T2, name: 'entity', comp: { eid: T2, num: 3, created_at: '' } },
    { eid: T2, name: 'doc', comp: { title: 'Second', body: '' } },
    { eid: T2, name: 'task', comp: { status: 'open', priority: 1 } },
    { eid: T2, name: 'alias', comp: { slug: 'old-board-slug' } },
  ],
  deps: [{ parent: T1, type: 'requires', child: T2 }],
}
let all = rows(snap)
let by = (eid: string) => all.find((r) => r.eid == eid)!

Deno.test('rows: merge, derived kind, ids', () => {
  assertEquals(by(T1).kind, 'task')
  assertEquals(by(S).kind, 'session')
  assertEquals(idOf(by(T1)), 'T-2')
  assertEquals(idOf(by(S)), 'S-1')
  assertEquals(kindOf({ comment: {}, review: {} }), 'review')
  assertEquals(kindOf({}), 'entity')
})

Deno.test('jsonOf: an entity is its components without SQL join keys', () => {
  let r: Row = {
    eid: T1,
    num: 2,
    kind: 'task',
    comps: {
      entity: { eid: T1, num: 2 },
      doc: { eid: T1, title: 'First', body: '' },
      task: { eid: T1, status: 'wip', priority: 0 },
      kind: { eid: T1, value: 'reserved' },
    },
  }
  assertEquals(jsonOf(r), {
    kind: 'task',
    entity: { eid: T1, num: 2 },
    doc: { title: 'First', body: '' },
    task: { status: 'wip', priority: 0 },
  })
})

// The grammar, as a case table: arg → routed {comp, prop, value} or error.
let CASES: [string, { comp: string; prop: string; value: unknown } | RegExp][] =
  [
    ['.title=Hi', { comp: 'doc', prop: 'title', value: 'Hi' }],
    ['.status=done', { comp: 'task', prop: 'status', value: 'done' }],
    ['.status=WIP', { comp: 'task', prop: 'status', value: 'wip' }],
    ['.domain=Eng', { comp: 'task', prop: 'domain', value: 'Eng' }],
    ['.proposed.at=2026-08-01T00:00:00.000Z', {
      comp: 'proposed',
      prop: 'at',
      value: '2026-08-01T00:00:00.000Z',
    }],
    ['.operator=YES', { comp: 'session', prop: 'operator', value: 1 }],
    ['.provider=fake', {
      comp: 'session',
      prop: 'provider',
      value: 'fake',
    }],
    ['.persona=N-1', {
      comp: 'session',
      prop: 'persona_eid',
      value: 'N-1',
    }],
    ['.spawn.provider=fake', {
      comp: 'spawn',
      prop: 'provider',
      value: 'fake',
    }],
    ['.project.retired_at=2026-07-01T00:00:00Z', {
      comp: 'project',
      prop: 'retired_at',
      value: '2026-07-01T00:00:00.000Z',
    }],
    ['.priority=1.5', { comp: 'task', prop: 'priority', value: 1.5 }],
    // priority speaks P<n> at the write door too (T-6741/T-7143): 'P2' and
    // '2' both store the integer 2; garbage is a loud error, not bad data.
    ['.priority=P2', { comp: 'task', prop: 'priority', value: 2 }],
    ['.priority=2', { comp: 'task', prop: 'priority', value: 2 }],
    ['.priority=P0', { comp: 'task', prop: 'priority', value: 0 }],
    ['.task.priority=P1', { comp: 'task', prop: 'priority', value: 1 }],
    ['.priority=banana', /priority is a number/],
    ['.priority=P', /priority is a number/],
    ['.pin.x=12', { comp: 'pin', prop: 'x', value: 12 }],
    ['.assignee=jeff', { comp: 'task', prop: 'assignee_eid', value: 'jeff' }],
    // a shared ref name filters as any-of, but a WRITE must aim
    ['.actor=jeff', /ambiguous for writes/],
    ['.session.actor_eid=jeff', {
      comp: 'session',
      prop: 'actor_eid',
      value: 'jeff',
    }],
    ['.x=12', /ambiguous/],
    ['.nope=1', /unknown prop/],
    // Hyphenated names must ROUTE (and fail) rather than slip the
    // pattern: a name the regex rejected returned null, and cli.ts's
    // split() files every non-param token under `words` — so
    // `.blocked-by=T-1` became part of the task's TITLE, no edge and no
    // error. No column is hyphenated, so nothing new resolves.
    ['.blocked-by=T-1', /unknown prop/],
    ['.doc.nope=1', /no such prop/],
  ]
Deno.test('dot-param routing', () => {
  for (let [arg, want] of CASES) {
    if (want instanceof RegExp) {
      assertThrows(() => param(arg), Error, undefined, arg)
    } else assertEquals(param(arg), want, arg)
  }
  assertEquals(param('bare word'), null)
  assertEquals(patches([param('.title=a')!, param('.status=wip')!]), {
    doc: { title: 'a' },
    task: { status: 'wip' },
  })
})

Deno.test('find: T-num, bare num, eid, alias slug', () => {
  assertEquals(find(all, 'T-2')?.eid, T1)
  assertEquals(find(all, '3')?.eid, T2)
  assertEquals(find(all, T1)?.eid, T1)
  assertEquals(find(all, 'old-board-slug')?.eid, T2)
  assertEquals(find(all, 'T-99'), undefined)
})

Deno.test('notices: unseen comments on claimed tasks + messages to the session', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000010' // another session
  let P = 'aaaaaaaa-0000-4000-8000-000000000011' // their shared actor
  let mk = (
    eid: string,
    target: string,
    via: string,
    at: string,
    body: string,
  ) => [
    { eid, name: 'entity', comp: { eid, num: 90 } },
    { eid, name: 'created', comp: { at, by: P, via } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target_eid: target } },
  ]
  let busSnap: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 81 } },
      { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: P, name: 'project', comp: {} },
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor_eid: P },
      },
      { eid: B, name: 'entity', comp: { eid: B, num: 80, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b', actor_eid: P } },
      // on the claimed task, after the cutoff: heard
      ...mk('c-1', T1, B, '2026-01-02', 'heads up'),
      { eid: 'c-1', name: 'review', comp: { verdict: 'approved' } },
      // aimed at the session itself: heard (a message TO sess-x)
      ...mk('c-2', S, B, '2026-01-03', 'ping'),
      // spoken via the listener: never echoed back
      ...mk('c-3', T1, S, '2026-01-04', 'my own note'),
      // on an unclaimed task: not ours to hear
      ...mk('c-4', T2, B, '2026-01-05', 'elsewhere'),
    ],
    deps: snap.deps,
  }
  let n = noticesFor(busSnap, 'sess-x')
  assertEquals(n.lines.length, 2)
  assertEquals(n.lines[0].includes('heads up'), true)
  assertEquals(n.lines[0].includes('[approved]'), true)
  assertEquals(n.lines[1].includes('P-81 · via S-80: ping'), true)
  // serving a comment stamps `notified` on it (T-7010): the sweep is a
  // delivery door, so the channel plugin won't re-inject what it already told.
  let told = n.ack.filter((c) => c.name == 'notified').map((c) => c.eid).sort()
  assertEquals(told, ['c-1', 'c-2'])
  assertEquals(
    n.ack.every((c) => c.name == 'notified' ? c.comp != null : true),
    true,
  )
  // a comment already `notified` isn't re-stamped — the batch stays lean
  // (the write is idempotent besides).
  let pre: Snapshot = {
    changes: [...busSnap.changes, { eid: 'c-1', name: 'notified', comp: {} }],
    deps: snap.deps,
  }
  assertEquals(
    noticesFor(pre, 'sess-x').ack.filter((c) => c.name == 'notified').map((c) =>
      c.eid
    ),
    ['c-2'],
  )
  // per-item `notified` — not the cursor — silences a served comment: stamp
  // both heard comments and neither is re-served.
  let seen: Snapshot = {
    changes: [
      ...busSnap.changes,
      { eid: 'c-1', name: 'notified', comp: {} },
      { eid: 'c-2', name: 'notified', comp: {} },
    ],
    deps: snap.deps,
  }
  assertEquals(noticesFor(seen, 'sess-x').lines.length, 0)
  // the acked_at cursor no longer gates: a cursor past both comments does NOT
  // hide them — only the per-item stamp does (drain-proof, see below).
  let acked: Snapshot = {
    changes: busSnap.changes.map((c) =>
      c.eid == S && c.name == 'session'
        ? { ...c, comp: { ...c.comp, acked_at: '2099-01-01' } }
        : c
    ),
    deps: snap.deps,
  }
  assertEquals(noticesFor(acked, 'sess-x').lines.length, 2)
  // unknown session: silent, no ack
  assertEquals(noticesFor(busSnap, 'sess-nobody'), { lines: [], ack: [] })
})

Deno.test('notices: comments, acted knocks, and verified operator mail surface together', () => {
  let P = 'aaaaaaaa-0000-4000-8000-000000000041'
  let B = 'aaaaaaaa-0000-4000-8000-000000000042'
  let C = 'aaaaaaaa-0000-4000-8000-000000000043'
  let K = 'aaaaaaaa-0000-4000-8000-000000000044'
  let M = 'aaaaaaaa-0000-4000-8000-000000000045'
  let U = 'aaaaaaaa-0000-4000-8000-000000000046'
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 41 } },
      { eid: P, name: 'doc', comp: { title: 'Home', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: B, name: 'entity', comp: { eid: B, num: 42 } },
      { eid: B, name: 'session', comp: { id: 'sender' } },
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor_eid: P, operator: 1 },
      },
      { eid: C, name: 'entity', comp: { eid: C, num: 43 } },
      { eid: C, name: 'created', comp: { at: '2026-01-02', by: P, via: B } },
      { eid: C, name: 'doc', comp: { title: '', body: 'review this' } },
      { eid: C, name: 'comment', comp: { target_eid: T1 } },
      { eid: K, name: 'entity', comp: { eid: K, num: 44 } },
      { eid: K, name: 'created', comp: { at: '2026-01-03' } },
      {
        eid: K,
        name: 'knock',
        comp: {
          to_eid: S,
          target_eid: T1,
          acted_at: '2026-01-03',
          error: 'no channel',
        },
      },
      { eid: M, name: 'entity', comp: { eid: M, num: 45 } },
      { eid: M, name: 'created', comp: { at: '2026-01-04' } },
      { eid: M, name: 'doc', comp: { title: 'hello', body: 'mail body' } },
      {
        eid: M,
        name: 'mail',
        comp: {
          target_eid: P,
          from: 'friend@example.test',
          received_at: '2026-01-04',
          message_id: 'm-1',
          verified: 1,
        },
      },
      { eid: U, name: 'entity', comp: { eid: U, num: 46 } },
      { eid: U, name: 'created', comp: { at: '2026-01-05' } },
      { eid: U, name: 'doc', comp: { title: 'bad', body: 'unverified' } },
      {
        eid: U,
        name: 'mail',
        comp: {
          target_eid: P,
          received_at: '2026-01-05',
          message_id: 'm-2',
          verified: 0,
        },
      },
    ],
    deps: snap.deps,
  }
  let n = noticesFor(g, 'sess-x')
  assertEquals(n.lines.length, 3)
  assertEquals(n.lines.every((line) => line.startsWith('UNTRUSTED ')), true)
  assertEquals(n.lines.some((line) => line.includes('review this')), true)
  assertEquals(
    n.lines.some((line) => line.includes('knock: look at T-2')),
    true,
  )
  assertEquals(n.lines.some((line) => line.includes('mail body')), true)
  assertEquals(n.lines.some((line) => line.includes('unverified')), false)
  assertEquals(
    n.ack.filter((c) => c.name == 'notified').map((c) => c.eid).sort(),
    [C, K, M].sort(),
  )
  let ordinary: Snapshot = {
    ...g,
    changes: g.changes.map((change) =>
      change.eid == S && change.name == 'session'
        ? { ...change, comp: { ...change.comp, operator: 0 } }
        : change
    ),
  }
  let direct = noticesFor(ordinary, 'sess-x').lines
  assertEquals(direct.some((line) => line.includes('mail body')), false)
  assertEquals(direct.some((line) => line.includes('review this')), true)
  assertEquals(direct.some((line) => line.includes('knock: look at T-2')), true)
  let seen = {
    ...g,
    changes: [
      ...g.changes,
      ...n.ack.filter((c) => c.name == 'notified'),
    ],
  }
  assertEquals(noticesFor(seen, 'sess-x').lines, [])
})

Deno.test('notices: overflow remains pending until a later read', () => {
  let comments = Array.from({ length: 22 }, (_, i) => {
    let eid = `comment-${String(i).padStart(2, '0')}`
    return [
      { eid, name: 'entity', comp: { eid, num: 100 + i } },
      {
        eid,
        name: 'created',
        comp: { at: `2026-01-${String(i + 1).padStart(2, '0')}` },
      },
      { eid, name: 'doc', comp: { title: '', body: `message ${i}` } },
      { eid, name: 'comment', comp: { target_eid: S } },
    ]
  }).flat()
  let g: Snapshot = { changes: [...snap.changes, ...comments], deps: snap.deps }
  let first = noticesFor(g, 'sess-x')
  assertEquals(first.lines.length, 21) // 20 items + overflow summary
  assertEquals(
    first.ack.filter((c) => c.name == 'notified').length,
    20,
  )
  let later: Snapshot = {
    ...g,
    changes: [
      ...g.changes,
      ...first.ack.filter((c) => c.name == 'notified'),
    ],
  }
  let second = noticesFor(later, 'sess-x')
  assertEquals(second.lines.length, 2)
  assertEquals(
    second.ack.filter((c) => c.name == 'notified').length,
    2,
  )
})

// Drain-proof: one reader serving a comment advances the shared `acked_at`
// cursor, but selection reads the PER-ITEM stamp — so a second, un-notified
// comment the cursor would have swept past is still served. This is the exact
// failure the cursor had (a subagent's ack blinding the operator to a sibling
// comment) and the reason per-item is the truth.
Deno.test('notices: per-item stamp is drain-proof (a served ack cannot hide a sibling)', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000030'
  let mk = (eid: string, at: string, body: string) => [
    { eid, name: 'entity', comp: { eid, num: 90 } },
    { eid, name: 'created', comp: { at, via: B } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target_eid: S } },
  ]
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: B, name: 'entity', comp: { eid: B, num: 30, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b' } },
      ...mk('m-1', '2026-01-02', 'first ping'),
      ...mk('m-2', '2026-01-03', 'second ping'),
    ],
    deps: snap.deps,
  }
  // fresh: both un-notified, both served
  assertEquals(noticesFor(g, 'sess-x').lines.length, 2)
  // one reader served m-1: it stamped `notified` on m-1 AND advanced the
  // shared cursor past BOTH (acked_at = now). The old cursor gate would now
  // hide m-2 (born before the cursor); per-item keeps it — m-2 is un-notified.
  let drained: Snapshot = {
    changes: [
      ...g.changes.map((c) =>
        c.eid == S && c.name == 'session'
          ? { ...c, comp: { ...c.comp, acked_at: '2099-01-01' } }
          : c
      ),
      { eid: 'm-1', name: 'notified', comp: {} },
    ],
    deps: snap.deps,
  }
  let n = noticesFor(drained, 'sess-x')
  assertEquals(n.lines.length, 1)
  assertEquals(n.lines[0].includes('second ping'), true)
  // and serving it only stamps the sibling, never re-stamps m-1
  assertEquals(
    n.ack.filter((c) => c.name == 'notified').map((c) => c.eid),
    ['m-2'],
  )
})

Deno.test('rows filter through the query grammar + byBoard', () => {
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=wip')), true)
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=done')), false)
  let review = {
    comment: { target_eid: T1 },
    review: { verdict: 'approved' },
  }
  assertEquals(
    matchQuery(
      review,
      parseQuery(`.comment.target_eid=${T1}&.verdict=approved`),
    ),
    true,
  )
  assertEquals([...all.filter((r) => r.comps.task)].sort(byBoard)[0].eid, T2) // open before wip
})

Deno.test('taskChanges: defaults + grouped comps ride along', () => {
  let cs = taskChanges('E', { doc: { title: 'x' }, pin: { x: 1 } })
  assertEquals(cs.map((c) => c.name), ['doc', 'task', 'pin'])
  assertEquals(cs[0].comp, { body: '', title: 'x' })
  assertEquals(cs[1].comp?.status, 'open')
})

Deno.test('sessionFor: reuse, mint, cwd + pid refresh', () => {
  assertEquals(sessionFor(all, 'sess-x').changes, []) // known, same cwd
  assertEquals(sessionFor(all, 'sess-x', '/elsewhere').changes.length, 1) // cwd moved
  let minted = sessionFor(all, 'sess-new', '/w2', 4242)
  assertEquals(minted.changes[0].comp, {
    id: 'sess-new',
    cwd: '/w2',
    pid: 4242,
  })
  // an unstamped row gains its pid; a re-run with the same pid is silent
  assertEquals(sessionFor(all, 'sess-x', '/w', 4242).changes, [
    { eid: S, name: 'session', comp: { pid: 4242 } },
  ])
})

Deno.test('sessionFor: task context fills only a missing actor', () => {
  let actor = 'aaaaaaaa-0000-4000-8000-000000000004'
  assertEquals(
    sessionFor(all, 'sess-x', undefined, undefined, { actor_eid: actor })
      .changes,
    [{ eid: S, name: 'session', comp: { actor_eid: actor } }],
  )
  let worn = rows({
    changes: [
      ...snap.changes,
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', actor_eid: T2 },
      },
    ],
  })
  assertEquals(
    sessionFor(worn, 'sess-x', undefined, undefined, { actor_eid: actor })
      .changes,
    [],
  )
})

Deno.test('me: provider ids name external sessions; launchers name managed ones', () => {
  let env = (vals: Record<string, string>) => (k: string) => vals[k]
  assertEquals(
    me(env({
      CLAUDE_CODE_SESSION_ID: 'rotating',
      TASKS_SESSION: 'stale',
      CODEX_THREAD_ID: 'codex',
    })),
    'rotating',
  )
  assertEquals(
    me(env({ TASKS_SESSION: 'launcher', CODEX_THREAD_ID: 'codex' })),
    'launcher',
  )
  assertEquals(me(env({ CODEX_THREAD_ID: 'codex' })), 'codex')
  assertEquals(me(env({})), undefined)
})

Deno.test('claimChanges points at the session entity', () => {
  let cs = claimChanges(all, T2, 'sess-x')
  assertEquals(cs, [{ eid: T2, name: 'claim', comp: { session_eid: S } }])
})

Deno.test('spawnChanges: one session change carrying the request', () => {
  let made = spawnChanges(all, {
    task: 'T-3', // human id resolves
    provider: 'claude',
    model: 'claude-fable-5',
    effort: 'high',
    persona: 'old-board-slug', // aliases resolve too
  })
  assertEquals(made.changes.length, 1)
  let c = made.changes[0]
  assertEquals(c.name, 'session')
  assertEquals(c.comp?.provider, 'claude')
  assertEquals(c.comp?.model, 'claude-fable-5')
  assertEquals(c.comp?.effort, 'high')
  assertEquals(c.comp?.requested_task_eid, T2)
  assertEquals(c.comp?.persona_eid, T2)
  assertMatch(String(c.comp?.id), /^[0-9a-f-]{36}$/)
  assertThrows(() =>
    spawnChanges(all, { task: 'T-99', provider: 'x', model: 'y' })
  )
  // an id that is not a TASK is refused — a spawn needs work to do
  assertThrows(() =>
    spawnChanges(all, { task: 'S-1', provider: 'x', model: 'y' })
  )
  assertThrows(() =>
    spawnChanges(all, {
      task: 'T-3',
      provider: 'x',
      model: 'y',
      persona: 'nope',
    })
  )
})

Deno.test("spawnChanges: the actor chain — owner, then the task's project, then the caller", () => {
  let J = 'aaaaaaaa-0000-4000-8000-000000000021' // person
  let O = 'aaaaaaaa-0000-4000-8000-000000000022' // operator project
  let P = 'aaaaaaaa-0000-4000-8000-000000000023' // persona O contains
  let Q = 'aaaaaaaa-0000-4000-8000-000000000024' // persona about O
  let R = 'aaaaaaaa-0000-4000-8000-000000000025' // unowned persona
  let W = 'aaaaaaaa-0000-4000-8000-000000000026' // caller session
  let T = 'aaaaaaaa-0000-4000-8000-000000000027' // projectless task
  let V = 'aaaaaaaa-0000-4000-8000-000000000028' // another project
  let U = 'aaaaaaaa-0000-4000-8000-000000000029' // task of V
  let g: Snapshot = {
    changes: [
      { eid: J, name: 'entity', comp: { eid: J, num: 21, created_at: '' } },
      { eid: J, name: 'doc', comp: { title: 'Jeff', body: '' } },
      { eid: J, name: 'person', comp: {} },
      { eid: O, name: 'entity', comp: { eid: O, num: 22, created_at: '' } },
      { eid: O, name: 'doc', comp: { title: 'Ops', body: '' } },
      { eid: O, name: 'project', comp: {} },
      { eid: P, name: 'entity', comp: { eid: P, num: 23, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Envoy', body: '' } },
      { eid: Q, name: 'entity', comp: { eid: Q, num: 24, created_at: '' } },
      { eid: Q, name: 'doc', comp: { title: 'Herald', body: '' } },
      { eid: R, name: 'entity', comp: { eid: R, num: 25, created_at: '' } },
      { eid: R, name: 'doc', comp: { title: 'Drifter', body: '' } },
      { eid: W, name: 'entity', comp: { eid: W, num: 26, created_at: '' } },
      { eid: W, name: 'session', comp: { id: 'sess-w', actor_eid: J } },
      { eid: T, name: 'entity', comp: { eid: T, num: 27, created_at: '' } },
      { eid: T, name: 'doc', comp: { title: 'work', body: '' } },
      { eid: T, name: 'task', comp: { status: 'open', priority: 0 } },
      { eid: V, name: 'entity', comp: { eid: V, num: 28, created_at: '' } },
      { eid: V, name: 'doc', comp: { title: 'Video', body: '' } },
      { eid: V, name: 'project', comp: {} },
      { eid: U, name: 'entity', comp: { eid: U, num: 29, created_at: '' } },
      { eid: U, name: 'doc', comp: { title: 'cut', body: '' } },
      {
        eid: U,
        name: 'task',
        comp: {
          status: 'open',
          priority: 0,
          project_eid: V,
        },
      },
    ],
    deps: [
      { parent: O, type: 'contains', child: P },
      { parent: Q, type: 'about', child: O },
    ],
  }
  let world = rows(g)
  let spawn = (o: Record<string, unknown> = {}) =>
    spawnChanges(world, {
      task: 'T-27',
      provider: 'x',
      model: 'y',
      by: 'sess-w',
      deps: g.deps,
      ...o,
    }).changes[0].comp
  // a projectless task: the child works for whoever the caller works for
  assertEquals(spawn()?.actor_eid, J)
  // a persona owned by an operator: the spawn acts AS the operator,
  // whichever way the ownership edge is spelled
  assertEquals(spawn({ persona: P })?.actor_eid, O)
  assertEquals(spawn({ persona: Q })?.actor_eid, O)
  // an unowned persona changes nothing — inheritance still holds
  assertEquals(spawn({ persona: R })?.actor_eid, J)
  // a task WITH a project: the run acts for the project, not the person
  // who pressed spawn (T-7081) — a persona's owner still outranks it
  assertEquals(spawn({ task: 'T-29' })?.actor_eid, V)
  assertEquals(spawn({ task: 'T-29', persona: P })?.actor_eid, O)
  // no caller, no owner, no project: the spawn stays unattributed
  assertEquals('actor_eid' in (spawn({ by: undefined }) ?? {}), false)
})

Deno.test('hookClaim: an unclaimed task claims, anything else is quiet', () => {
  assertEquals(hookClaim(all, 'T-3', 'sess-x', '/w'), [
    { eid: T2, name: 'claim', comp: { session_eid: S } },
  ])
  assertEquals(hookClaim(all, 'T-2', 'sess-x'), []) // already held
  assertEquals(hookClaim(all, 'T-99', 'sess-x'), []) // no such task
  assertEquals(hookClaim(all, undefined, 'sess-x'), []) // no TASKS_TASK
})

Deno.test('commentChanges: doc + aim, session reified for server stamping', () => {
  let cs = commentChanges(all, T1, 'hi', 'sess-x')
  assertEquals(cs.length, 2)
  assertEquals(cs[1].comp, { target_eid: T1 })
  assertEquals(commentChanges(all, T1, 'hi')[1].comp, { target_eid: T1 })
  let review = commentChanges(all, T1, '', 'sess-x', {
    verdict: 'approved',
  })
  assertEquals(review.slice(-2), [
    { eid: review[0].eid, name: 'comment', comp: { target_eid: T1 } },
    { eid: review[0].eid, name: 'review', comp: { verdict: 'approved' } },
  ])
})

Deno.test('task interaction anchors a tool-only session to the project', () => {
  let project = 'aaaaaaaa-0000-4000-8000-000000000004'
  let g = rows({
    changes: [
      ...snap.changes,
      { eid: project, name: 'project', comp: {} },
      { eid: T2, name: 'task', comp: { project_eid: project } },
    ],
  })
  let actor = { eid: S, name: 'session', comp: { actor_eid: project } }
  assertEquals(claimChanges(g, T2, 'sess-x'), [
    actor,
    { eid: T2, name: 'claim', comp: { session_eid: S } },
  ])
  assertEquals(commentChanges(g, T2, 'project words', 'sess-x')[0], actor)
})

Deno.test('claimant resolves through the session entity', () => {
  assertEquals(claimant(all, by(T1)), 'sess-x')
  assertEquals(claimant(all, by(T2)), undefined)
})

Deno.test('wrapChanges: unfinished gets the trail, done goes quiet', () => {
  let cs = wrapChanges(all, 'sess-x') // T1 is wip → comment + release
  assertEquals(cs.filter((c) => c.name == 'claim').length, 1)
  assertEquals(cs.filter((c) => c.name == 'comment').length, 1)
  assertEquals(
    cs.find((c) => c.name == 'doc')?.comp?.body,
    '⚑ lease lapsed: session S-1 ended before this was done',
  )
  assertEquals(cs.find((c) => c.name == 'comment')?.comp, { target_eid: T1 })
  let done = structuredClone(snap)
  done.changes.find((c) => c.eid == T1 && c.name == 'task')!.comp!.status =
    'done'
  let quiet = wrapChanges(rows(done), 'sess-x')
  // finished work releases without a comment — only the brief rides along
  // (fixture S is docless and held a claim, so it earns the stub)
  assertEquals(quiet.filter((c) => c.name == 'comment'), [])
  assertEquals(quiet[0], { eid: T1, name: 'claim', comp: null })
  assertEquals(wrapChanges(all, 'sess-unknown'), [])
})

Deno.test('wrap brief: a docless working session gets the stub', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = wrapChanges(all, 'sess-x', AT)
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(doc?.comp?.title, 'Work session 2026-07-20')
  assertMatch(String(doc?.comp?.body), /- T-2 \(wip\) First/)
  // a session that already wrote its brief keeps it
  let named = structuredClone(snap)
  named.changes.push({
    eid: S,
    name: 'doc',
    comp: { title: 'Mine', body: 'my own words' },
  })
  assertEquals(
    wrapChanges(rows(named), 'sess-x', AT)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
  // an idle session — no claims, no comments — leaves nothing behind
  let idle = structuredClone(snap)
  idle.changes = idle.changes.filter((c) => c.name != 'claim')
  assertEquals(wrapChanges(rows(idle), 'sess-x', AT), [])
})

Deno.test('wrap brief: the final message IS the brief when captured', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = wrapChanges(all, 'sess-x', AT, [], 'Shipped the thing.\n\nNext: x')
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(doc?.comp?.body, 'Shipped the thing.\n\nNext: x')
  assertEquals(doc?.comp?.title, 'Work session 2026-07-20')
  // a hand-written doc outranks the captured final message
  let named = structuredClone(snap)
  named.changes.push({
    eid: S,
    name: 'doc',
    comp: { title: 'Mine', body: 'my own words' },
  })
  assertEquals(
    wrapChanges(rows(named), 'sess-x', AT, [], 'captured')
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
  // an idle session's final message is not worth a brief
  let idle = structuredClone(snap)
  idle.changes = idle.changes.filter((c) => c.name != 'claim')
  assertEquals(wrapChanges(rows(idle), 'sess-x', AT, [], 'captured'), [])
})

Deno.test('spawnDefaults: the caller session lends its provider/model', () => {
  let mine = structuredClone(snap)
  mine.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    provider: 'claude',
    model: 'claude-opus-4-8',
  }
  assertEquals(spawnDefaults(rows(mine), 'sess-x'), {
    provider: 'claude',
    model: 'claude-opus-4-8',
  })
  // a row with neither, an unknown session, no session: all default to none
  let none = { provider: undefined, model: undefined }
  assertEquals(spawnDefaults(all, 'sess-x'), none)
  assertEquals(spawnDefaults(all, 'sess-unknown'), none)
  assertEquals(spawnDefaults(all), none)
})

Deno.test('contextDigest: claimed set with gates, or open board', () => {
  let d = contextDigest(snap, 'sess-x')
  assertEquals(d.split('\n').length <= 20, true)
  assertEquals(d.includes('T-2'), true)
  assertEquals(d.includes('  - requires → T-3 (open)'), true)
  let fresh = contextDigest(snap, 'sess-nobody')
  assertEquals(fresh.includes('nothing claimed'), true)
  assertEquals(fresh.includes('T-3'), true) // open unclaimed work suggested
  // the shared fixture carries no modified_at — nothing is recent, so the
  // lately tier says nothing at all
  assertEquals(d.includes('## lately'), false)
})

Deno.test('contextDigest: a non-operator remains a normal graph participant', () => {
  let target = structuredClone(snap)
  target.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    operator: 0,
    origin: 'external',
  }
  let out = contextDigest(target, 'sess-x')
  assertEquals(out.includes('T-2'), true)
  assertEquals(out.includes('claim:'), true)
  assertEquals(out.includes('observation-only'), false)
})

// The digest's frontmatter lead (T-4554): a reified session's own meta —
// S-num first, so an agent can address its own session doc. Only what's
// known prints; an unknown sid prints nothing at all.
Deno.test('sessionMeta: the YAML lead — known fields only, or nothing', () => {
  let S2 = 'aaaaaaaa-0000-4000-8000-000000000021'
  let PN = 'aaaaaaaa-0000-4000-8000-000000000022'
  let g = rows({
    changes: [
      { eid: S2, name: 'entity', comp: { eid: S2, num: 21, created_at: '' } },
      {
        eid: S2,
        name: 'session',
        comp: {
          id: 'sess-m',
          cwd: '/w',
          provider: 'claude',
          model: 'claude-opus-4-8',
          effort: 'high',
          persona_eid: PN,
        },
      },
      { eid: PN, name: 'entity', comp: { eid: PN, num: 22, created_at: '' } },
      { eid: PN, name: 'doc', comp: { title: 'Scribe', body: '' } },
      { eid: PN, name: 'persona', comp: {} },
    ],
  })
  assertEquals(
    sessionMeta(g, 'sess-m'),
    [
      '---',
      'session: S-21',
      'sid: sess-m',
      'provider: claude',
      'model: claude-opus-4-8',
      'effort: high',
      'cwd: /w',
      'persona: N-22 Scribe',
      '---',
    ].join('\n'),
  )
  // the shared fixture's session carries only id + cwd — no empty lines ride
  assertEquals(
    sessionMeta(all, 'sess-x'),
    '---\nsession: S-1\nsid: sess-x\ncwd: /w\n---',
  )
  assertEquals(sessionMeta(all, 'sess-nobody'), '')
})

// taskBlock renders one task the way the digest's "claimed by you" does —
// the task line plus its unresolved gates. Extracted so the subagent hook
// shares the exact renderer.
Deno.test('taskBlock: task line + unresolved gate, who holds it', () => {
  let b = taskBlock(all, snap.deps, by(T1))
  assertEquals(b[0], '- T-2 wip — First')
  assertEquals(b[1], '  - requires → T-3 (open)')
  assertEquals(b.length, 2)
})

// Read state derives, never stored: arrived-and-unmarked is unread,
// outbound never counts, and the digest says the count in one line —
// scoped to mail aimed at the project, all of it when unscoped.
Deno.test('unreadMail + digest: unread counts, read/outbound stay quiet', () => {
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000021' // inbound, unread
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000022' // inbound, read
  let M3 = 'aaaaaaaa-0000-4000-8000-000000000023' // outbound
  let P = 'aaaaaaaa-0000-4000-8000-000000000024' // a project scope
  let M4 = 'aaaaaaaa-0000-4000-8000-000000000025' // inbound, to ME
  let A = 'aaaaaaaa-0000-4000-8000-000000000026' // the actor sess-x acts for
  let mk = (eid: string, num: number, mail: Record<string, unknown>) => [
    { eid, name: 'entity', comp: { eid, num, created_at: '' } },
    { eid, name: 'doc', comp: { title: `mail ${num}`, body: '' } },
    { eid, name: 'mail', comp: mail },
  ]
  let g: Snapshot = {
    changes: [
      ...snap.changes,
      {
        eid: S,
        name: 'session',
        comp: { id: 'sess-x', cwd: '/w', operator: 1, actor_eid: A },
      },
      { eid: A, name: 'entity', comp: { eid: A, num: 26, created_at: '' } },
      { eid: A, name: 'doc', comp: { title: 'Operator', body: '' } },
      { eid: A, name: 'email', comp: { address: 'me@x.test' } },
      { eid: P, name: 'entity', comp: { eid: P, num: 24, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Venture', body: '' } },
      { eid: P, name: 'project', comp: {} },
      ...mk(M1, 21, {
        to: 'v@x.test',
        message_id: 'msg:1:<a@x>',
        target_eid: P,
      }),
      ...mk(M2, 22, {
        to: 'v@x.test',
        message_id: 'msg:2:<b@x>',
        target_eid: P,
      }),
      // read-state now rides the `opened` stamp (T-7006), not mail.read_at
      { eid: M2, name: 'opened', comp: { at: '2026-07-22T00:00:00Z' } },
      ...mk(M3, 23, { to: 'them@y.test' }),
      // addressed to ME by address, ABOUT some other entity — the case
      // the old target_eid-only screen dropped on the floor
      ...mk(M4, 25, {
        to: 'me@x.test',
        message_id: 'msg:4:<d@x>',
        target_eid: T2,
      }),
    ],
    deps: snap.deps,
  }
  let all = rows(g)
  let is = (eid: string) => unreadMail(all.find((r) => r.eid == eid)!)
  assertEquals(is(M1), true)
  assertEquals(is(M2), false) // read
  assertEquals(is(M3), false) // outbound is born read
  // `task mail` is a SLICE of the inbox, never a second screen: unread
  // inbound, kept only if the inbox would have shown it anyway
  let mailOnly = (scope?: string) =>
    all.filter((r) =>
      unreadMail(r) && inboxItem(readerFor(all, 'sess-x', '/w', scope))(r)
    ).map((r) => r.eid)
  assertEquals(mailOnly(P), [M1, M4])
  assertEquals(mailOnly(T2), [M4])
  assertEquals(mailOnly(), [M4]) // scopeless: only what my address holds
  // the digest counts with the INBOX's predicate — addressed to me — so
  // the number and `task inbox` cannot disagree. Standing in the venture,
  // that is its mail PLUS the letter to my own address, whatever it's about
  assertMatch(
    contextDigest(g, 'sess-x', Date.now(), P),
    /## inbox — 2 unread \(task inbox\)/,
  )
  // scopeless, I am still an address: the letter to me survives, the
  // venture's does not — an unscoped session never saw the fleet's pile
  assertMatch(contextDigest(g, 'sess-x'), /## inbox — 1 unread/)
  // nothing addressed, nothing said
  assertEquals(contextDigest(snap, 'sess-x').includes('## inbox'), false)
})

// The inbox generalizes the mail predicates over every addressed-to-me
// source (T-7006): comment→session, comment→claimed, comment→actor,
// knock→actor, mail→project. Membership is NOT archived; unread is NOT opened. Only
// `archived` hides — the inbox is drain-proof.
Deno.test('inbox: every source, archived hides, opened marks read', () => {
  let Sx = 'aaaaaaaa-0000-4000-8000-000000000101' // my session
  let A = 'aaaaaaaa-0000-4000-8000-000000000102' //  my actor
  let P = 'aaaaaaaa-0000-4000-8000-000000000103' //  my project
  let TC = 'aaaaaaaa-0000-4000-8000-000000000104' // a task I claim
  let c1 = 'aaaaaaaa-0000-4000-8000-000000000111' // comment → session
  let c2 = 'aaaaaaaa-0000-4000-8000-000000000112' // comment → claimed task
  let kn = 'aaaaaaaa-0000-4000-8000-000000000113' // knock → actor
  let ml = 'aaaaaaaa-0000-4000-8000-000000000114' // mail → project (arrived)
  let cAc = 'aaaaaaaa-0000-4000-8000-000000000119' // comment → my actor
  let cO = 'aaaaaaaa-0000-4000-8000-000000000115' // comment aimed elsewhere
  let cA = 'aaaaaaaa-0000-4000-8000-000000000116' // to session, archived
  let cR = 'aaaaaaaa-0000-4000-8000-000000000117' // to session, opened
  let cN = 'aaaaaaaa-0000-4000-8000-000000000118' // to session, notified only
  let g = rows({
    changes: [
      { eid: Sx, name: 'entity', comp: { eid: Sx, num: 101, created_at: '' } },
      {
        eid: Sx,
        name: 'session',
        comp: { id: 'me', actor_eid: A, cwd: '/w', operator: 1 },
      },
      { eid: P, name: 'entity', comp: { eid: P, num: 103, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: TC, name: 'entity', comp: { eid: TC, num: 104, created_at: '' } },
      { eid: TC, name: 'task', comp: { status: 'open' } },
      { eid: TC, name: 'claim', comp: { session_eid: Sx } },
      { eid: c1, name: 'comment', comp: { target_eid: Sx } },
      { eid: c2, name: 'comment', comp: { target_eid: TC } },
      { eid: kn, name: 'knock', comp: { to_eid: A, target_eid: TC } },
      {
        eid: ml,
        name: 'mail',
        comp: { to: 'm@x', message_id: 'm:1', target_eid: P },
      },
      { eid: cAc, name: 'comment', comp: { target_eid: A } }, // said to the venture
      { eid: cO, name: 'comment', comp: { target_eid: P } }, // not addressed to me
      { eid: cA, name: 'comment', comp: { target_eid: Sx } },
      { eid: cA, name: 'archived', comp: { at: 'now' } },
      { eid: cR, name: 'comment', comp: { target_eid: Sx } },
      { eid: cR, name: 'opened', comp: { at: 'now' } },
      { eid: cN, name: 'comment', comp: { target_eid: Sx } },
      { eid: cN, name: 'notified', comp: { at: 'now' } }, // told, not dealt with
    ],
  })
  let who = readerFor(g, 'me', '/w', P)
  assertEquals(who, {
    session: Sx,
    actor: A,
    scope: P,
    operator: true,
    claims: new Set([TC]),
    addrs: new Set([A]), // the actor's own eid; it carries no address here
    watching: new Set<string>(), // no standing instruction either way
    muting: new Set<string>(),
  })
  // all four sources arrive; a comment aimed elsewhere and an archived one
  // don't. `notified` (cN) does NOT hide — being told keeps it in the inbox.
  let inbox = g.filter(inboxItem(who)).map((r) => r.eid).sort()
  assertEquals(inbox, [c1, c2, cAc, kn, ml, cR, cN].sort())
  // unread within: the opened one counts as read; a `notified`-only item is
  // still unread (told != opened); the rest are unread
  let unread = g.filter(inboxItem(who)).filter(isUnread).map((r) => r.eid)
    .sort()
  assertEquals(unread, [c1, c2, cAc, kn, ml, cN].sort())
})

// A person reads a browser inbox with no session and no project to stand
// in. The arm that finds their letters is their ADDRESS — and the arm that
// must not fire is the project one, or an unscoped reader matches every
// arrived letter in the graph (1338 of them in a week, live).
Deno.test("readerAt: a person hears their own letters, not the fleet's", () => {
  let ME = 'bbbbbbbb-0000-4000-8000-000000000201' // a person, addressed
  let VENTURE = 'bbbbbbbb-0000-4000-8000-000000000202' // someone else's
  let mine = 'bbbbbbbb-0000-4000-8000-000000000211' // to me@x, arrived
  let byEid = 'bbbbbbbb-0000-4000-8000-000000000212' // to my EID, arrived
  let theirs = 'bbbbbbbb-0000-4000-8000-000000000213' // to the venture
  let sent = 'bbbbbbbb-0000-4000-8000-000000000214' // to me, never arrived
  let kn = 'bbbbbbbb-0000-4000-8000-000000000215' // knock at me
  let said = 'bbbbbbbb-0000-4000-8000-000000000216' // comment at me
  let g = rows({
    changes: [
      { eid: ME, name: 'entity', comp: { eid: ME, num: 201, created_at: '' } },
      { eid: ME, name: 'person', comp: {} },
      { eid: ME, name: 'email', comp: { address: 'me@x' } },
      {
        eid: VENTURE,
        name: 'entity',
        comp: { eid: VENTURE, num: 202, created_at: '' },
      },
      { eid: VENTURE, name: 'project', comp: {} },
      {
        eid: mine,
        name: 'mail',
        comp: { to: 'me@x', to_addr: 'me@x', message_id: 'm:1' },
      },
      { eid: byEid, name: 'mail', comp: { to: ME, message_id: 'm:2' } },
      {
        eid: theirs,
        name: 'mail',
        comp: { to: 'v@x', message_id: 'm:3', target_eid: VENTURE },
      },
      { eid: sent, name: 'mail', comp: { to: 'me@x', to_addr: 'me@x' } },
      { eid: kn, name: 'knock', comp: { to_eid: ME, target_eid: VENTURE } },
      { eid: said, name: 'comment', comp: { target_eid: ME } },
    ],
  })
  let who = readerAt(g, ME)
  assertEquals(who.operator, true) // browsing your own graph IS the loop
  assertEquals(who.scope, undefined) // a person stands in no project
  let inbox = g.filter(inboxItem(who)).map((r) => r.eid).sort()
  // Sent mail never arrived, and the venture's letter is not this person's
  // — that exclusion is the whole point of the address arm.
  assertEquals(inbox, [mine, byEid, kn, said].sort())
})

// The same constructor pointed at a PROJECT: it stands in itself, so the
// scope arm is the one that speaks and project mail lands.
Deno.test('readerAt: a project reads its own project mail', () => {
  let P2 = 'bbbbbbbb-0000-4000-8000-000000000221'
  let ml = 'bbbbbbbb-0000-4000-8000-000000000222'
  let g = rows({
    changes: [
      { eid: P2, name: 'entity', comp: { eid: P2, num: 221, created_at: '' } },
      { eid: P2, name: 'project', comp: {} },
      {
        eid: ml,
        name: 'mail',
        comp: { to: 'p@x', message_id: 'm:9', target_eid: P2 },
      },
    ],
  })
  let who = readerAt(g, P2)
  assertEquals(who.scope, P2)
  assertEquals(g.filter(inboxItem(who)).map((r) => r.eid), [ml])
})

// A letter to the session itself is DIRECT address, so it lands whatever
// loop the reader runs — the rule comments and knocks already follow.
// Sessions are addressable by id (`S-31@bot.yak.sh`), and gating this on
// `operator` would resolve the address perfectly and then tell nobody.
Deno.test('addressed: a letter to my session reaches me without operator', () => {
  let S = 'bbbbbbbb-0000-4000-8000-000000000331'
  let mine = 'bbbbbbbb-0000-4000-8000-000000000332'
  let theirs = 'bbbbbbbb-0000-4000-8000-000000000333'
  let P3 = 'bbbbbbbb-0000-4000-8000-000000000334'
  let g = rows({
    changes: [
      {
        eid: mine,
        name: 'mail',
        comp: { to: 'S-31@bot.yak.sh', message_id: 'm:31', target_eid: S },
      },
      // Project mail stays operator-only — this arm is unchanged.
      {
        eid: theirs,
        name: 'mail',
        comp: { to: 'p@x', message_id: 'm:32', target_eid: P3 },
      },
    ],
  })
  let who = { session: S, scope: P3, operator: false }
  assertEquals(g.filter(inboxItem(who)).map((r) => r.eid), [mine])
  // An operator in the same seat gets both, so nothing was traded away.
  let boss = { session: S, scope: P3, operator: true }
  assertEquals(
    g.filter(inboxItem(boss)).map((r) => r.eid).sort(),
    [
      mine,
      theirs,
    ].sort(),
  )
})

// A letter still going OUT is not an arrival, whoever it names.
Deno.test('addressed: an unsent letter to my session is not in my inbox', () => {
  let S = 'bbbbbbbb-0000-4000-8000-000000000341'
  let out = 'bbbbbbbb-0000-4000-8000-000000000342'
  let g = rows({
    changes: [{ eid: out, name: 'mail', comp: { to: 'x', target_eid: S } }],
  })
  assertEquals(g.filter(inboxItem({ session: S, operator: false })).length, 0)
})

// Project-wide attention is a positive capability. No session means a
// deliberate preview, but an unmarked session is an ordinary participant.
Deno.test('isOperator: only an explicit eligible session is an operator', () => {
  assertEquals(isOperator(undefined), true) // no session → preview
  assertEquals(isOperator({}), false)
  assertEquals(isOperator({ origin: 'external' }), false)
  assertEquals(isOperator({ origin: 'external', operator: false }), false)
  assertEquals(isOperator({ origin: 'external', operator: true }), true)
  assertEquals(isOperator({ origin: 'managed', operator: true }), false)
  assertEquals(
    isOperator({ origin: 'managed', operator: true, role_eid: 'R' }),
    true,
  )
  assertEquals(
    isOperator({ requested_task_eid: 'T', operator: true }),
    false,
  )
})

Deno.test('project mail reaches the operator, not a specialist; direct address always', () => {
  let Op = 'aaaaaaaa-0000-4000-8000-000000000201' // operator session
  let Sp = 'aaaaaaaa-0000-4000-8000-000000000202' // specialist (managed)
  let P = 'aaaaaaaa-0000-4000-8000-000000000203' //  the project
  let ml = 'aaaaaaaa-0000-4000-8000-000000000204' // mail → project (arrived)
  let cm = 'aaaaaaaa-0000-4000-8000-000000000205' // comment → specialist itself
  let ka = 'aaaaaaaa-0000-4000-8000-000000000206' // knock → project actor
  let kd = 'aaaaaaaa-0000-4000-8000-000000000207' // knock → specialist
  let g = rows({
    changes: [
      { eid: Op, name: 'entity', comp: { eid: Op, num: 201, created_at: '' } },
      {
        eid: Op,
        name: 'session',
        comp: { id: 'op', actor_eid: P, cwd: '/w', operator: 1 },
      },
      { eid: Sp, name: 'entity', comp: { eid: Sp, num: 202, created_at: '' } },
      {
        eid: Sp,
        name: 'session',
        // a managed spawn: origin stamped, started on a task
        comp: {
          id: 'sp',
          actor_eid: P,
          cwd: '/w',
          origin: 'managed',
          requested_task_eid: 'aaaaaaaa-0000-4000-8000-000000000299',
        },
      },
      { eid: P, name: 'entity', comp: { eid: P, num: 203, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      {
        eid: ml,
        name: 'mail',
        comp: { to: 'm@x', message_id: 'm:1', target_eid: P },
      },
      { eid: cm, name: 'comment', comp: { target_eid: Sp } }, // aimed at the specialist
      { eid: ka, name: 'knock', comp: { to_eid: P } },
      { eid: kd, name: 'knock', comp: { to_eid: Sp } },
    ],
  })
  let inbox = (id: string) =>
    g.filter(inboxItem(readerFor(g, id, '/w', P))).map((r) => r.eid).sort()
  // the operator gets the project's mail; the specialist does not
  assertEquals(inbox('op'), [ka, ml].sort())
  // the specialist still gets the comment aimed at its OWN session — direct
  // address is always delivered, only project mail is gated
  assertEquals(inbox('sp'), [cm, kd].sort())
  // the mail-only door is that same predicate sliced, so the gate holds
  // there too: the specialist sees no project mail, the operator does
  let mailOnly = (id: string) =>
    g.filter((r) => unreadMail(r) && inboxItem(readerFor(g, id, '/w', P))(r))
      .map((r) => r.eid)
  assertEquals(mailOnly('sp'), [])
  assertEquals(mailOnly('op'), [ml])
})

// A standing instruction overrides the addressed-to default, on what the
// item is ABOUT. Three branches, and the one that matters most is mute
// beating direct address — a thread the operator has declared finished.
Deno.test('watch adds, mute subtracts, absent leaves addressed() alone', () => {
  let A = 'aaaaaaaa-0000-4000-8000-000000000201' // the actor
  let Sx = 'aaaaaaaa-0000-4000-8000-000000000202' // its session
  let far = 'aaaaaaaa-0000-4000-8000-000000000203' // a task nothing aims at me
  let mine = 'aaaaaaaa-0000-4000-8000-000000000204' // a task I claim
  let cFar = 'aaaaaaaa-0000-4000-8000-000000000205'
  let cMine = 'aaaaaaaa-0000-4000-8000-000000000206'
  let cDirect = 'aaaaaaaa-0000-4000-8000-000000000207' // said to my session
  let sub = 'aaaaaaaa-0000-4000-8000-000000000208'
  let base: Change[] = [
    { eid: A, name: 'doc', comp: { title: 'Operator' } },
    { eid: A, name: 'project', comp: {} },
    { eid: Sx, name: 'session', comp: { id: 'me', operator: 1, actor_eid: A } },
    { eid: far, name: 'task', comp: { status: 'open', priority: 0 } },
    { eid: mine, name: 'task', comp: { status: 'open', priority: 0 } },
    { eid: mine, name: 'claim', comp: { session_eid: Sx } },
    { eid: cFar, name: 'comment', comp: { target_eid: far } },
    { eid: cMine, name: 'comment', comp: { target_eid: mine } },
    { eid: cDirect, name: 'comment', comp: { target_eid: Sx } },
  ]
  let seen = (extra: Change[]) => {
    let g = rows({ changes: [...base, ...extra] })
    return g.filter(inboxItem(readerFor(g, 'me', '/w', A))).map((r) => r.eid)
      .sort()
  }
  // absent: today's rule, unchanged — the far task's comment is nobody's
  assertEquals(seen([]), [cMine, cDirect].sort())
  // watch: the far one arrives although nothing was aimed at me
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor_eid: A, target_eid: far, mode: 'watch' },
    }]),
    [cFar, cMine, cDirect].sort(),
  )
  // mute: a task I CLAIM goes quiet — the instruction beats the default
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor_eid: A, target_eid: mine, mode: 'mute' },
    }]),
    [cDirect],
  )
  // and mute beats DIRECT address too: my own session, silenced
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor_eid: A, target_eid: Sx, mode: 'mute' },
    }]),
    [cMine],
  )
  // another actor's instruction is not mine
  assertEquals(
    seen([{
      eid: sub,
      name: 'subscription',
      comp: { actor_eid: far, target_eid: mine, mode: 'mute' },
    }]),
    [cMine, cDirect].sort(),
  )
})

// Saying it twice is idempotent and changing your mind is a change, not a
// second opinion — both fall out of reusing the existing row's eid.
Deno.test('subChanges: one row per (actor, target), --gone removes it', () => {
  let A = 'aaaaaaaa-0000-4000-8000-000000000301'
  let T = 'aaaaaaaa-0000-4000-8000-000000000302'
  let sub = 'aaaaaaaa-0000-4000-8000-000000000303'
  let none = rows({ changes: [] })
  let first = subChanges(none, A, T, 'watch')
  assertEquals(first.length, 1)
  assertEquals(first[0].comp, { actor_eid: A, target_eid: T, mode: 'watch' })
  let had = rows({
    changes: [{
      eid: sub,
      name: 'subscription',
      comp: { actor_eid: A, target_eid: T, mode: 'watch' },
    }],
  })
  assertEquals(subChanges(had, A, T, 'mute')[0].eid, sub) // the same row
  assertEquals(subChanges(had, A, T, null), [
    { eid: sub, name: 'entity', comp: null },
  ])
  assertEquals(subChanges(none, A, T, null), []) // nothing to undo
})

Deno.test('sessionFor: hook identity round-trips and refreshes only on change', () => {
  let self = {
    agent_type: 'reviewer',
    source: 'startup',
    operator: false,
    pane: '%42',
    turn: 'idle',
    role_eid: 'role',
  }
  let minted = sessionFor(all, 'sess-new', '/w2', 4242, self)
  assertEquals(minted.changes[0].comp, {
    id: 'sess-new',
    cwd: '/w2',
    pid: 4242,
    agent_type: 'reviewer',
    source: 'startup',
    turn: 'idle',
    pane: '%42',
    operator: 0,
    role_eid: 'role',
  })
  // a known session already wearing the same agent_type is silent for it;
  // only the still-absent source patches.
  let g = rows({
    changes: [
      { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
      {
        eid: S,
        name: 'session',
        comp: {
          id: 'sess-x',
          cwd: '/w',
          agent_type: 'reviewer',
          pane: '%42',
          turn: 'idle',
          operator: false,
          role_eid: 'role',
        },
      },
    ],
  })
  assertEquals(sessionFor(g, 'sess-x', '/w', undefined, self).changes, [
    { eid: S, name: 'session', comp: { source: 'startup' } },
  ])
  assertEquals(
    sessionFor(g, 'sess-x', '/w', undefined, { pane: null }).changes,
    [{ eid: S, name: 'session', comp: { pane: null } }],
  )
})

// One derivation for every caller-aware door: the repo whose path
// prefixes the cwd is the project you stand in.
Deno.test('repoAt: path prefix names the project you stand in', () => {
  let R = 'aaaaaaaa-0000-4000-8000-000000000031'
  let g = rows({
    changes: [
      { eid: R, name: 'entity', comp: { eid: R, num: 31, created_at: '' } },
      { eid: R, name: 'repo', comp: { path: '/code/app' } },
    ],
  })
  assertEquals(repoAt(g, '/code/app/deep/dir')?.eid, R)
  assertEquals(repoAt(g, '/elsewhere'), undefined)
  assertEquals(repoAt(g), undefined)
})

Deno.test('repoAt: the fleet worktree path names its main repo', () => {
  let R = 'aaaaaaaa-0000-4000-8000-000000000034'
  let g = rows({
    changes: [
      { eid: R, name: 'entity', comp: { eid: R, num: 34, created_at: '' } },
      { eid: R, name: 'repo', comp: { path: '/code/tasks' } },
    ],
  })
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/S-42')?.eid, R)
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/S-42/src')?.eid, R)
  assertEquals(repoAt(g, '/home/me/tasks-worktrees/tasks/S-42')?.eid, R)
  assertEquals(repoAt(g, '/home/me/tasks-worktrees/tasks/S-42/src')?.eid, R)
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/tasks/'), undefined)
  assertEquals(repoAt(g, '/code/tasksmith'), undefined)
})

// Nested repos: the LONGEST path prefix wins, so an inner repo claims a cwd
// under it rather than the outer one that also prefixes it.
Deno.test('repoAt: longest prefix wins for nested repos', () => {
  let out = 'aaaaaaaa-0000-4000-8000-000000000032'
  let inn = 'aaaaaaaa-0000-4000-8000-000000000033'
  let g = rows({
    changes: [
      { eid: out, name: 'entity', comp: { eid: out, num: 32, created_at: '' } },
      { eid: out, name: 'repo', comp: { path: '/code' } },
      { eid: inn, name: 'entity', comp: { eid: inn, num: 33, created_at: '' } },
      { eid: inn, name: 'repo', comp: { path: '/code/app' } },
    ],
  })
  assertEquals(repoAt(g, '/code/app/x')?.eid, inn)
  assertEquals(repoAt(g, '/code/other')?.eid, out)
})

Deno.test('repoAt: an ambiguous worktree basename stays unplaced', () => {
  let one = 'aaaaaaaa-0000-4000-8000-000000000035'
  let two = 'aaaaaaaa-0000-4000-8000-000000000036'
  let g = rows({
    changes: [
      { eid: one, name: 'entity', comp: { eid: one, num: 35, created_at: '' } },
      { eid: one, name: 'repo', comp: { path: '/code/one/app' } },
      { eid: two, name: 'entity', comp: { eid: two, num: 36, created_at: '' } },
      { eid: two, name: 'repo', comp: { path: '/code/two/app' } },
    ],
  })
  assertEquals(repoAt(g, '/home/me/.tasks/worktrees/app/S-42'), undefined)
})

// One resolution for every caller-aware door, in falling priority: an
// explicit arg, the cwd's repo (longest prefix), the worn persona's home,
// the actor when it stands for a project, else undefined.
Deno.test('scopeFor: arg > cwd-repo > persona-home > actor-project > none', () => {
  let id = (n: number) =>
    `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, Q, R, PER, SESS] = [1, 2, 3, 4, 5].map(id)
  let g = rows({
    changes: [
      { eid: P, name: 'entity', comp: { eid: P, num: 1, created_at: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: P, name: 'repo', comp: { path: '/code/p' } },
      { eid: Q, name: 'entity', comp: { eid: Q, num: 2, created_at: '' } },
      { eid: Q, name: 'project', comp: {} }, // persona's home
      { eid: R, name: 'entity', comp: { eid: R, num: 3, created_at: '' } },
      { eid: R, name: 'project', comp: {} }, // the actor, standing for a project
      { eid: PER, name: 'entity', comp: { eid: PER, num: 4, created_at: '' } },
      { eid: PER, name: 'persona', comp: { home_eid: Q } },
      {
        eid: SESS,
        name: 'entity',
        comp: { eid: SESS, num: 5, created_at: '' },
      },
      {
        eid: SESS,
        name: 'session',
        comp: { id: 's', persona_eid: PER, actor_eid: R },
      },
    ],
  })
  let sess = g.find((r) => r.eid == SESS)
  // arg wins over everything the session could resolve
  assertEquals(scopeFor(g, sess, '/code/p/deep', 'ARG'), 'ARG')
  // no arg: the cwd's repo (P), longest-prefix
  assertEquals(scopeFor(g, sess, '/code/p/deep'), P)
  // the fleet worktree layout names the same repo
  assertEquals(scopeFor(g, sess, '/home/me/.tasks/worktrees/p/S-42'), P)
  // cwd places nothing: the worn persona's home (Q)
  assertEquals(scopeFor(g, sess, '/nowhere'), Q)
  // no persona: the actor, since it IS a project (R)
  let noPer = { ...sess!, comps: { session: { id: 's', actor_eid: R } } }
  assertEquals(scopeFor(g, noPer, '/nowhere'), R)
  // nothing places it: undefined
  let bare = { ...sess!, comps: { session: { id: 's' } } }
  assertEquals(scopeFor(g, bare, '/nowhere'), undefined)
  assertEquals(scopeFor(g, undefined, ''), undefined)
})

// The mail builders: `to` stays as typed (delivery resolves), a reply
// aims at the far side and threads by eid, Re: never piles up.
Deno.test('mailChanges/replyChanges: to as given, Re: derived, thread edge set', () => {
  let made = mailChanges({ to: 'P-20', subject: 'Hello', body: 'hi' })
  assertEquals(made.changes[0].comp, { title: 'Hello', body: 'hi' })
  assertEquals(made.changes[1].comp, { to: 'P-20' }) // unresolved on purpose
  // No sender rides along: `from` is off the wire, stamped by the server
  // from the writing actor, so a builder cannot offer to sign the letter.
  let full = mailChanges({
    to: 'x@y.test',
    subject: 's',
    replyTo: 'some-eid',
  })
  assertEquals(full.changes[1].comp, {
    to: 'x@y.test',
    reply_to_eid: 'some-eid',
  })
  assertEquals(reSubject('question'), 'Re: question')
  assertEquals(reSubject('Re: Re: question'), 'Re: question')
  assertEquals(reSubject('FWD: fw: re: question'), 'Re: question')
  let inbound = {
    eid: 'm1',
    num: 1,
    kind: 'mail',
    comps: {
      doc: { title: 'Re: asked', body: '' },
      mail: { to: 'us@x.test', from: 'them@y.test', message_id: 'msg:1:<a>' },
    },
  }
  let r = replyChanges(inbound, 'answer')
  assertEquals(r.changes[1].comp?.to, 'them@y.test') // the sender
  assertEquals(r.changes[1].comp?.reply_to_eid, 'm1')
  assertEquals(r.changes[0].comp?.title, 'Re: asked')
  let sent = {
    eid: 'm2',
    num: 2,
    kind: 'mail',
    comps: {
      doc: { title: 'opener', body: '' },
      mail: { to: 'them@y.test' },
    },
  }
  assertEquals(replyChanges(sent, 'more').changes[1].comp?.to, 'them@y.test')
})

// The misroute homelab reported: a letter that ARRIVED but carries no
// sender used to fall back to the address it was delivered to — our own
// inbox — so the reply looked sent and went nowhere near the writer.
Deno.test('a reply to an unsigned letter refuses, it does not guess', () => {
  let unsigned = {
    eid: 'm3',
    num: 3,
    kind: 'mail',
    comps: {
      doc: { title: 'asked', body: '' },
      mail: { to: 'us@x.test', message_id: 'local:1:m3' },
    },
  }
  assertThrows(
    () => replyChanges(unsigned, 'answer'),
    Error,
    'carries no sender',
  )
})

// The thread walk: up the reply chain and down through every answer,
// chronological by arrival/birth.
Deno.test('threadOf: both directions, in time order', () => {
  let mk = (
    eid: string,
    num: number,
    at: string,
    mail: Record<string, unknown>,
  ) => ({
    eid,
    num,
    kind: 'mail',
    comps: {
      entity: { eid, num },
      created: { eid, at },
      doc: { title: `m${num}`, body: '' },
      mail: { to: 'x@y', ...mail },
    },
  })
  let a = mk('a', 1, '2026-07-20T00:00:00Z', {})
  let b = mk('b', 2, '2026-07-21T00:00:00Z', { reply_to_eid: 'a' })
  let c = mk('c', 3, '2026-07-22T00:00:00Z', { reply_to_eid: 'b' })
  let lone = mk('d', 4, '2026-07-22T01:00:00Z', {})
  let g = [c, lone, a, b] // scrambled on purpose
  for (let start of ['a', 'b', 'c']) {
    assertEquals(threadOf(g, start).map((r) => r.eid), ['a', 'b', 'c'], start)
  }
  assertEquals(threadOf(g, 'd').map((r) => r.eid), ['d'])
  assertEquals(mailAt(b), '2026-07-21T00:00:00Z')
  assertEquals(
    mailAt(mk('e', 5, '2026-07-01T00:00:00Z', {
      received_at: '2026-07-19T00:00:00Z',
    })),
    '2026-07-19T00:00:00Z', // arrival outranks birth
  )
})

Deno.test('mailLine: unread dot, unverified mark, direction', () => {
  let NOW = Date.parse('2026-07-22T12:00:00Z')
  let inbound = {
    eid: 'x',
    num: 9,
    kind: 'mail',
    comps: {
      entity: { eid: 'x', num: 9, created_at: '' },
      doc: { title: 'Invoice', body: '' },
      mail: {
        to: 'us@x.test',
        from: 'them@y.test',
        message_id: 'msg:1:<a>',
        received_at: '2026-07-22T10:00:00Z',
        verified: 1,
      },
    },
  }
  assertMatch(
    mailLine(inbound, NOW),
    /^E-9 {4}● them@y.test → us@x.test — Invoice \(2h\)$/,
  )
  let read = {
    ...inbound,
    comps: {
      ...inbound.comps,
      mail: { ...inbound.comps.mail, verified: 0 },
      opened: { eid: 'x', at: 'now' }, // read-state rides the stamp (T-7006)
    },
  }
  assertMatch(mailLine(read, NOW), /· !unverified them@y.test/)
  let sent = {
    eid: 'y',
    num: 10,
    kind: 'mail',
    comps: {
      entity: { eid: 'y', num: 10 },
      created: { eid: 'y', at: '2026-07-22T11:00:00Z' },
      doc: { title: 'Ping', body: '' },
      mail: { to: 'P-20', to_addr: 'venture@x.test' },
    },
  }
  assertMatch(mailLine(sent, NOW), /^E-10 {3}· → venture@x.test — Ping \(1h\)$/)
  // a stored encoded-word subject renders decoded (rfc2047_test has the table)
  let encoded = {
    ...inbound,
    comps: {
      ...inbound.comps,
      doc: { title: '=?UTF-8?Q?Re=3A_caf=C3=A9?=', body: '' },
    },
  }
  assertMatch(mailLine(encoded, NOW), /— Re: café \(2h\)$/)
})

// The project pulse against a fixed clock: tasks in the scope you stand in
// that MOVED this week, newest first — and NOTHING else. A foreign project's
// task, a mail letter, a work-session brief, a board: none are pulse
// material (the CrayonBloom bleed, pinned — the old belongs() catch-all let
// mail/session/board docs ride into every project's tier). Older than a week
// is silent too.
Deno.test('contextDigest: pulse — scoped tasks that moved, no foreign bleed', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 30
  let mk = (
    eid: string,
    mod: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num: num++ } },
    { eid, name: 'created', comp: { at: mod } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let eid = (i: number) => `bbbbbbbb-0000-4000-8000-00000000000${i}`
  let P = eid(9) // the project we stand in
  let PF = eid(8) // a foreign project
  let late: Snapshot = {
    changes: [
      ...mk(P, ago(1), { doc: { title: 'Ours' }, project: {} }),
      ...mk(PF, ago(1), { doc: { title: 'Theirs' }, project: {} }),
      ...mk(eid(1), ago(2), {
        doc: { title: 'Ours moved', body: '' },
        task: { status: 'wip', priority: 0, project_eid: P },
      }),
      // foreign-project task: must NOT bleed into our pulse
      ...mk(eid(2), ago(1), {
        doc: { title: 'Foreign task', body: '' },
        task: { status: 'wip', priority: 0, project_eid: PF },
      }),
      // a mail letter — doc but no task comp: never pulse material
      ...mk(eid(3), ago(1), {
        doc: { title: 'A letter', body: '' },
        mail: { to: 'v@x.test', message_id: 'm:1:<a@x>' },
      }),
      // a foreign session brief: scoped by nothing, must stay out
      ...mk(eid(4), ago(1), {
        session: { id: 'ws-brief' },
        doc: { title: 'Work session', body: 'landed it' },
      }),
      // a board: a saved query, not pulse material
      ...mk(eid(5), ago(1), {
        doc: { title: 'A board' },
        board: { query: '' },
      }),
      // our project, but the touch is older than a week: silent. Claimed,
      // so the open-work suggestions skip it too — its absence is the
      // pulse's age gate alone, nothing else.
      ...mk(eid(6), ago(24 * 9), {
        doc: { title: 'Ours stale', body: '' },
        task: { status: 'wip', priority: 1, project_eid: P },
        claim: { session_eid: eid(7) },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(late, undefined, NOW, P)
  let lines = d.split('\n')
  assertEquals(lines.length <= 48, true)
  assertEquals(d.includes('## lately'), true)
  assertEquals(d.includes('Ours moved'), true)
  // the bleed, pinned shut: no foreign task, mail, brief, or board
  assertEquals(d.includes('Foreign task'), false)
  assertEquals(d.includes('A letter'), false)
  assertEquals(d.includes('Work session'), false)
  assertEquals(d.includes('A board'), false)
  // older than a week is silent
  assertEquals(d.includes('Ours stale'), false)
})

// `## decided` orders by decided.at, NOT by heat or by when a thing was
// filed — the oldest decision here is the most recently created row, and it
// still sorts last. An entity with no stamp is absent from the section, and
// the stamp is a facet, so a task and a memory both qualify.
Deno.test('contextDigest: ## decided — by decision date, stamp-only', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let num = 60
  let eid = (i: number) => `cccccccc-0000-4000-8000-00000000000${i}`
  let P = eid(9)
  let mk = (
    e: string,
    born: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid: e, name: 'entity', comp: { eid: e, num: num++ } },
    { eid: e, name: 'created', comp: { at: born } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid: e, name, comp })),
  ]
  let snap: Snapshot = {
    changes: [
      ...mk(P, '2026-07-01T00:00:00Z', { doc: { title: 'Ours' }, project: {} }),
      ...mk(eid(1), '2026-07-19T00:00:00Z', {
        doc: { title: 'Ship weekly' },
        task: { status: 'done', priority: 0, project_eid: P },
        decided: { at: '2026-05-04T00:00:00Z' },
      }),
      ...mk(eid(2), '2026-07-02T00:00:00Z', {
        doc: { title: 'Bill quarterly' },
        memory: { type: 'project', scope_eid: P },
        decided: { at: '2026-06-30T00:00:00Z' },
      }),
      // no stamp: absent from the section, whatever its age
      ...mk(eid(3), '2026-07-19T00:00:00Z', {
        doc: { title: 'Still arguing' },
        task: { status: 'open', priority: 0, project_eid: P },
      }),
      // decided in another project: not ours
      ...mk(eid(4), '2026-07-19T00:00:00Z', {
        doc: { title: 'Their call' },
        task: { status: 'done', priority: 0, project_eid: eid(8) },
        decided: { at: '2026-07-01T00:00:00Z' },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(snap, undefined, NOW, P)
  let said = d.split('\n').filter((l) => l.startsWith('- 2026-'))
  assertEquals(said.length, 2)
  assertMatch(said[0], /^- 2026-06-30 .* Bill quarterly$/)
  assertMatch(said[1], /^- 2026-05-04 .* Ship weekly$/)
  assertEquals(d.includes('Still arguing') && d.includes('## decided'), true)
  assertEquals(said.some((l) => l.includes('Still arguing')), false)
  assertEquals(d.includes('Their call'), false)
})

// The scope test the `## decided` block and `task decided` share. Each kind
// names its project its own way, and an UNSCOPED memory belongs to every one
// of them — a fleet-wide ruling binds the project you stand in hardest, so
// scoping a door must never be what hides it.
Deno.test('belongs: a project reads each kind, and the fleet rides along', () => {
  let P = 'p', Q = 'q'
  let row = (comps: Record<string, Record<string, unknown>>): Row => ({
    eid: 'e',
    num: 1,
    kind: 'thing',
    comps,
  })
  let task = row({ task: { project_eid: P } })
  let mine = row({ memory: { scope_eid: P } })
  let fleet = row({ memory: {} })
  let doc = row({ doc: { title: 'a note' } })
  assertEquals([task, mine, fleet, doc].map((r) => belongs(r, P)), [
    true,
    true,
    true,
    true,
  ])
  assertEquals([task, mine, fleet, doc].map((r) => belongs(r, Q)), [
    false,
    false,
    true,
    true,
  ])
  // No scope is every scope — the `--all` view, and a cwd that places nobody.
  assertEquals([task, mine].map((r) => belongs(r)), [true, true])
  // A project entity is its own scope; a persona belongs to its home.
  assertEquals(belongs({ ...row({ project: {} }), eid: P }, P), true)
  assertEquals(belongs({ ...row({ project: {} }), eid: P }, Q), false)
  assertEquals(belongs(row({ persona: { home_eid: Q } }), Q), true)
})

Deno.test('spec: a typed task — leading P, params anywhere, body below', () => {
  let s = spec(
    'P1 .domain=Eng Build a thing ' +
      '.proposed.at=2026-08-01T00:00:00.000Z blah blah\n' +
      'line two\nline three',
  )
  assertEquals(s.title, 'Build a thing blah blah')
  assertEquals(s.body, 'line two\nline three')
  assertEquals(s.grouped.task, { priority: 1, domain: 'Eng' })
  assertEquals(s.grouped.proposed, { at: '2026-08-01T00:00:00.000Z' })
  // P mid-title is a WORD — only a leading P is a setter
  assertEquals(spec('Fix the P2 endpoint').title, 'Fix the P2 endpoint')
  assertEquals(spec('Fix the P2 endpoint').grouped.task, undefined)
  // params still parse after words; fractional P too
  assertEquals(spec('Ship it .status=wip').grouped.task, { status: 'wip' })
  assertEquals(spec('p0.5 Urgent').grouped.task?.priority, 0.5)
  // a malformed dot-word stays a word — mid-typing is not an error
  assertEquals(spec('touch .env file').title, 'touch .env file')
  assertEquals(spec('').title, '')
})

Deno.test('spec: read is the door’s value convention, and it throws', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  // no reader: the value is what was typed
  assertEquals(spec(`Ship it .body=@${f}`).grouped.doc, { body: `@${f}` })
  assertEquals(
    spec(`Ship it .body=@${f}`, inflate).grouped.doc,
    { body: 'the whole brief\n' },
  )
  // a missing file is LOUD — never a word swallowed into the title
  assertThrows(
    () => spec('Ship it .body=@/no/such/file', inflate),
    Error,
    'no such file',
  )
  Deno.removeSync(f)
})

// ---- the memory doors' pure halves ----

Deno.test('memoryChanges: doc face + memory comp, session writer and scope', () => {
  let { changes } = memoryChanges(all, {
    title: 'Prefers terse tests',
    scope: 'T-3',
    session: 'sess-x',
  })
  assertEquals(changes.length, 2) // the session exists: nothing minted
  assertEquals(changes[0].comp?.title, 'Prefers terse tests')
  assertEquals(changes[1].name, 'memory')
  assertEquals(changes[1].comp, { scope_eid: T2 })
  assertThrows(() =>
    memoryChanges(all, { title: 'x', scope: 'P-99', session: 'sess-x' })
  )
})

// The retired enum's one surviving value, as a facet: `feedback` names WHO
// gave it, resolved like any reference, and a bare '' still tags the memory
// — the source being unknown is not a reason to lose the fact.
Deno.test('memoryChanges: the feedback tag carries its source, or none', () => {
  let named = memoryChanges(all, {
    title: 'Prefers terse tests',
    feedback: 'T-3',
    session: 'sess-x',
  }).changes
  assertEquals(named.at(-1)?.name, 'feedback')
  assertEquals(named.at(-1)?.comp, { by: T2 })
  let bare = memoryChanges(all, {
    title: 'Somebody said this once',
    feedback: '',
    session: 'sess-x',
  }).changes
  assertEquals(bare.at(-1)?.comp, {})
  // A handle that names nothing is refused, never stored as text.
  assertThrows(() =>
    memoryChanges(all, { title: 'x', feedback: 'nobody', session: 'sess-x' })
  )
  // Untagged is the default: a memory carrying no correction wears nothing.
  let plain = memoryChanges(all, { title: 'a fact', session: 'sess-x' }).changes
  assertEquals(plain.some((c) => c.name == 'feedback'), false)
})

Deno.test('memoryChanges: an unknown session is minted alongside', () => {
  let { changes } = memoryChanges(all, { title: 'x', session: 'newcomer' })
  assertEquals(changes.length, 3)
  assertEquals(changes[0].name, 'session')
  assertEquals(changes[2].comp, { scope_eid: null })
})

// ---- the design door's pure half ----

Deno.test('designChanges: a doc, the tag, and the proposed mark', () => {
  let { changes } = designChanges(all, {
    title: 'Mail is local-first for fleet recipients',
    body: 'The sent entity gains its arrival stamp in-graph.',
    session: 'sess-x',
  })
  assertEquals(changes.length, 3) // the session exists: nothing minted
  assertEquals(
    changes[0].comp?.title,
    'Mail is local-first for fleet recipients',
  )
  assertEquals(changes[1].name, 'design')
  assertEquals(changes[1].comp, {}) // a tag says only its name
  assertEquals(changes[2].name, 'proposed')
  assertEquals(changes[2].comp, {}) // bare: the column dates it now
  // No decided mark — proposing is not deciding, and the spawn gate reads
  // exactly that difference.
  assertEquals(changes.some((c) => c.name == 'decided'), false)
})

// A design carried in from a file was written before the row existed, and
// created.at is server-stamped, so the day it was written has nowhere else
// to live. The phrase rides the wire; apply() resolves it once.
Deno.test('designChanges: `at` says when it was written', () => {
  let { changes } = designChanges(all, {
    title: 'Boot partition',
    at: '2026-07-23',
    session: 'sess-x',
  })
  assertEquals(changes.at(-1)?.comp, { at: '2026-07-23' })
  assertEquals(changes[0].comp?.body, '') // a design may be all title
})

Deno.test('designChanges: an unknown session is minted alongside', () => {
  let { changes } = designChanges(all, { title: 'x', session: 'newcomer' })
  assertEquals(changes.length, 4)
  assertEquals(changes[0].name, 'session')
})

Deno.test('recallIndex: warmest first, index lines only, filtered', () => {
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000011'
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000012'
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let D = 86_400_000
  let at = (ago: number) => new Date(NOW - ago).toISOString()
  let mems = rows({
    changes: [
      { eid: M1, name: 'entity', comp: { eid: M1, num: 11, created_at: '' } },
      { eid: M1, name: 'doc', comp: { title: 'cold fact', body: 'long ago' } },
      { eid: M1, name: 'memory', comp: { scope_eid: null } },
      {
        eid: M1,
        name: 'recall',
        comp: { count: 1, first_at: at(60 * D), last_at: at(60 * D) },
      },
      { eid: M2, name: 'entity', comp: { eid: M2, num: 12, created_at: '' } },
      { eid: M2, name: 'doc', comp: { title: 'warm fact', body: 'today' } },
      {
        eid: M2,
        name: 'memory',
        comp: { last_confirmed_at: at(D) },
      },
      { eid: M2, name: 'feedback', comp: {} },
      {
        eid: M2,
        name: 'recall',
        comp: { count: 5, first_at: at(30 * D), last_at: at(2 * 3_600_000) },
      },
    ],
  })
  let lines = recallIndex(mems, parseQuery(''), NOW)
  assertEquals(lines.length, 2)
  assertMatch(lines[0], /^M-12 /) // the warm one leads
  assertMatch(lines[0], /warm fact/)
  assertMatch(lines[0], /5×/)
  assertMatch(lines[0], /confirmed 2026-07-19/)
  assertEquals(lines[0].includes('today'), false) // bodies stay home
  // The tag is what the head says now — the retired enum's other values
  // said only what the line already carried.
  assertMatch(lines[0], /M-12 [\d.]+ feedback: warm fact/)
  assertMatch(lines[1], /M-11 [\d.]+ cold fact/)
  assertEquals(recallIndex(mems, parseQuery('cold'), NOW).length, 1)
})

Deno.test('derefParams: reference values resolve at the door', () => {
  let one = (s: string) => derefParams(all, [param(s)!])[0].value
  assertEquals(one('.assignee=old-board-slug'), T2) // alias slug
  assertEquals(one('.assignee=T-2'), T1) // human id
  assertEquals(one('.assignee=3'), T2) // bare num
  assertEquals(one(`.assignee=${T1}`), T1) // an eid passes through
  assertEquals(one('.assignee='), null) // an optional scalar clear is null
  assertEquals(one('.title=jeff'), 'jeff') // not a reference
  assertThrows(
    () => one('.assignee=ghost'),
    Error,
    'assignee_eid is a human id / alias / UUID',
  )
})

Deno.test('derefParams: project references accept P-nums and eids', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 4 } },
      { eid: p, name: 'project', comp: {} },
    ],
  })
  let one = (s: string) => derefParams(graph, [param(s)!])[0].value
  assertEquals(one('.project=P-4'), p)
  assertEquals(one(`.project=${p}`), p)
})

// `(no matches)` for a handle that names nothing reads as "that project
// has no tasks", not "there is no such project" — the quiet half of the
// same typo the write door already teaches.
Deno.test('checkRefs: an unresolvable handle in a filter is a typo, not an empty list', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 30 } },
      { eid: p, name: 'doc', comp: { title: 'bindery', body: '' } },
      { eid: p, name: 'alias', comp: { slug: 'bindery' } },
      { eid: p, name: 'project', comp: {} },
    ],
  })
  let ask = (q: string) =>
    checkRefs(graph, resolveRefs(parseQuery(q), (id) => find(graph, id)?.eid))
  assertThrows(
    () => ask('.project=bindry'),
    Error,
    "no entity: bindry (.project_eid) — did you mean 'bindery' (P-30, bindery)?",
  )
  assertThrows(() => ask('.project=zzzznope'), Error, 'no entity: zzzznope')
  // lists check every part; != is the same claim about the same handle
  assertThrows(() => ask('.project=bindery,zzzznope'), Error, 'zzzznope')
  assertThrows(() => ask('.project!=zzzznope'), Error, 'zzzznope')
  // and everything that does NOT name an entity passes through untouched
  ask('.project=bindery') // resolves
  ask('.project=') // empty IS absent, the documented spelling
  ask('.project~=bind') // contains is literal
  ask('.priority<=1') // not a reference at all
  ask('.title~=zzzznope')
  ask('.updated.at=today')
  ask('.num=1..9')
})

// A board is a saved query: the project it names may be renamed or
// deleted long after, and a board that throws is worse than one that
// returns nothing. Stored evaluation never calls checkRefs — the forgiving
// reading stays where the query is stored, the strict one where it is typed.
Deno.test('resolveRefs stays total for a handle that is gone', () => {
  let preds = resolveRefs(parseQuery('.project=vanished'), () => undefined)
  assertEquals(preds[0].value, 'vanished') // as typed, matching nothing
  assertEquals(matchQuery({ task: { project_eid: 'x' } }, preds), false)
})

// The failure fires exactly when someone reasons from the fleet id: the
// project called `tasks` answers to `home`. Naming the near match is safe
// only because it is checked to RESOLVE before it is offered.
Deno.test('derefParams: a failed project names the alias that would work', () => {
  let p = 'aaaaaaaa-0000-4000-8000-000000000004'
  let q = 'aaaaaaaa-0000-4000-8000-000000000005'
  let graph = rows({
    changes: [
      ...snap.changes,
      { eid: p, name: 'entity', comp: { eid: p, num: 19 } },
      { eid: p, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: p, name: 'alias', comp: { slug: 'home' } },
      { eid: p, name: 'project', comp: {} },
      { eid: q, name: 'entity', comp: { eid: q, num: 20 } },
      { eid: q, name: 'doc', comp: { title: 'holdco', body: '' } },
      { eid: q, name: 'alias', comp: { slug: 'holdco' } },
      { eid: q, name: 'project', comp: {} },
    ],
  })
  let one = (s: string) => derefParams(graph, [param(s)!])[0].value
  assertEquals(one('.project=home'), p) // the handle that works
  assertThrows(
    () => one('.project=tasks'),
    Error,
    "no project 'tasks' — did you mean 'home' (P-19, Task Graph)?",
  )
  assertThrows(
    () => one('.project=holdc'),
    Error,
    "did you mean 'holdco' (P-20, holdco)?",
  )
  // Nothing close: the grammar line, plainly — never a guess that routes
  // nowhere, because the caller is already confused when they read it.
  assertThrows(
    () => one('.project=flux'),
    Error,
    "project_eid is a human id / alias / UUID — got 'flux'",
  )
  // Two things keep a task out of the answer. The declared target narrows
  // `.project=` to projects; and a task's TITLE is a sentence about work,
  // never a handle, so even the untargeted `.assignee=` stays silent.
  assertThrows(() => one('.project=Frist'), Error, 'a human id / alias / UUID')
  assertThrows(() => one('.assignee=Frist'), Error, 'a human id / alias / UUID')
  // Its ALIAS is a handle whatever wears it, so that still answers.
  assertThrows(
    () => one('.assignee=old-board-slig'),
    Error,
    "did you mean 'old-board-slug' (T-3, Second)?",
  )
})

Deno.test('edgesOf: both directions, ids humanized', () => {
  let all = rows(snap)
  let out = edgesOf(snap, all, T1)
  assertEquals(out.refs, [{ type: 'requires', child: 'T-3' }])
  assertEquals(out.backrefs, [])
  let back = edgesOf(snap, all, T2)
  assertEquals(back.refs, [])
  assertEquals(back.backrefs, [{ type: 'requires', parent: 'T-2' }])
})

Deno.test('showMd: frontmatter, edge sentences, claim holder, body', () => {
  let row = by(T1)
  let typed = {
    ...row,
    comps: { ...row.comps, mail: { verified: 1 } },
  }
  let md = showMd(snap, all, typed)
  assertMatch(md, /^---\nid: T-2\nkind: task\n/)
  assertMatch(md, /status: wip/)
  assertMatch(md, /priority: P0/)
  assertMatch(md, /verified: true/)
  assertMatch(md, /claim: sess-x/) // the holder's session id, not an eid
  assertMatch(md, /requires:\n {2}- T-3 \(open\) — Second/)
  assertMatch(md, /# First/)
  assertEquals(md.includes('aaaaaaaa'), false) // no uuid reaches the reader
  assertEquals(JSON.parse(JSON.stringify(typed)).comps.mail.verified, 1)
  let back = showMd(snap, all, by(T2))
  assertMatch(back, /referenced by:\n {2}- T-2 \(wip\) — First · requires this/)
})

Deno.test('showMd: memories name their scope and persona memberships', () => {
  let P = 'aaaaaaaa-0000-4000-8000-000000000020'
  let N = 'aaaaaaaa-0000-4000-8000-000000000021'
  let M1 = 'aaaaaaaa-0000-4000-8000-000000000022'
  let M2 = 'aaaaaaaa-0000-4000-8000-000000000023'
  let graph: Snapshot = {
    changes: [
      { eid: P, name: 'entity', comp: { eid: P, num: 20 } },
      { eid: P, name: 'doc', comp: { title: 'Atlas' } },
      { eid: P, name: 'project', comp: {} },
      { eid: N, name: 'entity', comp: { eid: N, num: 21 } },
      { eid: N, name: 'doc', comp: { title: 'Operator' } },
      { eid: N, name: 'persona', comp: { home_eid: P } },
      { eid: M1, name: 'entity', comp: { eid: M1, num: 22 } },
      {
        eid: M1,
        name: 'memory',
        comp: { type: 'feedback', scope_eid: null },
      },
      { eid: M2, name: 'entity', comp: { eid: M2, num: 23 } },
      {
        eid: M2,
        name: 'memory',
        comp: { type: 'project', scope_eid: P },
      },
    ],
    deps: [
      { parent: N, type: 'contains', child: M1 },
      { parent: N, type: 'reads', child: M2 },
    ],
  }
  let people = rows(graph)
  let show = (eid: string) =>
    showMd(graph, people, people.find((r) => r.eid == eid)!)
  assertMatch(
    show(M1),
    /scope: shared[\s\S]*N-21 — Operator · contains this/,
  )
  assertMatch(
    show(M2),
    /scope: P-20 — Atlas[\s\S]*N-21 — Operator · reads this/,
  )
})

Deno.test('showMd: comments ride as a section, oldest first', () => {
  let C = 'aaaaaaaa-0000-4000-8000-000000000009'
  let snap2: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: C, name: 'entity', comp: { eid: C, num: 9 } },
      { eid: C, name: 'created', comp: { at: '2t', via: S } },
      { eid: C, name: 'doc', comp: { title: '', body: 'a remark' } },
      { eid: C, name: 'comment', comp: { target_eid: T1 } },
      { eid: C, name: 'review', comp: { verdict: 'changes_requested' } },
    ],
    deps: snap.deps,
  }
  let all2 = rows(snap2)
  let md = showMd(snap2, all2, all2.find((r) => r.eid == T1)!)
  assertMatch(
    md,
    /## Comments\n\n— 2t · S-1 — sess-x · changes requested\n\na remark/,
  )
})

Deno.test('grammar: the teaching text derives from the vocabulary', async () => {
  let { GRAMMAR, FILTERS } = await import('./grammar.ts')
  assertMatch(GRAMMAR, /status\(open\|wip\|done\|cancelled\)/)
  assertMatch(GRAMMAR, /Statuses: open, wip, done, cancelled/)
  assertMatch(
    GRAMMAR,
    /review: verdict\(approved\|rejected\|changes_requested\|approve\|reject\|changes\)/,
  )
  assertMatch(GRAMMAR, /typed scalars parse by their grammar/)
  assertMatch(FILTERS, /time phrases/i)
})

// A day's journal slice, oldest events last (the server serves newest
// first): mint a task, claim it, comment on it, link it, finish it.
let DAY: import('./client.ts').JournalEntry[] = [
  {
    ts: '2026-07-20T18:00:00Z',
    actor: 'sess-x',
    changes: [
      { eid: T1, name: 'task', comp: { status: 'done' } },
      {
        eid: 'c-1',
        name: 'doc',
        comp: { title: '', body: 'status: wip → done — verified\nmore' },
      },
      { eid: 'c-1', name: 'comment', comp: { target_eid: T1 } },
      { eid: 'c-1', name: 'entity', comp: { num: 9, created_at: '' } },
    ],
  },
  {
    ts: '2026-07-20T12:00:00Z',
    actor: 'sess-x',
    changes: [
      {
        eid: T1,
        name: 'dependency',
        comp: { type: 'requires', child_eid: T2 },
      },
    ],
  },
  {
    ts: '2026-07-20T10:00:00Z',
    actor: 'sess-x',
    changes: [{ eid: T1, name: 'claim', comp: { session_eid: S } }],
  },
  {
    ts: '2026-07-20T09:00:00Z',
    actor: 'sess-x',
    changes: [
      { eid: T1, name: 'doc', comp: { title: 'First', body: '' } },
      { eid: T1, name: 'task', comp: { status: 'open' } },
      { eid: T1, name: 'entity', comp: { num: 2, created_at: '' } },
    ],
  },
]

Deno.test('ledger: the day as lived, oldest first, ids humanized', () => {
  let lines = ledger(DAY, all)
  assertEquals(
    lines[0],
    '2026-07-20T09:00:00Z → 2026-07-20T18:00:00Z · 4 batch(es)',
  )
  let text = lines.join('\n')
  assertMatch(text, /\+ minted task T-2 First/)
  assertMatch(text, /⚑ claimed T-2 First/)
  assertMatch(text, /∴ linked T-2 First requires T-3 Second/)
  assertMatch(text, /→ T-2 First status → done/)
  assertMatch(text, /💬 on T-2 First: status: wip → done — verified/) // first line only
  // order: mint before claim before link before finish
  let at = (re: RegExp) => lines.findIndex((l) => re.test(l))
  assertEquals(at(/minted/) < at(/claimed/), true)
  assertEquals(at(/claimed/) < at(/linked/), true)
  assertEquals(ledger([], all), [])
})

Deno.test('wrap: the stub carries the ledger; a hand-written brief is never clobbered', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = wrapChanges(all, 'sess-x', AT, DAY)
    .find((c) => c.name == 'doc' && c.eid == S)
  let body = String(doc?.comp?.body)
  assertMatch(body, /^Auto-written at wrap/)
  assertMatch(body, /## Ledger/)
  assertMatch(body, /⚑ claimed T-2/)
  assertMatch(body, /## Ended holding/)
  // an existing STUB refreshes (keeps its title), a prose brief stays
  let stubbed = structuredClone(snap)
  stubbed.changes.push({
    eid: S,
    name: 'doc',
    comp: {
      title: 'Work session 2026-07-19',
      body: 'Auto-written at wrap — old stub',
    },
  })
  let re = wrapChanges(rows(stubbed), 'sess-x', AT, DAY)
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(re?.comp?.title, 'Work session 2026-07-19')
  assertMatch(String(re?.comp?.body), /## Ledger/)
  let prose = structuredClone(snap)
  prose.changes.push({
    eid: S,
    name: 'doc',
    comp: { title: 'My day', body: 'I did things, thoughtfully.' },
  })
  assertEquals(
    wrapChanges(rows(prose), 'sess-x', AT, DAY)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
})

Deno.test('notices: bylines read actor and instrument from the stamp', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000010'
  let P = 'aaaaaaaa-0000-4000-8000-000000000011' // the operator project
  let mk = (eid: string, actor: string, via: string) => [
    { eid, name: 'entity', comp: { eid, num: 91 } },
    { eid, name: 'created', comp: { at: '2026-01-02', by: actor, via } },
    { eid, name: 'doc', comp: { title: '', body: 'from the operator' } },
    { eid, name: 'comment', comp: { target_eid: T1 } },
  ]
  let s: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 81, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: B, name: 'entity', comp: { eid: B, num: 82, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b', actor_eid: P } },
      ...mk('c-9', P, B),
    ],
    deps: snap.deps,
  }
  let [line] = noticesFor(s, 'sess-x').lines
  assertMatch(line, /P-81 · via S-82/) // operator, not session id
})

Deno.test('contextDigest: sessionless is the preview — headed as one, claim line templated', () => {
  let d = contextDigest(snap)
  assertEquals(d.startsWith('# tasks · a preview'), true)
  assertEquals(d.includes('task claim <id> <session>'), true)
  assertEquals(d.includes('nothing claimed'), true)
})

// The project-aware digest: scope narrows suggestions and the pulse to the
// project you stand in; the fleet-memory front page is UNSCOPED principles
// only (a project's own scoped lessons live behind memory_recall now), and
// your claims always ride.
Deno.test('contextDigest: scope — local work, principle memory, cwd derives', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let hour = new Date(NOW - 3_600_000).toISOString()
  let id = (n: number) =>
    `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [PA, PB, TA, TB, MA, MB, MF, SC] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
  let mk = (
    eid: string,
    num: number,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at: hour } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(PA, 1, {
        doc: { title: 'Alpha' },
        project: {},
        repo: { path: '/repo/a' },
      }),
      ...mk(PB, 2, {
        doc: { title: 'Beta' },
        project: {},
        repo: { path: '/repo/b' },
      }),
      ...mk(TA, 3, {
        doc: { title: 'A work' },
        task: { status: 'open', priority: 1, project_eid: PA },
      }),
      ...mk(TB, 4, {
        doc: { title: 'B work' },
        task: { status: 'open', priority: 1, project_eid: PB },
      }),
      ...mk(MA, 5, {
        doc: { title: 'A lesson' },
        memory: { type: 'project', scope_eid: PA },
      }),
      ...mk(MB, 6, {
        doc: { title: 'B lesson' },
        memory: { type: 'project', scope_eid: PB },
      }),
      ...mk(MF, 7, {
        doc: { title: 'A principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(SC, 8, { session: { id: 'sess-in-a', cwd: '/repo/a/deep' } }),
    ],
    deps: [],
  }
  // explicit scope: Alpha's digest names itself, suggests only its work
  let d = contextDigest(g, undefined, NOW, PA)
  assertEquals(d.includes('· P-1 Alpha'), true)
  assertEquals(d.includes('open work here'), true)
  assertEquals(d.includes('A work'), true)
  assertEquals(d.includes('B work'), false)
  assertEquals(d.includes('A principle'), true) // unscoped memory rides
  assertEquals(d.includes('A lesson'), false) // a scoped lesson no longer does
  assertEquals(d.includes('B lesson'), false)
  // a session's own cwd derives the same scope
  let s = contextDigest(g, 'sess-in-a', NOW)
  assertEquals(s.includes('· P-1 Alpha'), true)
  assertEquals(s.includes('B work'), false)
  // no scope: the fleet view, both works suggested
  let f = contextDigest(g, undefined, NOW)
  assertEquals(f.includes('A work') && f.includes('B work'), true)
})

// The lines of one section: its heading and the bullet rows under it. Lets
// the parity test compare a project-layer tier across two digests without
// the session-layer noise (or the trailing claim boilerplate) between them.
let section = (d: string, head: string) => {
  let ls = d.split('\n')
  let i = ls.findIndex((l) => l.startsWith(head))
  if (i < 0) return []
  let out = [ls[i]]
  for (let j = i + 1; j < ls.length && ls[j].startsWith('- '); j++) {
    out.push(ls[j])
  }
  return out
}

// The fleet-memory front page: only UNSCOPED memories (a scoped lesson
// lives behind memory_recall), warmest first. Recognition only — the
// digest is a pure string, so listing a memory never bumps its recall
// (two identical calls, no state touched).
Deno.test('contextDigest: from the fleet — unscoped only, warmth order, no bump', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let id = (n: number) =>
    `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, MW, MC, MS] = [1, 2, 3, 4].map(id)
  let mk = (
    eid: string,
    num: number,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(P, 1, ago(1), { doc: { title: 'Proj' }, project: {} }),
      ...mk(MW, 2, ago(1), { // warm: touched an hour ago
        doc: { title: 'Warm principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(MC, 3, ago(100), { // cool: touched days ago
        doc: { title: 'Cool principle' },
        memory: { type: 'feedback' },
      }),
      ...mk(MS, 4, ago(1), { // scoped: never on the front page
        doc: { title: 'Scoped lesson' },
        memory: { type: 'project', scope_eid: P },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(g, undefined, NOW, P)
  let fleet = section(d, '## from the fleet').join('\n')
  assertEquals(fleet.includes('Warm principle'), true)
  assertEquals(fleet.includes('Cool principle'), true)
  assertEquals(fleet.includes('Scoped lesson'), false) // scoped stays off
  // warmest first
  assertEquals(
    fleet.indexOf('Warm principle') < fleet.indexOf('Cool principle'),
    true,
  )
  // recognition only: a pure string, no side effect — identical twice
  assertEquals(contextDigest(g, undefined, NOW, P), d)
})

// Preview parity, the owner's hard requirement: the PROJECT-layer tiers
// (pulse, from the fleet) render byte-identical whether a session rode in
// or not — so `task context` in a repo shows exactly what that project's
// operator sees, minus the session extras. By construction: those tiers
// are pure functions of scope, and the cap leaves them room to spare.
Deno.test('contextDigest: preview parity — project layer matches with/without a session', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let id = (n: number) =>
    `abababab-0000-4000-8000-${String(n).padStart(12, '0')}`
  let [P, T1p, T2p, M1p, SESS] = [1, 2, 3, 4, 5].map(id)
  let mk = (
    eid: string,
    num: number,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num } },
    { eid, name: 'created', comp: { at } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let g: Snapshot = {
    changes: [
      ...mk(P, 1, ago(1), { doc: { title: 'Proj' }, project: {} }),
      ...mk(T1p, 2, ago(2), {
        doc: { title: 'First move' },
        task: { status: 'wip', priority: 0, project_eid: P },
      }),
      ...mk(T2p, 3, ago(5), {
        doc: { title: 'Second move' },
        task: { status: 'open', priority: 1, project_eid: P },
      }),
      ...mk(M1p, 4, ago(1), {
        doc: { title: 'A principle' },
        memory: { type: 'feedback' },
      }),
      // a session that CLAIMS a project task — its digest gains the session
      // layer (claimed-by-you, onMine); the project layer must not shift.
      ...mk(SESS, 5, ago(0), { session: { id: 'sess-p' } }),
      { eid: T1p, name: 'claim', comp: { session_eid: SESS } },
    ],
    deps: [],
  }
  let preview = contextDigest(g, undefined, NOW, P)
  let session = contextDigest(g, 'sess-p', NOW, P)
  // the session digest genuinely carries more (its claim), proving the
  // two aren't trivially equal
  assertEquals(session.includes('claimed by you'), true)
  assertEquals(preview.includes('claimed by you'), false)
  // yet the project-layer tiers are byte-identical
  assertEquals(section(preview, '## lately'), section(session, '## lately'))
  assertEquals(
    section(preview, '## from the fleet'),
    section(session, '## from the fleet'),
  )
})

let p = (value: string) => ({ comp: 'doc', prop: 'body', value })
let pipe = (terminal = false) => ({
  terminal: () => terminal,
  read: () => ' the whole brief\n',
})

Deno.test('inflate: @ reads the file loudly, @@ is a literal, plain rides', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  assertEquals(inflate(p(`@${f}`)).value, 'the whole brief\n')
  assertEquals(inflate(p('@@handle')).value, '@handle')
  assertEquals(inflate(p('plain')).value, 'plain')
  assertThrows(() => inflate(p('@/no/such/file')), Error, 'no such file')
  Deno.removeSync(f)
})

Deno.test('inflate: @- is the pipe — the same door as @file, trimmed', () => {
  assertEquals(inflate(p('@-'), pipe()).value, 'the whole brief')
  // a bare - is the same ask, not a one-character string: the spelling
  // --body already answered, so it means the pipe at every door.
  assertEquals(inflate(p('-'), pipe()).value, 'the whole brief')
})

Deno.test('inflate: only an EXACT - is the pipe, a hyphen in prose is prose', () => {
  for (let v of ['a-b', '-x', '--', '- ', ' -', '-\n-']) {
    assertEquals(inflate(p(v), pipe()).value, v)
  }
})

Deno.test('inflate: a bare - with no pipe fails fast, it never waits', () => {
  let read = 0
  let io = { terminal: () => true, read: () => (read++, 'nope') }
  assertThrows(() => inflate(p('-'), io), Error, '.body=-: stdin is a TTY')
  assertEquals(read, 0)
  // and an empty pipe is refused the same as @-'s: clearing is `.prop=`.
  assertThrows(
    () => inflate(p('-'), { terminal: () => false, read: () => '  \n' }),
    Error,
    '.body=-: stdin was empty',
  )
})

Deno.test('inflate: a TTY fails fast, it never waits on the pipe', () => {
  let read = 0
  let io = { terminal: () => true, read: () => (read++, 'nope') }
  assertThrows(() => inflate(p('@-'), io), Error, '.body=@-: stdin is a TTY')
  assertEquals(read, 0)
})

Deno.test('inflate: stdin is consumable once — the second @- is refused', () => {
  let io = pipe()
  assertEquals(inflate(p('@-'), io).value, 'the whole brief')
  // the second read would come back EMPTY, and an empty value clears the
  // column — the failure that wiped four session briefs.
  assertThrows(
    () => inflate({ comp: 'doc', prop: 'title', value: '@-' }, io),
    Error,
    '.title=@-: stdin was already read by .body=@-',
  )
})

Deno.test('inflate: the refusal names the token that drank the pipe', () => {
  let io = pipe()
  assertEquals(inflate(p('-'), io, '--body=-').value, 'the whole brief')
  assertThrows(
    () => inflate(p('@-'), io),
    Error,
    '.body=@-: stdin was already read by --body=-',
  )
})

Deno.test('inflate: an empty pipe is refused, never a silent clear', () => {
  let io = { terminal: () => false, read: () => '  \n' }
  assertThrows(() => inflate(p('@-'), io), Error, '.body=@-: stdin was empty')
})

Deno.test('inflate: errors name the token the caller typed', () => {
  assertThrows(
    () => inflate(p('@/no/such/file'), pipe(), '--body=@/no/such/file'),
    Error,
    '--body=@/no/such/file: no such file',
  )
})

Deno.test("contextDigest: previously — the same operator's last brief", () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 50
  let mk = (
    eid: string,
    mod: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    { eid, name: 'entity', comp: { eid, num: num++ } },
    { eid, name: 'created', comp: { at: mod } },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let eid = (i: number) => `cccccccc-0000-4000-8000-00000000000${i}`
  let OP = eid(9)
  let late: Snapshot = {
    changes: [
      ...mk(eid(1), ago(20), {
        session: { id: 'ws-old', actor_eid: OP },
        doc: {
          title: 'Work session',
          body: 'landed: everything\nnext: polish',
        },
      }),
      ...mk(eid(2), ago(30), {
        session: { id: 'ws-older', actor_eid: OP },
        doc: { title: 'Older', body: 'stale' },
      }),
      ...mk(eid(3), ago(4), {
        session: { id: 'ws-other', actor_eid: eid(8) },
        doc: { title: 'Other op', body: 'not yours' },
      }),
      ...mk(eid(4), ago(0), { session: { id: 'ws-new', actor_eid: OP } }),
    ],
    deps: [],
  }
  let d = contextDigest(late, 'ws-new', NOW)
  assertMatch(d, /## previously — S-50 Work session/)
  assertEquals(d.includes('landed: everything'), true)
  // the newest same-operator brief wins — never another op's, never older
  assertEquals(d.includes('previously — S-52'), false)
  assertEquals(d.includes('stale'), false)
  // the tied session is not double-listed in lately's briefs
  assertEquals(
    d.split('\n').filter((l) => l.includes('Work session')).length,
    1,
  )
  // a stubbed doc is no brief — final_text stands in
  let stubbed = structuredClone(late)
  stubbed.changes.find((c) => c.eid == eid(1) && c.name == 'doc')!.comp!.body =
    `${STUB} — a stub, enrich me.`
  stubbed.changes.find((c) => c.eid == eid(1) && c.name == 'session')!.comp!
    .final_text = 'the closing words'
  assertEquals(
    contextDigest(stubbed, 'ws-new', NOW).includes('the closing words'),
    true,
  )
  // no operator in common: no previously line
  assertEquals(
    contextDigest(late, 'ws-other', NOW).includes('previously'),
    false,
  )
})

Deno.test('contextDigest: unheard — comments after a past session stopped listening', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 70
  let mk = (
    eid: string,
    at: string,
    parts: Record<string, Record<string, unknown>>,
  ) => {
    let { created = {}, ...comps } = parts
    return [
      { eid, name: 'entity', comp: { eid, num: num++ } },
      { eid, name: 'created', comp: { at, ...created } },
      ...Object.entries(comps).map(([name, comp]) => ({ eid, name, comp })),
    ]
  }
  let eid = (i: number) => `dddddddd-0000-4000-8000-0000000000${10 + i}`
  let OP = eid(0)
  let OTHER = eid(1) // a foreign actor
  let note = (
    eid: string,
    target: string,
    at: string,
    by = OTHER,
  ) =>
    mk(eid, at, {
      created: { by },
      doc: { title: '', body: 'words' },
      comment: { target_eid: target },
    })
  let base = [
    ...mk(eid(2), ago(0), { session: { id: 'u-new', actor_eid: OP } }),
    ...mk(eid(1), ago(50), { session: { id: 'u-other', actor_eid: OTHER } }),
    // wrapped 20h ago — birth floors what can be owed to it
    ...mk(eid(3), ago(20), { session: { id: 'u-old', actor_eid: OP } }),
    ...mk(eid(4), ago(30), { session: { id: 'u-older', actor_eid: OP } }),
    // beyond the week: out of "recent"
    ...mk(eid(5), ago(24 * 8), { session: { id: 'u-stale', actor_eid: OP } }),
  ]
  let g = (extra: Snapshot['changes']): Snapshot => ({
    changes: [...base, ...extra],
    deps: [],
  })
  // one session, two unheard: un-notified, and by another actor
  let one = g([
    ...note(eid(6), eid(3), ago(10)),
    ...note(eid(7), eid(3), ago(5)),
    ...note(eid(8), eid(3), ago(22)), // predates the session: void
    ...note(eid(10), eid(3), ago(3), OP), // own actor
    ...note(eid(11), eid(1), ago(2)), // another actor's session
    ...note(eid(12), eid(5), ago(1)), // too old a session
    // already served — the per-item stamp is what makes it heard, and it
    // sits between the two that count, so a cursor could not have hidden it
    ...note(eid(13), eid(3), ago(7)),
    { eid: eid(13), name: 'notified', comp: {} },
  ])
  let d = contextDigest(one, 'u-new', NOW)
  assertMatch(d, /## unheard — S-72 got 2 comments after it wrapped/)
  // two sessions aggregate on the one line, newest first; birth cuts off
  // the never-acked one
  let two = g([
    ...note(eid(6), eid(3), ago(10)),
    ...note(eid(7), eid(4), ago(8)),
    ...note(eid(8), eid(4), ago(31)), // before u-older existed: void
  ])
  assertMatch(
    contextDigest(two, 'u-new', NOW),
    /## unheard — comments after they wrapped: S-72 ×1, S-73 ×1/,
  )
  // nothing unheard, or no session at all: no line
  assertEquals(contextDigest(g([]), 'u-new', NOW).includes('unheard'), false)
  assertEquals(contextDigest(one, undefined, NOW).includes('unheard'), false)
})

// T-10612: a dropped @ stored the path as the whole body and the door
// printed its receipt. Two operators lost content to it independently.
Deno.test('inflate: a dropped @ on an existing file is refused, not stored', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  assertThrows(() => inflate(p(f)), Error, 'names a file that exists')
  assertThrows(() => inflate(p(f)), Error, `did you mean @${f}`)
  // The @ door still works, which is what earns the suggestion its place.
  assertEquals(inflate(p(`@${f}`)).value, 'the whole brief\n')
  Deno.removeSync(f)
})

Deno.test('inflate: the dropped-@ guard is too narrow to overshoot', () => {
  let f = Deno.makeTempFileSync()
  // A path that does NOT exist stays storable text.
  assertEquals(inflate(p('/no/such/file.md')).value, '/no/such/file.md')
  // Prose merely MENTIONING a path is prose — the token must stand alone.
  assertEquals(inflate(p(`see ${f} for it`)).value, `see ${f} for it`)
  // Only `body`: a filesystem path is the whole point of repo.path.
  assertEquals(inflate({ comp: 'repo', prop: 'path', value: f }).value, f)
  // A bare word never trips, even standing beside a file of that name. The
  // stat is the POSITIVE CONTROL: if cwd moved, this fails loudly rather
  // than passing because the file was simply absent.
  assertEquals(Deno.statSync('README.md').isFile, true)
  assertEquals(inflate(p('README.md')).value, 'README.md')
  Deno.removeSync(f)
})

// The body flag handed over AS the body. The dropped-@ guard cannot see it —
// '.body=@/tmp/x' does not stat as a file — so it sailed through as prose and
// mailed a launch-gating ruling as its own file path.
Deno.test('inflate: a body flag in the value position is refused, not stored', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  for (let said of [`.body=@${f}`, `--body=@${f}`, `body=@${f}`]) {
    assertThrows(() => inflate(p(said)), Error, 'body flag in the value')
    assertThrows(() => inflate(p(said)), Error, `Pass just '@${f}'`)
  }
  // The POSITIVE CONTROL for the suggestion: the remainder it names really
  // does read the file, so the error is not sending anyone to a dead door.
  assertEquals(inflate(p(`@${f}`)).value, 'the whole ruling\n')
  Deno.removeSync(f)
})

Deno.test('inflate: the body-flag guard is too narrow to overshoot', () => {
  // Prose that merely opens with the word is prose — the token must stand
  // alone, and these hold whitespace.
  assertEquals(inflate(p('.body=@x is the door')).value, '.body=@x is the door')
  // A remainder is required, so the bare flag stays storable as text.
  assertEquals(inflate(p('.body=')).value, '.body=')
  // Only `body`: another prop carrying the same shape is left alone.
  let other = { comp: 'repo', prop: 'path', value: '.body=@/tmp/x' }
  assertEquals(inflate(other).value, '.body=@/tmp/x')
  // It does not require the remainder to be a FILE: the content is lost
  // either way, and a stale path is exactly when a loud refusal earns most.
  assertThrows(() => inflate(p('.body=@/no/such/file.md')), Error, 'Pass just')
})

// T-10873: the last hole in the family — a body flag with a space instead of
// '='. Not a flag, not a dot-param, and two tokens, so every guard above is
// structurally blind to it.
Deno.test('separated: a body flag with a space instead of = is refused', () => {
  let f = Deno.makeTempFileSync()
  for (let flag of ['.body', '--body', '-body', 'body']) {
    assertThrows(
      () => separated([flag, `@${f}`]),
      Error,
      "space instead of '='",
    )
    assertThrows(() => separated([flag, f]), Error, `the body is '${f}'`)
  }
  Deno.removeSync(f)
})

Deno.test('separated: too narrow to touch prose', () => {
  let f = Deno.makeTempFileSync()
  // Three tokens is prose, whatever it opens with.
  assertEquals(separated(['.body', 'takes', 'a', 'file']), undefined)
  // A second token that is neither a reference nor a file it could have meant.
  assertEquals(separated(['.body', 'somenote']), undefined)
  // A first token that is not a body flag at all.
  assertEquals(separated(['.title', `@${f}`]), undefined)
  assertEquals(separated([f]), undefined)
  Deno.removeSync(f)
})
