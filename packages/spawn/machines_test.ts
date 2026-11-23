import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { entryStatus } from '@yaks/session'
import { INIT, ME, say, space, TASK } from './testing.ts'
import { lent, log, machineOf, take } from './machines.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let comments = (g: Graph) => g.read(line`.comment.target=${TASK}&*`)

test('a machine takes what its space asks of it once, and nothing else', async () => {
  let { g, machine } = await space()
  let handed = await take(g, machine, ME)
  assertEquals(handed?.session, 'S1')
  assertEquals(handed?.cli, 'claude')
  assertEquals(handed?.instruction, 'Work T-1')
  // No model named leaves it to the CLI's own default.
  assertEquals(handed?.model, undefined)
  assertEquals(await take(g, machine, ME), undefined)
  assertEquals(await take(g, machineOf(ME.by, 'other'), ME), undefined)
})

test("one person's machine is never another's", async () => {
  let { g } = await space()
  assertEquals(await take(g, machineOf('person-else', 'mbp'), ME), undefined)
  await take(g, machineOf(ME.by, 'mbp'), ME)
  await assertRejects(
    () => log(g, machineOf('person-else', 'mbp'), 'S1', { exit: 0 }, ME),
    Error,
    'not asked of this machine',
  )
})

test("a run's lines become its transcript, and its end its report", async () => {
  let { g, machine } = await space()
  await take(g, machine, ME)
  await log(g, machine, 'S1', {
    lines: [INIT, 'not json', say('Fixed the parser.')],
    pid: 42,
  }, ME)
  let [row] = await g.get(['S1'])
  assertEquals(comp(row, 'process')?.pid, 42)
  assertEquals(comp(row, 'session')?.id, 'thread-1')
  assertEquals(await comments(g), [])
  await log(g, machine, 'S1', { from: 3, exit: 0 }, ME)
  ;[row] = await g.get(['S1'])
  assertEquals(comp(row, 'exit')?.code, 0)
  assertEquals(await entryStatus(g, 'S1'), 'stopped')
  let [report] = await comments(g)
  assertStringIncludes(String(comp(report, 'doc')?.title), 'exited 0')
  assertStringIncludes(String(comp(report, 'doc')?.body), 'Fixed the parser.')
  // Its claim goes with it, so the task can be asked of a run again.
  let [task] = await g.get([TASK])
  assertEquals(task.claim, undefined)
})

test('a run that fails says why, and one asked again carries on its thread', async () => {
  let { g, machine } = await space()
  await take(g, machine, ME)
  await log(g, machine, 'S1', { lines: [INIT, say('hm')], exit: 1 }, ME)
  let [report] = await comments(g)
  assertStringIncludes(String(comp(report, 'doc')?.body), 'exited 1')
  await g.apply([{
    entity: { eid: 'E2' },
    entry: { session: 'S1' },
    content: { body: 'Try again' },
    using: { provider: identityEid('provider', [lent('claude', 'mbp')]) },
  }], { trusted: true })
  let handed = await take(g, machine, ME)
  assertEquals(handed?.thread, 'thread-1')
  assertStringIncludes(handed!.instruction, 'Try again')
})
