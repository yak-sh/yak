// The headless client's pure half: dot-param grammar, row assembly,
// change builders, and the injection digest. No server, no db.
import {
  byBoard,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  derefParams,
  edgesOf,
  find,
  hookClaim,
  inflate,
  lapseChanges,
  ledger,
  memoryChanges,
  notices,
  param,
  patches,
  reasoned,
  recallIndex,
  rows,
  sessionFor,
  showMd,
  spawnChanges,
  spawnDefaults,
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

Deno.test('spawnChanges: the actor chain — inherit the caller, persona owner wins', () => {
  let J = 'aaaaaaaa-0000-4000-8000-000000000021' // person
  let O = 'aaaaaaaa-0000-4000-8000-000000000022' // operator project
  let P = 'aaaaaaaa-0000-4000-8000-000000000023' // persona O contains
  let Q = 'aaaaaaaa-0000-4000-8000-000000000024' // persona about O
  let R = 'aaaaaaaa-0000-4000-8000-000000000025' // unowned persona
  let W = 'aaaaaaaa-0000-4000-8000-000000000026' // caller session
  let T = 'aaaaaaaa-0000-4000-8000-000000000027' // task
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
  // no persona: the child works for whoever the caller works for
  assertEquals(spawn()?.actor_eid, J)
  // a persona owned by an operator: the spawn acts AS the operator,
  // whichever way the ownership edge is spelled
  assertEquals(spawn({ persona: P })?.actor_eid, O)
  assertEquals(spawn({ persona: Q })?.actor_eid, O)
  // an unowned persona changes nothing — inheritance still holds
  assertEquals(spawn({ persona: R })?.actor_eid, J)
  // no caller, no owner: the spawn stays unattributed
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
  // finished work releases without a comment — only the brief rides along
  // (fixture S is docless and held a claim, so it earns the stub)
  assertEquals(quiet.filter((c) => c.name == 'comment'), [])
  assertEquals(quiet[0], { eid: T1, name: 'claim', comp: null })
  assertEquals(lapseChanges(all, 'sess-unknown'), [])
})

Deno.test('lapse brief: a docless working session gets the stub', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = lapseChanges(all, 'sess-x', AT)
    .find((c) => c.name == 'doc' && c.eid == S)
  assertEquals(doc?.comp?.title, 'Work session 2026-07-20')
  assertMatch(String(doc?.comp?.body), /- T-2 \(wip\) First/)
  // a session that already wrote its brief keeps it
  let named = structuredClone(snap)
  named.changes.push({ eid: S, name: 'doc', comp: { title: 'Mine', body: '' } })
  assertEquals(
    lapseChanges(rows(named), 'sess-x', AT)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
  // an idle session — no claims, no comments — leaves nothing behind
  let idle = structuredClone(snap)
  idle.changes = idle.changes.filter((c) => c.name != 'claim')
  assertEquals(lapseChanges(rows(idle), 'sess-x', AT), [])
})

Deno.test('spawnDefaults: the caller session lends its provider/model', () => {
  let mine = structuredClone(snap)
  mine.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    provider: 'claude',
    model: 'opus',
  }
  assertEquals(spawnDefaults(rows(mine), 'sess-x'), {
    provider: 'claude',
    model: 'opus',
  })
  // a row with neither, an unknown session, no session: all default to none
  let none = { provider: undefined, model: undefined }
  assertEquals(spawnDefaults(all, 'sess-x'), none)
  assertEquals(spawnDefaults(all, 'sess-unknown'), none)
  assertEquals(spawnDefaults(all), none)
})

Deno.test('reasoned: the journal pseudo-change, one shape everywhere', () => {
  assertEquals(reasoned(T1, 'why not'), {
    eid: T1,
    name: 'journal',
    comp: { reason: 'why not' },
  })
})

Deno.test('contextDigest: claimed set with gates, or open board', () => {
  let d = contextDigest(snap, 'sess-x')
  assertEquals(d.split('\n').length <= 20, true)
  assertEquals(d.includes('T-2'), true)
  assertEquals(d.includes('requires → T-3 (open)'), true)
  let fresh = contextDigest(snap, 'sess-nobody')
  assertEquals(fresh.includes('nothing claimed'), true)
  assertEquals(fresh.includes('T-3'), true) // open unclaimed work suggested
  // the shared fixture carries no modified_at — nothing is recent, so the
  // lately tier says nothing at all
  assertEquals(d.includes('lately:'), false)
})

