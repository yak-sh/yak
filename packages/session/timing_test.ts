import { assertEquals, assertMatch } from '@std/assert'
import { duration, took, toolTiming } from './timing.ts'
import { project } from './react.ts'

Deno.test('wall-clock formats quick calls and flags only commands over a minute', () => {
  assertEquals(duration(12.3), '12ms')
  assertEquals(duration(999), '999ms')
  assertEquals(duration(60_000), '1m0s')
  assertEquals(duration(252_000), '4m12s')
  assertEquals(took('', 60_000), 'took 1m0s')
  assertMatch(took('failed', 60_001), /failed\ntook 1m0s — over 60s/)
})

Deno.test('tool account sums measured calls once, ranks three, and ignores old results', () => {
  let calls = [90_000, 78_000, 551_000, 113_000].flatMap((ms, i) => [
    { eid: `c${i}`, comps: { bash: { command: `gate ${i}` } } },
    { eid: `r${i}`, comps: { result: { call: `c${i}`, ms } } },
  ])
  assertEquals(
    toolTiming([...calls, calls[1], {
      eid: 'old',
      comps: { result: { call: 'unmeasured' } },
    }]),
    [
      'Tool wall-clock: 13m52s (sum of 4 measured calls; parallel waits add).',
      'Slowest commands/tools:',
      '- 9m11s — gate 2',
      '- 1m53s — gate 3',
      '- 1m30s — gate 0',
    ].join('\n'),
  )
  assertEquals(toolTiming([]), '')
})

Deno.test('portable timing survives result bounding without changing raw JSON', () => {
  let entries = [
    { entity: { eid: 'call' }, call: { id: 'provider-call', to: 'tool' } },
    {
      entity: { eid: 'result' },
      result: { call: 'call', ms: 252_000 },
      content: { body: '{"ok":true}' },
    },
  ]
  let items = project(
    entries,
    new Map(),
    undefined,
    new Map([['result', 'bounded preview']]),
  )
  assertEquals(items.at(-1), {
    kind: 'result',
    id: 'provider-call',
    output: 'bounded preview\ntook 4m12s — over 60s: report this slow command',
  })
  assertEquals(entries[1].content?.body, '{"ok":true}')
})
