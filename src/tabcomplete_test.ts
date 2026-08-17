// complete() draws its candidates from the one declaration table, so these
// cases double as a check that the table stays completable.
import { assertArrayIncludes, assertEquals } from '@std/assert'
import { complete } from './tabcomplete.ts'

let ids = () => ['T-1', 'T-2']

Deno.test('tab: word 0 offers verbs, plural kinds and :commands', () => {
  let all = complete([''])
  assertArrayIncludes(all, ['claim', 'spawn', 'list', 'tasks', ':fix', ':new'])
})

Deno.test('tab: word 0 filters by prefix', () => {
  let out = complete(['cl'])
  assertArrayIncludes(out, ['claim', 'claude'])
  assertEquals(out.every((c) => c.startsWith('cl')), true)
})

Deno.test('tab: an id positional completes to the graph ids', () => {
  assertEquals(complete(['claim', ''], ids), ['T-1', 'T-2'])
  assertEquals(complete(['claim', 'T-1'], ids), ['T-1'])
  // offline (no ids) still returns nothing rather than throwing
  assertEquals(complete(['claim', '']), [])
})

Deno.test('tab: a parent verb offers its subcommands', () => {
  assertArrayIncludes(complete(['mail', '']), ['send', 'show', 'reply'])
  assertArrayIncludes(complete(['role', '']), ['stop', 'start'])
})

Deno.test('tab: an option name completes, minus those already given', () => {
  assertArrayIncludes(complete(['spawn', 'T-3', '--']), ['--model', '--effort'])
  let rest = complete(['spawn', 'T-3', '--effort=high', '--'])
  assertEquals(rest.includes('--effort'), false)
  assertArrayIncludes(rest, ['--model'])
})

Deno.test('tab: after --model= the value set completes', () => {
  let out = complete(['spawn', 'T-3', '--model='])
  assertEquals(out.length > 0, true)
  assertEquals(out.every((c) => c.startsWith('--model=')), true)
})

Deno.test('tab: an unknown verb completes to nothing', () => {
  assertEquals(complete(['nope', '']), [])
})
