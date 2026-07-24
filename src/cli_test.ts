// The `task new` stray-flag guard: agents pattern-match to --flags, but the
// CLI grammar is dot-params. The guard must catch both the glued `--project=P`
// and the space-separated `--project P` forms — the latter is what agents
// actually type, and the bug that let it through polluted the owner board.
import { assertEquals, assertMatch } from '@std/assert'
import { strayFlag, subagentDigest } from './cli.ts'
import type { Snapshot } from './types.ts'

Deno.test('strayFlag: clean title has no stray flag', () => {
  assertEquals(strayFlag(['Fix', 'the', 'login', 'bug']), null)
})

Deno.test('strayFlag: space-separated --flag (the real corruption)', () => {
  // `task new "Title --project P-30 --body ..."` → these words.
  assertEquals(
    strayFlag(['Title', '--project', 'P-30', '--body', 'stuff']),
    { got: '--project', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: glued --flag=value', () => {
  assertEquals(
    strayFlag(['Title', '--project=P-30']),
    { got: '--project=P-30', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: trailing --flag with no value', () => {
  assertEquals(
    strayFlag(['Title', '--body']),
    { got: '--body', suggest: '.body=…' },
  )
})

Deno.test('strayFlag: hyphenated flag name (--blocked-by)', () => {
  assertEquals(
    strayFlag(['Title', '--blocked-by', 'T-9']),
    { got: '--blocked-by', suggest: '.blocked-by=T-9' },
  )
})

Deno.test('strayFlag: bare -- is not a flag', () => {
  assertEquals(strayFlag(['Title', '--', 'more']), null)
})

// A subagent (a Task-tool child) sees ONLY its task — never the operator's
// mail/lately/fleet/previously. subagentDigest is that lone output: the
// claimed task's block, the TASKS_TASK block, or a bare identity line.
let S = 'bbbbbbbb-0000-4000-8000-000000000001'
let T = 'bbbbbbbb-0000-4000-8000-000000000002'
let sub: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sub-1', agent_type: 'general' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 2, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'Child work', body: '' } },
    { eid: T, name: 'task', comp: { status: 'wip', priority: 0 } },
    { eid: T, name: 'claim', comp: { session_eid: S } },
  ],
  deps: [],
}

Deno.test('subagentDigest: a held claim renders that task block, nothing else', () => {
  let out = subagentDigest(sub, 'sub-1', 'general')
  assertEquals(out, '- T-2 wip — Child work')
  // never the operator digest's tiers
  for (
    let mark of ['## mail', '## lately', 'from the fleet', '## previously']
  ) {
    assertEquals(out.includes(mark), false)
  }
})

Deno.test('subagentDigest: TASKS_TASK names the block when set', () => {
  Deno.env.set('TASKS_TASK', 'T-2')
  try {
    // even a session holding no claim shows the managed task
    assertEquals(
      subagentDigest(sub, 'nobody', 'general'),
      '- T-2 wip — Child work',
    )
  } finally {
    Deno.env.delete('TASKS_TASK')
  }
})

Deno.test('subagentDigest: no task = a one-line identity note', () => {
  Deno.env.delete('TASKS_TASK')
  assertEquals(
    subagentDigest(sub, 'nobody', 'general'),
    '# subagent general · nobody',
  )
  assertMatch(subagentDigest(sub, 'nobody'), /^# subagent · nobody$/)
})
