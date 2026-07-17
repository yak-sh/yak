// The headless client's pure half: dot-param grammar, row assembly,
// change builders, and the injection digest. No server, no db.
import {
  byBoard,
  claimant,
  claimChanges,
  commentChanges,
  contextDigest,
  find,
  lapseChanges,
  param,
  patches,
  rows,
  sessionFor,
  taskChanges,
} from './client.ts'
import { matchQuery, parseQuery } from './query.ts'
import { idOf, kindOf, type Snapshot } from './types.ts'
import { assertEquals, assertThrows } from '@std/assert'

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