// The lately tier against a fixed clock: work-session briefs lead with
// their first body line, today and this-week tier by age, memories close
// as index lines, and anything older than a week (or any comment) never
// appears.
Deno.test('contextDigest: lately — briefs lead, tiers hold, old is silent', () => {
  let NOW = Date.parse('2026-07-20T12:00:00Z')
  let ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
  let num = 30
  let mk = (
    eid: string,
    mod: string,
    parts: Record<string, Record<string, unknown>>,
  ) => [
    {
      eid,
      name: 'entity',
      comp: { eid, num: num++, created_at: mod, modified_at: mod },
    },
    ...Object.entries(parts).map(([name, comp]) => ({ eid, name, comp })),
  ]
  let eid = (i: number) => `bbbbbbbb-0000-4000-8000-00000000000${i}`
  let late: Snapshot = {
    changes: [
      ...mk(eid(1), ago(2), {
        session: { id: 'ws-brief' },
        doc: { title: 'Work session', body: 'landed: everything\nmore below' },
      }),
      ...mk(eid(2), ago(1), {
        doc: { title: 'Fresh task', body: '' },
        task: { status: 'done', priority: 0 },
      }),
      // done, deliberately: an open unclaimed task would ALSO surface in
      // the open-work suggestions above lately, and this test reads line
      // order
      ...mk(eid(3), ago(70), {
        doc: { title: 'Midweek task', body: '' },
        task: { status: 'done', priority: 1 },
      }),
      ...mk(eid(4), ago(30), {
        doc: { title: 'A kept fact', body: 'the fact' },
        memory: { type: 'project' },
      }),
      ...mk(eid(5), ago(3), {
        doc: { title: 'Noise', body: '' },
        comment: { target_eid: eid(2) },
      }),
      ...mk(eid(6), ago(24 * 30), {
        doc: { title: 'Ancient history', body: '' },
        task: { status: 'done', priority: 0 },
      }),
    ],
    deps: [],
  }
  let d = contextDigest(late, 'sess-nobody', NOW)
  let lines = d.split('\n')
  assertEquals(lines.length <= 35, true)
  assertEquals(d.includes('lately:'), true)
  // the brief leads, wearing its first body line
  let brief = lines.findIndex((l) => l.includes('Work session'))
  assertEquals(lines[brief].includes('landed: everything'), true)
  assertEquals(brief < lines.findIndex((l) => l.includes('Fresh task')), true)
  // tiers: midweek under its header, memory as an index line
  assertEquals(
    lines.indexOf('  this week:') <
      lines.findIndex((l) => l.includes('Midweek task')),
    true,
  )
  assertEquals(
    lines.indexOf('  memory:') <
      lines.findIndex((l) => l.includes('A kept fact')),
    true,
  )
  // silence: comments and the older-than-a-week
  assertEquals(d.includes('Noise'), false)
  assertEquals(d.includes('Ancient history'), false)
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

Deno.test('derefParams: reference values resolve at the door', () => {
  let one = (s: string) => derefParams(all, [param(s)!])[0].value
  assertEquals(one('.assignee=old-board-slug'), T2) // alias slug
  assertEquals(one('.assignee=T-2'), T1) // human id
  assertEquals(one('.assignee=3'), T2) // bare num
  assertEquals(one(`.assignee=${T1}`), T1) // an eid passes through
  assertEquals(one('.assignee='), '') // a clear stays a clear
  assertEquals(one('.title=jeff'), 'jeff') // not a reference
  assertThrows(() => one('.assignee=ghost'), Error, 'no entity')
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
  let md = showMd(snap, all, by(T1))
  assertMatch(md, /^---\nid: T-2\nkind: task\n/)
  assertMatch(md, /status: wip/)
  assertMatch(md, /claim: sess-x/) // the holder's session id, not an eid
  assertMatch(md, /requires:\n {2}- T-3 \(open\) — Second/)
  assertMatch(md, /# First/)
  assertEquals(md.includes('aaaaaaaa'), false) // no uuid reaches the reader
  let back = showMd(snap, all, by(T2))
  assertMatch(back, /referenced by:\n {2}- T-2 \(wip\) — First · requires this/)
})

Deno.test('showMd: comments ride as a section, oldest first', () => {
  let C = 'aaaaaaaa-0000-4000-8000-000000000009'
  let snap2: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: C, name: 'entity', comp: { eid: C, num: 9, created_at: '2t' } },
      { eid: C, name: 'doc', comp: { title: '', body: 'a remark' } },
      { eid: C, name: 'comment', comp: { target_eid: T1, author_eid: S } },
    ],
    deps: snap.deps,
  }
  let all2 = rows(snap2)
  let md = showMd(snap2, all2, all2.find((r) => r.eid == T1)!)
  assertMatch(md, /## Comments\n\n— 2t · S-1 — sess-x\n\na remark/)
})

Deno.test('grammar: the teaching text derives from the vocabulary', async () => {
  let { GRAMMAR, FILTERS } = await import('./grammar.ts')
  assertMatch(GRAMMAR, /status\(open\|wip\|done\|cancelled\)/)
  assertMatch(GRAMMAR, /Statuses: open, wip, done, cancelled/)
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

Deno.test('lapse: the stub carries the ledger; a hand-written brief is never clobbered', () => {
  let AT = Date.UTC(2026, 6, 20)
  let doc = lapseChanges(all, 'sess-x', AT, DAY)
    .find((c) => c.name == 'doc' && c.eid == S)
  let body = String(doc?.comp?.body)
  assertMatch(body, /^Auto-written at lapse/)
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
      body: 'Auto-written at lapse — old stub',
    },
  })
  let re = lapseChanges(rows(stubbed), 'sess-x', AT, DAY)
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
    lapseChanges(rows(prose), 'sess-x', AT, DAY)
      .some((c) => c.name == 'doc' && c.eid == S),
    false,
  )
})

