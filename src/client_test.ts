// The headless client's pure half: dot-param grammar, row assembly,
// change builders, and the injection digest. No server, no db.
import {
  byBoard,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  find,
  hookClaim,
  lapseChanges,
  memoryChanges,
  notices,
  param,
  patches,
  recallIndex,
  rows,
  sessionFor,
  spawnChanges,
  spec,
  taskChanges,
} from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { idOf, kindOf, type Snapshot } from './types.ts'
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
  assertEquals(kindOf({}), 'entity')
})

// The grammar, as a case table: arg → routed {comp, prop, value} or error.
let CASES: [string, { comp: string; prop: string; value: unknown } | RegExp][] =
  [
    ['.title=Hi', { comp: 'doc', prop: 'title', value: 'Hi' }],
    ['.status=done', { comp: 'task', prop: 'status', value: 'done' }],
    ['.domain=Eng', { comp: 'task', prop: 'domain', value: 'Eng' }],
    ['.priority=1.5', { comp: 'task', prop: 'priority', value: 1.5 }],
    ['.pin.x=12', { comp: 'pin', prop: 'x', value: 12 }],
    ['.x=12', /ambiguous/],
    ['.nope=1', /unknown prop/],
    ['.doc.nope=1', /no such prop/],
  ]
Deno.test('dot-param routing', () => {
  for (let [arg, want] of CASES) {
    if (want instanceof RegExp) {
      assertThrows(() => param(arg), Error, undefined, arg)
    } else assertEquals(param(arg), want, arg)
  }
  assertEquals(param('bare word'), null)
  assertEquals(patches([param('.title=a')!, param('.status=b')!]), {
    doc: { title: 'a' },
    task: { status: 'b' },
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
  let mk = (
    eid: string,
    target: string,
    author: string,
    at: string,
    body: string,
  ) => [
    { eid, name: 'entity', comp: { eid, num: 90, created_at: at } },
    { eid, name: 'doc', comp: { title: '', body } },
    { eid, name: 'comment', comp: { target_eid: target, author_eid: author } },
  ]
  let busSnap: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: B, name: 'entity', comp: { eid: B, num: 80, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b' } },
      // on the claimed task, after the cutoff: heard
      ...mk('c-1', T1, B, '2026-01-02', 'heads up'),
      // aimed at the session itself: heard (a message TO sess-x)
      ...mk('c-2', S, B, '2026-01-03', 'ping'),
      // authored by the listener: never echoed back
      ...mk('c-3', T1, S, '2026-01-04', 'my own note'),
      // on an unclaimed task: not ours to hear
      ...mk('c-4', T2, B, '2026-01-05', 'elsewhere'),
    ],
    deps: snap.deps,
  }
  let n = notices(busSnap, 'sess-x')
  assertEquals(n.lines.length, 2)
  assertEquals(n.lines[0].includes('heads up'), true)
  assertEquals(n.lines[1].includes('sess-b: ping'), true)
  assertEquals(n.ack[0].name, 'session')
  assertEquals(typeof n.ack[0].comp?.acked_at, 'string')
  // the cursor silences what was served
  let acked: Snapshot = {
    changes: busSnap.changes.map((c) =>
      c.eid == S && c.name == 'session'
        ? { ...c, comp: { ...c.comp, acked_at: '2026-01-03' } }
        : c
    ),
    deps: snap.deps,
  }
  assertEquals(notices(acked, 'sess-x').lines.length, 0)
  // unknown session: silent, no ack
  assertEquals(notices(busSnap, 'sess-nobody'), { lines: [], ack: [] })
})

Deno.test('rows filter through the query grammar + byBoard', () => {
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=wip')), true)
  assertEquals(matchQuery(by(T1).comps, parseQuery('.status=done')), false)
  assertEquals([...all.filter((r) => r.comps.task)].sort(byBoard)[0].eid, T2) // open before wip
})

Deno.test('taskChanges: defaults + grouped comps ride along', () => {
  let cs = taskChanges('E', { doc: { title: 'x' }, pin: { x: 1 } })
  assertEquals(cs.map((c) => c.name), ['doc', 'task', 'pin'])
  assertEquals(cs[0].comp, { body: '', title: 'x' })
  assertEquals(cs[1].comp?.status, 'open')
})

Deno.test('sessionFor: reuse, mint, cwd refresh', () => {
  assertEquals(sessionFor(all, 'sess-x').changes, []) // known, same cwd
  assertEquals(sessionFor(all, 'sess-x', '/elsewhere').changes.length, 1) // cwd moved
  let minted = sessionFor(all, 'sess-new', '/w2')
  assertEquals(minted.changes[0].comp, { id: 'sess-new', cwd: '/w2' })
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

Deno.test('hookClaim: an unclaimed task claims, anything else is quiet', () => {
  assertEquals(hookClaim(all, 'T-3', 'sess-x', '/w'), [
    { eid: T2, name: 'claim', comp: { session_eid: S } },
  ])
  assertEquals(hookClaim(all, 'T-2', 'sess-x'), []) // already held
  assertEquals(hookClaim(all, 'T-99', 'sess-x'), []) // no such task
  assertEquals(hookClaim(all, undefined, 'sess-x'), []) // no TASKS_TASK
})

Deno.test('commentChanges: doc + aim, attributed or anon', () => {
  let cs = commentChanges(all, T1, 'hi', 'sess-x')
  assertEquals(cs.length, 2)
  assertEquals(cs[1].comp?.author_eid, S)
  assertEquals(commentChanges(all, T1, 'hi')[1].comp?.author_eid, null)
})

Deno.test('claimant resolves through the session entity', () => {
  assertEquals(claimant(all, by(T1)), 'sess-x')
  assertEquals(claimant(all, by(T2)), undefined)
})

Deno.test('lapseChanges: unfinished gets the trail, done goes quiet', () => {
  let cs = lapseChanges(all, 'sess-x') // T1 is wip → comment + release
  assertEquals(cs.filter((c) => c.name == 'claim').length, 1)
  assertEquals(cs.filter((c) => c.name == 'comment').length, 1)
  let done = structuredClone(snap)
  done.changes.find((c) => c.eid == T1 && c.name == 'task')!.comp!.status =
    'done'
  let quiet = lapseChanges(rows(done), 'sess-x')
  assertEquals(quiet, [{ eid: T1, name: 'claim', comp: null }])
  assertEquals(lapseChanges(all, 'sess-unknown'), [])
})

Deno.test('contextDigest: claimed set with gates, or open board', () => {
  let d = contextDigest(snap, 'sess-x')
  assertEquals(d.split('\n').length <= 20, true)
  assertEquals(d.includes('T-2'), true)
  assertEquals(d.includes('requires → T-3 (open)'), true)
  let fresh = contextDigest(snap, 'sess-nobody')
  assertEquals(fresh.includes('nothing claimed'), true)
  assertEquals(fresh.includes('T-3'), true) // open unclaimed work suggested
})

Deno.test('spec: a typed task — leading P, params anywhere, body below', () => {
  let s = spec('P1 .domain=Eng Build a thing blah blah\nline two\nline three')
  assertEquals(s.title, 'Build a thing blah blah')
  assertEquals(s.body, 'line two\nline three')
  assertEquals(s.grouped.task, { priority: 1, domain: 'Eng' })
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

// ---- the memory doors' pure halves ----

Deno.test('memoryChanges: doc face + memory comp, sourced and scoped', () => {
  let { changes } = memoryChanges(all, {
    title: 'Prefers terse tests',
    type: 'feedback',
    scope: 'T-3',
    session: 'sess-x',
  })
  assertEquals(changes.length, 2) // the session exists: nothing minted
  assertEquals(changes[0].comp?.title, 'Prefers terse tests')
  assertEquals(changes[1].name, 'memory')
  assertEquals(changes[1].comp?.source_eid, S)
  assertEquals(changes[1].comp?.scope_eid, T2)
  assertThrows(() =>
    memoryChanges(all, { title: 'x', scope: 'P-99', session: 'sess-x' })
  )
})

Deno.test('memoryChanges: an unknown session is minted alongside', () => {
  let { changes } = memoryChanges(all, { title: 'x', session: 'newcomer' })
  assertEquals(changes.length, 3)
  assertEquals(changes[0].name, 'session')
  assertEquals(changes[2].comp?.source_eid, changes[0].eid)
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
      { eid: M1, name: 'memory', comp: { type: 'project' } },
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
        comp: { type: 'feedback', last_confirmed_at: at(D) },
      },
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
  assertEquals(recallIndex(mems, parseQuery('.type=project'), NOW).length, 1)
})
