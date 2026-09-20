import { assertEquals } from '@std/assert'
import { running, strays, sweep, tasksEntries, tmpBase } from './scratch.ts'

// Every case builds its own base and removes it — the hygiene this module is
// about, practiced. The base lands under TMPDIR, so a case that dies mid-way
// still leaves nothing the run directory does not already own.
let base = (names: string[], body: (dir: string) => void) => {
  let dir = Deno.makeTempDirSync({ prefix: 'scratch-base-' })
  for (let name of names) Deno.mkdirSync(`${dir}/${name}`)
  try {
    body(dir)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

Deno.test('the base is TMPDIR, and /tmp only when nothing named one', () => {
  assertEquals(tmpBase({ TMPDIR: '/tmp/tasks-run-7' }), '/tmp/tasks-run-7')
  assertEquals(tmpBase({}), '/tmp')
})

Deno.test('only the tasks-* family counts as ours', () =>
  base(['tasks-door-a', 'chrome-profile', 'tasks-run-1'], (dir) => {
    assertEquals([...tasksEntries(dir)].sort(), ['tasks-door-a', 'tasks-run-1'])
  }))

Deno.test('a run directory whose owner is gone is swept', () =>
  base(['tasks-run-1', 'tasks-run-2', 'tasks-door-a'], (dir) => {
    assertEquals(sweep(dir, (pid) => pid == 1), ['tasks-run-2'])
    // The live run keeps its directory, and a stray is not a run to sweep.
    assertEquals([...tasksEntries(dir)].sort(), ['tasks-door-a', 'tasks-run-1'])
  }))

Deno.test('a stray is a tasks-* entry the run did not start with', () =>
  base(['tasks-door-a'], (dir) => {
    let before = tasksEntries(dir)
    Deno.mkdirSync(`${dir}/tasks-native-b`)
    Deno.mkdirSync(`${dir}/tasks-claim-c`)
    // Another runner's own directory is its business, never this run's leak.
    Deno.mkdirSync(`${dir}/tasks-run-999`)
    assertEquals(strays(dir, before), ['tasks-claim-c', 'tasks-native-b'])
  }))

Deno.test('this very process is running; pid 0 names no process', () => {
  assertEquals(running(Deno.pid), true)
  assertEquals(running(0), false)
})