Deno.test('notices: bylines walk the actor chain', () => {
  let B = 'aaaaaaaa-0000-4000-8000-000000000010'
  let P = 'aaaaaaaa-0000-4000-8000-000000000011' // the operator project
  let mk = (eid: string, author: string) => [
    { eid, name: 'entity', comp: { eid, num: 91, created_at: '2026-01-02' } },
    { eid, name: 'doc', comp: { title: '', body: 'from the operator' } },
    { eid, name: 'comment', comp: { target_eid: T1, author_eid: author } },
  ]
  let s: Snapshot = {
    changes: [
      ...snap.changes,
      { eid: P, name: 'entity', comp: { eid: P, num: 81, created_at: '' } },
      { eid: P, name: 'doc', comp: { title: 'Task Graph', body: '' } },
      { eid: P, name: 'project', comp: {} },
      { eid: B, name: 'entity', comp: { eid: B, num: 82, created_at: '' } },
      { eid: B, name: 'session', comp: { id: 'sess-b', actor_eid: P } },
      ...mk('c-9', B),
    ],
    deps: snap.deps,
  }
  let [line] = notices(s, 'sess-x').lines
  assertMatch(line, /Task Graph · via S-82/) // operator, not session id
})

Deno.test('contextDigest: sessionless is the preview — headed as one, claim line templated', () => {
  let d = contextDigest(snap)
  assertEquals(d.startsWith('tasks · a preview'), true)
  assertEquals(d.includes('task claim <id> <session>'), true)
  assertEquals(d.includes('nothing claimed'), true)
})

// The project-aware digest: scope narrows suggestions and lately to the
// project you stand in; unscoped memories and your claims always ride.
Deno.test('contextDigest: scope — local work, local+principle memory, cwd derives', () => {
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
    {
      eid,
      name: 'entity',
      comp: { eid, num, created_at: '', modified_at: hour },
    },
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
  assertEquals(d.includes('A lesson'), true)
  assertEquals(d.includes('A principle'), true) // unscoped memory rides
  assertEquals(d.includes('B lesson'), false)
  // a session's own cwd derives the same scope
  let s = contextDigest(g, 'sess-in-a', NOW)
  assertEquals(s.includes('· P-1 Alpha'), true)
  assertEquals(s.includes('B work'), false)
  // no scope: the fleet view, both works suggested
  let f = contextDigest(g, undefined, NOW)
  assertEquals(f.includes('A work') && f.includes('B work'), true)
})

Deno.test('inflate: @ reads the file loudly, @@ is a literal, plain rides', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  let p = (value: string) => ({ comp: 'doc', prop: 'body', value })
  assertEquals(inflate(p(`@${f}`)).value, 'the whole brief\n')
  assertEquals(inflate(p('@@handle')).value, '@handle')
  assertEquals(inflate(p('plain')).value, 'plain')
  assertThrows(() => inflate(p('@/no/such/file')), Error, 'no such file')
  Deno.removeSync(f)
})
