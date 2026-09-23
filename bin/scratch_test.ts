import { assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from './testing.ts'
import {
  ours,
  running,
  strays,
  sweep,
  tasksEntries,
  tmpBase,
} from './scratch.ts'

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

// Naming a base is the whole claim to it: the shared /tmp carries other runs'
// `tasks-*` entries, so a stray there is a warning and not this run's failure.
Deno.test('a stray is blamed only on a base the caller named', () => {
  assertEquals(ours({ TMPDIR: '/tmp/scratchpad' }), true)
  assertEquals(ours({}), false)
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

// The predicate above decides an exit code, and it was the exit code that
// failed runs which had leaked nothing — so the wiring gets its own proof.
// The run leaks by hand: a command that mkdirs a `tasks-*` entry in the base
// is exactly the spawn site writing past TMPDIR that the guard is for.
let leaks = async (base: string, env: Record<string, string>) => {
  let stray = `${base}/tasks-e2e-${crypto.randomUUID().slice(0, 8)}`
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', import.meta.dirname + '/scratch.ts', 'mkdir', stray],
      env,
      clearEnv: true,
      stderr: 'piped',
      stdout: 'null',
    }).output()
    return [out.code, new TextDecoder().decode(out.stderr)] as const
  } finally {
    try {
      Deno.removeSync(stray, { recursive: true })
    } catch { /* the run never got that far */ }
  }
}

slow(
  'a stray fails a named base and only warns on the shared one',
  async () => {
    // clearEnv is the only way to unset TMPDIR for a child, so the few names
    // the child still needs are carried across by hand — DENO_DIR among them,
    // or the run would build a second module cache under HOME.
    let home = Object.fromEntries(
      ['HOME', 'PATH', 'DENO_DIR'].map((k) => [k, Deno.env.get(k) ?? '']),
    )
    let dir = Deno.makeTempDirSync({ prefix: 'scratch-e2e-' })
    try {
      let [code, err] = await leaks(dir, { ...home, TMPDIR: dir })
      assertEquals(code, 1)
      assertStringIncludes(err, 'leaked outside the run directory')

      // No TMPDIR: the base is /tmp, which this box shares with CI and every
      // other worktree, so the entry is reported and the run still passes.
      let [shared, warning] = await leaks('/tmp', home)
      assertEquals(shared, 0)
      assertStringIncludes(warning, 'appeared beside the run directory')
      assertStringIncludes(warning, 'Not failing')
    } finally {
      Deno.removeSync(dir, { recursive: true })
    }
  },
)
