// The : command line's pure half: every verb, the :open disambiguation,
// and what a bad line says. No wire, no DOM — a Ctx is just data.
import { run, type Verb } from './commands.ts'
import { rows } from './client.ts'
import { type Snapshot } from './types.ts'
import { assertEquals, assertThrows } from '@std/assert'

let S = 'aaaaaaaa-0000-4000-8000-000000000001' // session sess-x
let P = 'aaaaaaaa-0000-4000-8000-000000000002' // project P-2
let B = 'aaaaaaaa-0000-4000-8000-000000000003' // board over P
let T = 'aaaaaaaa-0000-4000-8000-000000000004' // an open task on P
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/

let snap: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x' } },
    { eid: P, name: 'entity', comp: { eid: P, num: 2, created_at: '' } },
    { eid: P, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: B, name: 'entity', comp: { eid: B, num: 3, created_at: '' } },
    { eid: B, name: 'doc', comp: { title: 'Board', body: '' } },
    { eid: B, name: 'board', comp: { query: `.project_eid=${P}&.domain=Eng` } },
    { eid: T, name: 'entity', comp: { eid: T, num: 4, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'A task', body: '' } },
    {
      eid: T,
      name: 'task',
      comp: { status: 'open', priority: 0, project_eid: P },
    },
  ],
  deps: [],
}
let all = rows(snap)
let ctx = (eid?: string, session?: string) => ({ eid, rows: all, session })
// A verb's changes, keyed by component — what most cases actually assert.
let comps = (line: string, eid?: string, session?: string) =>
  Object.fromEntries(
    (run(line, ctx(eid, session)).changes ?? []).map((c) => [c.name, c.comp]),
  )
Deno.test('new: a task, inheriting where you stand', () => {
  // On a board: the query's scalar equalities ride along, so it JOINS it.
  assertEquals(comps('new Ship it', B), {
    doc: { body: '', title: 'Ship it' },
    task: { status: 'open', project_eid: P, domain: 'Eng' },
  })
  assertEquals(comps('new Ship it', P).task, { status: 'open', project_eid: P })
  assertEquals(comps('new Ship it', T).task, { status: 'open', project_eid: P })
  assertEquals(comps('new Ship it').task, { status: 'open' }) // no context
  // the spec grammar tokenizes, so runs of spaces normalize to one
  assertEquals(
    run('new  Two  words ', ctx(B)).changes![0].comp!.title,
    'Two words',
  )
  // …and setters in the line win over what the context hands down
  assertEquals(comps('new P2 .domain=Ops Ship it', B).task, {
    status: 'open',
    project_eid: P,
    domain: 'Ops',
    priority: 2,
  })
  // One client-minted eid names the whole new entity.
  let cs = run('new Ship it', ctx(B)).changes!
  assertEquals(UUID.test(cs[0].eid), true)
  assertEquals(cs.every((c) => c.eid == cs[0].eid), true)
  assertThrows(() => run('new', ctx(B)), Error, 'needs a title')
})

Deno.test('status moves land on the focused task', () => {
  for (let s of ['done', 'wip', 'open']) {
    assertEquals(run(s, ctx(T)).changes, [
      { eid: T, name: 'task', comp: { status: s } },
    ])
  }
  assertEquals(run('done', ctx(T)).msg, 'T-4 → done')
  assertThrows(() => run('done', ctx(B)), Error, 'B-3 is not a task')
  assertThrows(() => run('done', ctx()), Error, 'nothing focused')
})

Deno.test('open: an argument navigates, none is the status move', () => {
  assertEquals(run('open T-4', ctx()).go, T) // no focus needed to navigate
  assertEquals(run('open 4', ctx()).go, T) // bare num
  assertEquals(run(`open ${T}`, ctx()).go, T) // eid
  assertEquals(run('open B-3', ctx(T)).go, B) // argument wins over the move
  assertEquals(run('open', ctx(T)).changes![0].comp, { status: 'open' })
  assertEquals(run('open', ctx(T)).go, undefined)
  assertThrows(() => run('open T-99', ctx()), Error, 'no such entity: T-99')
})

Deno.test('claim: names a session, or takes the ambient one', () => {
  assertEquals(run('claim sess-x', ctx(T)).changes, [
    { eid: T, name: 'claim', comp: { session_eid: S } }, // known: no mint
  ])
  // An unknown session is minted, and the claim points at the new entity.
  let minted = run('claim sess-new', ctx(T)).changes!
  assertEquals(minted[0].name, 'session')
  assertEquals(minted[0].comp, { id: 'sess-new' })
  assertEquals(UUID.test(minted[0].eid), true)
  assertEquals(minted[1].comp, { session_eid: minted[0].eid })
  assertEquals(run('claim', ctx(T, 'sess-x')).changes!.length, 1) // ambient
  assertThrows(() => run('claim', ctx(T)), Error, 'name a session')
})

Deno.test('set: the write grammar, routed and grouped', () => {
  assertEquals(comps('set .status=done .priority=2', T), {
    task: { status: 'done', priority: 2 },
  })
  assertEquals(comps('set .title=two words .status=wip', T), {
    doc: { title: 'two words' }, // params start at a dot: spaces survive
    task: { status: 'wip' },
  })
  assertEquals(run('set .status=done', ctx(T)).msg, 'T-4 .status=done')
  assertThrows(() => run('set .nope=1', ctx(T)), Error, 'unknown prop')
  assertThrows(() => run('set .x=1', ctx(T)), Error, 'ambiguous')
  assertThrows(() => run('set .doc.nope=1', ctx(T)), Error, 'no such prop')
  assertThrows(() => run('set title=x', ctx(T)), Error, 'not a param: title=x')
  assertThrows(() => run('set', ctx(T)), Error, 'needs .prop=value')
})

Deno.test('dispatch: unknown names say so, local verbs ride, empty is a no-op', () => {
  assertThrows(() => run('nope', ctx(T)), Error, 'not a command: nope')
  assertEquals(run('', ctx(T)), {})
  assertEquals(run('   ', ctx(T)), {})
  let zoom: Verb = (rest) => ({ msg: `zoom ${rest}` })
  assertEquals(run('zoom 2', ctx(T), { zoom }).msg, 'zoom 2')
})
