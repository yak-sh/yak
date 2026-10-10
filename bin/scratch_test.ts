import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  ours,
  running,
  scratch,
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

test('the base is TMPDIR, and /tmp only when nothing named one', () => {
  assertEquals(tmpBase({ TMPDIR: '/tmp/tasks-run-7' }), '/tmp/tasks-run-7')
  assertEquals(tmpBase({}), '/tmp')
})

// Naming a base is the whole claim to it: the shared /tmp carries other runs'
// `tasks-*` entries, so a stray there is a warning and not this run's failure.
test('a stray is blamed only on a base the caller named', () => {
  assertEquals(ours({ TMPDIR: '/tmp/scratchpad' }), true)
  assertEquals(ours({}), false)
})

test('only the tasks-* family counts as ours', () =>
  base(['tasks-door-a', 'chrome-profile', 'tasks-run-1'], (dir) => {
    assertEquals([...tasksEntries(dir)].sort(), ['tasks-door-a', 'tasks-run-1'])
  }))

test('a run directory whose owner is gone is swept', () =>
  base(['tasks-run-1', 'tasks-run-2', 'tasks-door-a'], (dir) => {
    assertEquals(sweep(dir, (pid) => pid == 1), ['tasks-run-2'])
    // The live run keeps its directory, and a stray is not a run to sweep.
    assertEquals([...tasksEntries(dir)].sort(), ['tasks-door-a', 'tasks-run-1'])
  }))

test('a stray is a tasks-* entry the run did not start with', () =>
  base(['tasks-door-a'], (dir) => {
    let before = tasksEntries(dir)
    Deno.mkdirSync(`${dir}/tasks-native-b`)
    Deno.mkdirSync(`${dir}/tasks-claim-c`)
    // Another runner's own directory is its business, never this run's leak.
    Deno.mkdirSync(`${dir}/tasks-run-999`)
    assertEquals(strays(dir, before), ['tasks-claim-c', 'tasks-native-b'])
  }))

test('this very process is running; pid 0 names no process', () => {
  assertEquals(running(Deno.pid), true)
  assertEquals(running(0), false)
})

// The predicate above decides an exit code, and it was the exit code that
// failed runs which had leaked nothing — so the wiring gets its own proof.
// The run leaks by hand: a command that mkdirs a `tasks-*` entry in the base
// is exactly the spawn site writing past TMPDIR that the guard is for.
let leaks = async (base: string, env: Record<string, string>) => {
  let stray = `${base}/tasks-e2e-${crypto.randomUUID().slice(0, 8)}`
  let said: string[] = []
  try {
    let code = await scratch(['mkdir', stray], env, (l) => said.push(l))
    return [code, said.join('\n')] as const
  } finally {
    try {
      Deno.removeSync(stray, { recursive: true })
    } catch { /* the run never got that far */ }
  }
}

test(
  'a stray fails a named base and only warns on the shared one',
  async () => {
    // The run's environment is the whole of its child's, so the one name
    // mkdir needs is carried across by hand.
    let home = { PATH: Deno.env.get('PATH') ?? '' }
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

test('a default scratch run leaves another dead run directory alone', async () => {
  let path = '/tmp/tasks-run-' +
    (1_000_000_000 + Math.floor(Math.random() * 1_000_000_000))
  Deno.mkdirSync(path)
  try {
    Deno.writeTextFileSync(path + '/work', 'another session')
    assertEquals(
      await scratch(['true'], { PATH: Deno.env.get('PATH') ?? '' }),
      0,
    )
    assertEquals(Deno.readTextFileSync(path + '/work'), 'another session')
  } finally {
    Deno.removeSync(path, { recursive: true })
  }
})

test('scratch lends every machine state directory inside its own run', async () => {
  let root = Deno.makeTempDirSync()
  // A fresh runner's named base may not exist, even its parent.
  let dir = `${root}/missing/base`
  let out = root + '/env.json'
  try {
    let code =
      'Deno.writeTextFileSync(Deno.args[0], JSON.stringify(Deno.env.toObject()))'
    assertEquals(
      await scratch([Deno.execPath(), 'eval', code, out], {
        ...Deno.env.toObject(),
        TMPDIR: dir,
        PROCESS_DIR: '/live/processes',
        HARNESS_WORKTREE_DIR: '/live/worktrees',
        HARNESS_DB: '/live/yak.db',
      }),
      0,
    )
    let env = JSON.parse(Deno.readTextFileSync(out))
    assertEquals(env.TMPDIR.startsWith(`${dir}/tasks-run-`), true)
    assertEquals([...Deno.readDirSync(dir)], [])
    for (
      let name of [
        'TASKS_HOME',
        'PROCESS_DIR',
        'HARNESS_HOME',
        'HARNESS_WORKTREE_DIR',
        'HARNESS_DB',
      ]
    ) {
      assertEquals(env[name].startsWith(env.TMPDIR + '/'), true)
    }
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

test('scratch git fixtures do not inherit the caller repository', async () => {
  let root = Deno.makeTempDirSync({ prefix: 'scratch-git-' })
  let caller = `${root}/caller`
  let env = {
    PATH: Deno.env.get('PATH') ?? '',
    DENO_DIR: Deno.env.get('DENO_DIR') ?? '',
  }
  let git = async (...args: string[]) => {
    let out = await new Deno.Command('git', {
      args,
      env,
      clearEnv: true,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr))
    return new TextDecoder().decode(out.stdout).trim()
  }
  try {
    await git('init', '-q', caller)
    let config = Deno.readTextFileSync(`${caller}/.git/config`)
    // As in a hook: cwd is not the repository selector. An init with no
    // destination must create the fixture, not reinitialize this caller.
    let script = `
      let fixture = Deno.makeTempDirSync();
      for (let args of [
        ['init', '--bare', '-q'],
        ['config', '--get', 'core.bare'],
      ]) {
        let out = await new Deno.Command('git', {
          args: ['-C', fixture, ...args], stdout: 'piped', stderr: 'piped',
        }).output();
        if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
        if (args[0] === 'config' && new TextDecoder().decode(out.stdout).trim() !== 'true') {
          throw new Error('fixture is not bare');
        }
      }
      if (!Deno.statSync(fixture + '/config').isFile) throw new Error('fixture was not created');
    `
    let code = await scratch([Deno.execPath(), 'eval', script], {
      ...env,
      TMPDIR: root,
      GIT_DIR: `${caller}/.git`,
      GIT_COMMON_DIR: `${caller}/.git`,
      GIT_INDEX_FILE: `${caller}/.git/index`,
      GIT_OBJECT_DIRECTORY: `${caller}/.git/objects`,
    })
    assertEquals(Deno.readTextFileSync(`${caller}/.git/config`), config)
    assertEquals(code, 0)
    assertEquals(
      await git('-C', caller, 'rev-parse', '--is-bare-repository'),
      'false',
    )
    assertEquals(await git('-C', caller, 'status', '--porcelain'), '')
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})
