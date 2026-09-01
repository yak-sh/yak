// `## owner said` / `task said` — everything a person authored, on one
// timeline, ahead of the fleet's noise (M-31946): typed turns, and every act
// the stamps attribute to a person. A managed run's user turns are its brief,
// a subagent's are its parent's prompts, an unmarked user turn is the
// harness's, and a gesture the web writes in the owner's name is not
// authorship.
import { assertEquals } from '@std/assert'
import { contextDigest, rows, saidLines } from './client.ts'
import type { Snapshot } from './types.ts'

let S = 'aaaaaaaa-0000-4000-8000-000000000001'
let J = 'aaaaaaaa-0000-4000-8000-000000000007'
let A = 'aaaaaaaa-0000-4000-8000-000000000008' // an agent actor
let T = 'aaaaaaaa-0000-4000-8000-000000000002'
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
    { eid: J, name: 'entity', comp: { eid: J, num: 7, created_at: '' } },
    { eid: J, name: 'person', comp: {} },
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x', cwd: '/w', pane: '%1' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 2, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'First', body: '' } },
    { eid: T, name: 'task', comp: { status: 'wip', priority: 0 } },
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
    ...entry('e-2', S, 'second thing\nmore', '2026-09-01T19:40:00.000Z', {
      prompt: {},
    }),
    ...entry('e-1', S, 'first thing', '2026-09-01T19:25:00.000Z', {
      prompt: {},
    }),
    // A user turn without the prompt tag is one the harness injected.
    ...entry('e-hook', S, 'Stop hook feedback: x', '2026-09-01T19:32:00.000Z'),
    ...entry('e-tool', S, 'tool output', '2026-09-01T19:27:00.000Z', {
      result: {},
    }),
    ...entry('e-brief', M, 'you are a coder', '2026-09-01T19:28:00.000Z', {
      prompt: {},
    }),
    ...entry('e-sub', SUB, 'parent prompt', '2026-09-01T19:29:00.000Z', {
      prompt: {},
    }),
    ...entry('e-cron', CRON, 'sweep mode', '2026-09-01T19:30:00.000Z', {
      prompt: {},
    }),
    // A comment the owner wrote on T, a task he filed, a memory an agent
    // wrote from his feedback, a design he decided, a task an agent filed
    // that he later edited, and his cursor — a gesture, not an act.
    { eid: 'c-1', name: 'doc', comp: { title: '', body: 'ship it\nplease' } },
    { eid: 'c-1', name: 'comment', comp: { target: T } },
    {
      eid: 'c-1',
      name: 'created',
      comp: { by: J, at: '2026-09-01T19:26:00.000Z' },
    },
    {
      eid: 't-9',
      name: 'entity',
      comp: { eid: 't-9', num: 9, created_at: '' },
    },
    {
      eid: 't-9',
      name: 'doc',
      comp: { title: 'Fix the TUI', body: 'it is slow' },
    },
    { eid: 't-9', name: 'task', comp: { priority: 1, project: T } },
    {
      eid: 't-9',
      name: 'created',
      comp: { by: J, at: '2026-09-01T19:33:00.000Z' },
    },
    {
      eid: 'm-1',
      name: 'entity',
      comp: { eid: 'm-1', num: 11, created_at: '' },
    },
    { eid: 'm-1', name: 'doc', comp: { title: 'no war stories', body: '' } },
    { eid: 'm-1', name: 'memory', comp: {} },
    { eid: 'm-1', name: 'feedback', comp: { by: J } },
    {
      eid: 'm-1',
      name: 'created',
      comp: { by: A, at: '2026-09-01T19:34:00.000Z' },
    },
    {
      eid: 'd-1',
      name: 'entity',
      comp: { eid: 'd-1', num: 12, created_at: '' },
    },
    { eid: 'd-1', name: 'doc', comp: { title: 'Owner stream', body: '' } },
    { eid: 'd-1', name: 'design', comp: {} },
    {
      eid: 'd-1',
      name: 'created',
      comp: { by: A, at: '2026-09-01T19:20:00.000Z' },
    },
    {
      eid: 'd-1',
      name: 'decided',
      comp: { by: J, at: '2026-09-01T19:35:00.000Z', verdict: 'approved' },
    },
    {
      eid: 't-8',
      name: 'entity',
      comp: { eid: 't-8', num: 8, created_at: '' },
    },
    { eid: 't-8', name: 'doc', comp: { title: 'Agent task', body: '' } },
    { eid: 't-8', name: 'task', comp: { priority: 2 } },
    {
      eid: 't-8',
      name: 'created',
      comp: { by: A, at: '2026-09-01T19:21:00.000Z' },
    },
    {
      eid: 't-8',
      name: 'updated',
      comp: { by: J, at: '2026-09-01T19:36:00.000Z' },
    },
    // A letter the owner opened and archived: the read-state marks stamp
    // `updated` in his name in the same batch, and reading is not writing.
    {
      eid: 'mail',
      name: 'entity',
      comp: { eid: 'mail', num: 13, created_at: '' },
    },
    { eid: 'mail', name: 'doc', comp: { title: 'alert', body: 'disk full' } },
    { eid: 'mail', name: 'mail', comp: { target: null } },
    {
      eid: 'mail',
      name: 'created',
      comp: { by: A, at: '2026-09-01T18:00:00.000Z' },
    },
    {
      eid: 'mail',
      name: 'opened',
      comp: { by: J, at: '2026-09-01T19:38:00.000Z' },
    },
    {
      eid: 'mail',
      name: 'archived',
      comp: { by: J, at: '2026-09-01T19:39:00.000Z' },
    },
    {
      eid: 'mail',
      name: 'updated',
      comp: { by: J, at: '2026-09-01T19:39:00.000Z' },
    },
    // The content-addressed blob the server mints beside a body edit.
    { eid: 'blob', name: 'blob', comp: { bytes: 12 } },
    {
      eid: 'blob',
      name: 'created',
      comp: { by: J, at: '2026-09-01T19:39:30.000Z' },
    },
    { eid: 'cur', name: 'cursor', comp: { client: 'x', target: T } },
    {
      eid: 'cur',
      name: 'created',
      comp: { by: J, at: '2026-09-01T19:37:00.000Z' },
    },
  ],
  deps: [],
}

