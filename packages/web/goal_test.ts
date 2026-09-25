// `## goals` — the standing goals (M-31946 §5) a context reads right after
// what the owner said: fleet-wide ones plus its own project's, never another
// project's, titles only.
import { assertEquals } from '@std/assert'
import { contextDigest, goalLines, rows } from './client.ts'
import type { Snapshot } from './types.ts'

let S = 'aaaaaaaa-0000-4000-8000-000000000001'
let P = 'bbbbbbbb-0000-4000-8000-000000000001'
let P2 = 'bbbbbbbb-0000-4000-8000-000000000002'

let goal = (eid: string, num: number, title: string, scope?: string) => [
  { eid, name: 'entity', comp: { eid, num, created_at: '' } },
  { eid, name: 'doc', comp: { title, body: '' } },
  { eid, name: 'goal', comp: { scope: scope ?? null } },
]

let snap: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x', cwd: '/w', pane: '%1' } },
    { eid: P, name: 'entity', comp: { eid: P, num: 2, created_at: '' } },
    { eid: P, name: 'doc', comp: { title: 'Task Graph' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P2, name: 'entity', comp: { eid: P2, num: 3, created_at: '' } },
    { eid: P2, name: 'doc', comp: { title: 'Elsewhere' } },
    { eid: P2, name: 'project', comp: {} },
    ...goal('g-tui', 12, 'A useful, performant TUI', P),
    ...goal('g-noise', 10, 'Reduce noise, amplify signal'),
    ...goal('g-other', 11, 'Sell more books', P2),
  ],
  deps: [],
}

Deno.test('goalLines: fleet-wide plus the scope, by num, titles only', () => {
  let all = rows(snap)
  assertEquals(goalLines(all, P), [
    '- V-10 Reduce noise, amplify signal',
    '- V-12 A useful, performant TUI',
  ])
  // No scope: only the fleet-wide ones.
  assertEquals(goalLines(all), ['- V-10 Reduce noise, amplify signal'])
  assertEquals(goalLines(all, P, 1), ['- V-10 Reduce noise, amplify signal'])
})

Deno.test('contextDigest carries `## goals`, and omits it with none', () => {
  let d = contextDigest(snap, 'sess-x', Date.now(), P)
  assertEquals(
    d.includes(
      '## goals (task goals)\n- V-10 Reduce noise, amplify signal\n- V-12 A useful, performant TUI',
    ),
    true,
  )
  assertEquals(d.includes('Sell more books'), false)
  let none: Snapshot = { changes: snap.changes.slice(0, 2), deps: [] }
  assertEquals(contextDigest(none, 'sess-x').includes('## goals'), false)
})
