// The subscription seam, proven without a socket: the §2 membership transition
// and the comps→Changes spread. Run: deno test src/subs_test.ts
import { assertEquals } from '@std/assert'
import { matchQuery, parseQuery } from './query.ts'
import {
  bodied,
  bodyless,
  diff,
  gaps,
  spread,
  type Step,
  step,
} from './subs.ts'

// One step, reading the verb AND the resulting membership — the Set is the
// bookkeeping, so a test asserts both.
let run = (
  members: Set<string>,
  eid: string,
  alive: boolean,
  matches: boolean,
): [Step, string[]] => [step(members, eid, alive, matches), [...members]]

Deno.test('ADD: a fresh match joins the set', () => {
  assertEquals(run(new Set(), 'e1', true, true), ['add', ['e1']])
})

Deno.test('UPDATE: a standing match stays', () => {
  assertEquals(run(new Set(['e1']), 'e1', true, true), ['update', ['e1']])
})

Deno.test('REMOVE: a lost match leaves the set (→ a drop)', () => {
  assertEquals(run(new Set(['e1']), 'e1', true, false), ['remove', []])
})

Deno.test('IGNORE: a non-member that still does not match', () => {
  assertEquals(run(new Set(), 'e1', true, false), ['ignore', []])
})

Deno.test('DEAD: a member entity-nulled forwards the death', () => {
  assertEquals(run(new Set(['e1']), 'e1', false, false), ['dead', []])
})

Deno.test('IGNORE: a death for a non-member is nothing to this sub', () => {
  assertEquals(run(new Set(['e2']), 'e1', false, false), ['ignore', ['e2']])
})

Deno.test('spread turns comps into a Change batch, entity riding too', () => {
  assertEquals(
    spread('e1', { entity: { eid: 'e1', num: 7 }, doc: { title: 'hi' } }),
    [
      { eid: 'e1', name: 'entity', comp: { eid: 'e1', num: 7 } },
      { eid: 'e1', name: 'doc', comp: { title: 'hi' } },
    ],
  )
})

Deno.test('only whole-entity subscriptions carry bodies', () => {
  for (let sub of ['card:e1', 'route:T-3', 'entries:S-3']) {
    assertEquals(bodied(sub), true, sub)
  }
  for (
    let sub of ['board:e1', 'shape:canvas', 'refs:e1', 'canvas=e1', '', 'card']
  ) assertEquals(bodied(sub), false, sub)
})

Deno.test('the bodyless projection drops declared bodies, keeps the rest', () => {
  assertEquals(
    bodyless([
      { eid: 'e1', name: 'entity', comp: { eid: 'e1', num: 7 } },
      { eid: 'e1', name: 'doc', comp: { title: 'hi', body: 'long' } },
      { eid: 'e1', name: 'task', comp: {} },
      { eid: 'e1', name: 'session', comp: { status: 'done', final_text: 'x' } },
      { eid: 'e1', name: 'doc', comp: { body: 'the whole patch' } },
      { eid: 'e1', name: 'entity', comp: null },
    ]),
    [
      { eid: 'e1', name: 'entity', comp: { eid: 'e1', num: 7 } },
      { eid: 'e1', name: 'doc', comp: { title: 'hi' } },
      { eid: 'e1', name: 'task', comp: {} },
      { eid: 'e1', name: 'session', comp: { status: 'done' } },
      // a patch that was only a body says nothing at all
      { eid: 'e1', name: 'entity', comp: null },
    ],
  )
})

// A precondition rides BESIDE comp, so the projection must SPREAD what it
// touches: a rebuilt Change would drop the guard and land unguarded.
Deno.test('the projection carries a precondition through', () => {
  assertEquals(
    bodyless([{
      eid: 'e1',
      name: 'doc',
      comp: { title: 'hi', body: 'long' },
      was: { title: 'abc' },
    }]),
    [{ eid: 'e1', name: 'doc', comp: { title: 'hi' }, was: { title: 'abc' } }],
  )
})

Deno.test('the only agreement gap is moving time', () => {
  let cases: [string, string[]][] = [
    ['.status=open', []],
    ['.domain=Ops,Eng', []],
    ['.priority=1..3', []],
    ['.status!=done', []],
    ['.title~=flux', []],
    ['.created.at=2026-07-01', []],
    ['.order=hot', []],
    ['.assignee.title~=jeff', []],
    ['.updated.at=today', ['moving-time']],
    ['.updated.at>="1 hour ago"', ['moving-time']],
  ]
  for (let [q, want] of cases) assertEquals(gaps(parseQuery(q)), want, q)
})

Deno.test('agreement diff names both sides once and in order', () => {
  assertEquals(diff(['c', 'a', 'c'], ['b', 'c']), {
    scanOnly: ['a'],
    subOnly: ['b'],
  })
})

// The server's touched-row protocol uses this exact match → step seam. Each
// supported operator moves one member out, then back in.
Deno.test('own-component operators maintain subscription membership', () => {
  // Whole comp bags now: status is DERIVED (D-24102), so `done` is the completed
  // mark riding beside the task comp, never a task column.
  let cases: [
    string,
    Record<string, Record<string, unknown>>,
    Record<string, Record<string, unknown>>,
  ][] = [
    ['.status=open', { task: {} }, { task: {}, completed: {} }],
    ['.domain=Ops,Eng', { task: { domain: 'Ops' } }, {
      task: { domain: 'Web' },
    }],
    ['.priority=1..3', { task: { priority: 3 } }, { task: { priority: 4 } }],
    ['.status!=done', { task: {} }, { task: {}, completed: {} }],
    ['.priority>=2', { task: { priority: 2 } }, { task: { priority: 1 } }],
    ['.title~=flux', { doc: { title: 'Flux gate' } }, {
      doc: { title: 'Warp gate' },
    }],
  ]
  for (let [q, inside, outside] of cases) {
    let members = new Set<string>()
    let matches = (v: Record<string, Record<string, unknown>>) =>
      matchQuery(v, parseQuery(q))
    assertEquals(step(members, 'e1', true, matches(inside)), 'add', q)
    assertEquals(step(members, 'e1', true, matches(outside)), 'remove', q)
    assertEquals(step(members, 'e1', true, matches(inside)), 'add', q)
    assertEquals([...members], ['e1'], q)
  }
})
