// The subscription seam, proven without a socket: the §2 membership transition
// and the comps→Changes spread. Run: deno test src/subs_test.ts
import { assertEquals } from '@std/assert'
import { matchQuery, parseQuery } from './query.ts'
import { diff, gaps, spread, type Step, step } from './subs.ts'

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

Deno.test('agreement gaps are only paths and moving time', () => {
  let cases: [string, string[]][] = [
    ['.status=open', []],
    ['.domain=Ops,Eng', []],
    ['.priority=1..3', []],
    ['.status!=done', []],
    ['.title~=flux', []],
    ['.created.at=2026-07-01', []],
    ['.order=hot', []],
    ['.assignee.title~=jeff', ['path']],
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
  let cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['.status=open', { status: 'open' }, { status: 'done' }],
    ['.domain=Ops,Eng', { domain: 'Ops' }, { domain: 'Web' }],
    ['.priority=1..3', { priority: 3 }, { priority: 4 }],
    ['.status!=done', { status: 'open' }, { status: 'done' }],
    ['.priority>=2', { priority: 2 }, { priority: 1 }],
    ['.title~=flux', { title: 'Flux gate' }, { title: 'Warp gate' }],
  ]
  for (let [q, inside, outside] of cases) {
    let members = new Set<string>()
    let matches = (v: Record<string, unknown>) =>
      matchQuery(
        q.includes('title') ? { doc: v } : { task: v },
        parseQuery(q),
      )
    assertEquals(step(members, 'e1', true, matches(inside)), 'add', q)
    assertEquals(step(members, 'e1', true, matches(outside)), 'remove', q)
    assertEquals(step(members, 'e1', true, matches(inside)), 'add', q)
    assertEquals([...members], ['e1'], q)
  }
})
