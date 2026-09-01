// `## owner said` / `task said` — the owner's own turns, in order, ahead of
// the fleet's noise (M-31946). A managed run's user turns are its brief, a
// subagent's are its parent's prompts, and a harness wrapper is nothing
// anyone said: none of those are the owner speaking.
import { assertEquals } from '@std/assert'
import { contextDigest, rows, saidLines } from './client.ts'
import type { Snapshot } from './types.ts'

let S = 'aaaaaaaa-0000-4000-8000-000000000001'
let M = 'cccccccc-0000-4000-8000-000000000001'
let SUB = 'cccccccc-0000-4000-8000-000000000002'
let CRON = 'cccccccc-0000-4000-8000-000000000003'

let entry = (
  eid: string,
  session: string,
  body: string,
  at: string,
  extra: Record<string, Record<string, unknown>> = {},
) => [
  { eid, name: 'entry', comp: { session, seq: 1 } },
  { eid, name: 'message', comp: { role: 'user' } },
  { eid, name: 'content', comp: { body } },
  { eid, name: 'created', comp: { at } },
  ...Object.entries(extra).map(([name, comp]) => ({ eid, name, comp })),
]

let base: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x', cwd: '/w', pane: '%1' } },
    { eid: CRON, name: 'entity', comp: { eid: CRON, num: 8, created_at: '' } },
    {
      eid: CRON,
      name: 'session',
      comp: { id: 'sess-cron', origin: 'external' },
    },
    { eid: M, name: 'entity', comp: { eid: M, num: 9, created_at: '' } },
    { eid: M, name: 'session', comp: { id: 'sess-m', origin: 'managed' } },
    { eid: SUB, name: 'entity', comp: { eid: SUB, num: 10, created_at: '' } },
    { eid: SUB, name: 'session', comp: { id: 'sess-sub', agent_type: 'x' } },
  ],
  deps: [],
}

let spoke: Snapshot = {
  changes: [
    ...base.changes,
    ...entry('e-2', S, 'second thing\nmore', '2026-09-01T19:40:00.000Z'),
    ...entry('e-1', S, 'first thing', '2026-09-01T19:25:00.000Z'),
    ...entry(
      'e-wrap',
      S,
      '<command-name>/clear</command-name>',
      '2026-09-01T19:26:00.000Z',
    ),
    ...entry('e-tool', S, 'tool output', '2026-09-01T19:27:00.000Z', {
      result: {},
    }),
    ...entry('e-brief', M, 'you are a coder', '2026-09-01T19:28:00.000Z'),
    ...entry('e-sub', SUB, 'parent prompt', '2026-09-01T19:29:00.000Z'),
    ...entry(
      'e-cron',
      CRON,
      'You are running in sweep mode',
      '2026-09-01T19:30:00.000Z',
    ),
    ...entry(
      'e-compact',
      S,
      'This session is being continued from a previous conversation that ran out of context. The summary…',
      '2026-09-01T19:31:00.000Z',
    ),
  ],
  deps: [],
}

Deno.test("saidLines: the owner's turns only, oldest first", () => {
  let all = rows(spoke)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  assertEquals(saidLines(all, byEid, 5), [
    '- 09-01 19:25 S-1 · first thing',
    '- 09-01 19:40 S-1 · second thing',
  ])
  assertEquals(saidLines(all, byEid, 1), ['- 09-01 19:40 S-1 · second thing'])
})

Deno.test('contextDigest carries `## owner said`, and omits it with nothing said', () => {
  let d = contextDigest(spoke, 'sess-x')
  assertEquals(
    d.includes('## owner said (task said)\n- 09-01 19:25 S-1 · first thing'),
    true,
  )
  assertEquals(contextDigest(base, 'sess-x').includes('## owner said'), false)
})