Deno.test('saidLines: everything the owner authored, oldest first', () => {
  let all = rows(spoke)
  let byEid = new Map(all.map((r) => [r.eid, r]))
  // Each line names the entity (its own id, `task show`-able), the act, and
  // where it sits.
  assertEquals(saidLines(all, byEid, 10), [
    '- 09-01 19:25 e-1 turn S-1 · first thing',
    '- 09-01 19:26 c-1 comment T-2 · ship it',
    '- 09-01 19:33 T-9 task T-2 · Fix the TUI',
    '- 09-01 19:34 M-11 feedback · no war stories',
    '- 09-01 19:35 D-12 decided approved · Owner stream',
    '- 09-01 19:36 T-8 edit · Agent task',
    '- 09-01 19:40 e-2 turn S-1 · second thing',
  ])
  assertEquals(saidLines(all, byEid, 1), [
    '- 09-01 19:40 e-2 turn S-1 · second thing',
  ])
  // The line is cut to the given width, never a fixed count.
  assertEquals(saidLines(all, byEid, 1, 39), [
    '- 09-01 19:40 e-2 turn S-1 · second thi…',
  ])
  // --full prints each whole text under its line, blank-line separated; a
  // titled thing leads with its title.
  assertEquals(saidLines(all, byEid, 2, 39, true).slice(0, 3), [
    '- 09-01 19:36 T-8 edit ·',
    'Agent task',
    '',
  ])
  assertEquals(saidLines(all, byEid, 1, 39, true), [
    '- 09-01 19:40 e-2 turn S-1 ·',
    'second thing\nmore',
    '',
  ])
})

Deno.test('contextDigest carries `## owner said`, and omits it with nothing said', () => {
  let d = contextDigest(spoke, 'sess-x')
  assertEquals(
    d.includes(
      '## owner said (task said)\n- 09-01 19:33 T-9 task T-2 · Fix the TUI',
    ),
    true,
  )
  assertEquals(contextDigest(base, 'sess-x').includes('## owner said'), false)
})
