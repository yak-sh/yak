// The subscription seam, proven without a socket: the §2 membership transition
// and the comps→Changes spread. Run: deno test src/subs_test.ts
import { assertEquals } from '@std/assert'
import { spread, type Step, step } from './subs.ts'

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
