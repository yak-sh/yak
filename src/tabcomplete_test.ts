// complete() draws its candidates from the one declaration table, so these
// cases double as a check that the table stays completable.
import { assertArrayIncludes, assertEquals } from '@std/assert'
import { complete } from './tabcomplete.ts'
import { arm } from './client.ts'

// The spawn catalog is graph data, completed through the local read arm the
// CLI arms beside the graph file (localread.ts). Away from a graph there is
// nothing to complete, which is its own case below.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { catalog } = await import('./catalog.ts')

let ids = () => ['T-1', 'T-2']

Deno.test('tab: word 0 offers verbs, plural kinds and :commands', () => {
  let all = complete([''])
  assertArrayIncludes(all, ['claim', 'spawn', 'list', 'tasks', ':fix', ':new'])
})

Deno.test('tab: word 0 filters by prefix', () => {
  let out = complete(['cl'])
  assertArrayIncludes(out, ['claim', 'claude'])
  assertEquals(out.every((c) => c.startsWith('cl')), true)
  // A router target (`edge`) is not a first word anyone types.
  assertEquals(complete(['ed']).includes('edge'), false)
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

Deno.test('tab: after --model= the graph catalog completes', () => {
  assertEquals(complete(['spawn', 'T-3', '--model=']), []) // unarmed: nothing
  arm.providers = () => catalog(db)
  try {
    let out = complete(['spawn', 'T-3', '--model='])
    assertEquals(out.length > 0, true)
    assertEquals(out.every((c) => c.startsWith('--model=')), true)
    assertArrayIncludes(out, ['--model=gpt-6-astra'])
  } finally {
    arm.providers = undefined
  }
})

Deno.test('tab: an unknown verb completes to nothing', () => {
  assertEquals(complete(['nope', '']), [])
})

Deno.test('tab: formerly equals-only options complete spaced values (T-35503)', () => {
  for (
    let [prefix, flag, value] of [
      [['comment', 'T-1'], '--verdict', 'app'],
      [['list'], '--kind', 'ta'],
      [['goal', 'a title'], '--scope', 'T-'],
    ] as [string[], string, string][]
  ) {
    assertEquals(
      complete([...prefix, flag, value], ids).map((v) => `${flag}=${v}`),
      complete([...prefix, `${flag}=${value}`], ids),
    )
  }
  // A consumed body value must not displace the id positional.
  assertEquals(complete(['set', '--body', 'a note', 'T-'], ids), ids())
})

// A global is the program's flag, typed anywhere on the line (manual.ts
// GLOBALS): it completes before the verb and beside a verb's own options, it
// is not offered twice, and having been typed it does not stop the verb from
// completing.
Deno.test('tab: --timing completes anywhere, once', () => {
  assertEquals(complete(['--tim']), ['--timing'])
  assertEquals(complete(['']).includes('--timing'), false)
  assertArrayIncludes(complete(['show', 'T-3', '--']), ['--timing'])
  assertEquals(
    complete(['show', 'T-3', '--timing', '--']).includes('--timing'),
    false,
  )
  assertArrayIncludes(complete(['--timing', 'sho']), ['show'])
})
