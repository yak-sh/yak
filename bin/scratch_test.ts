import { clock, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  inside,
  ours,
  procfs,
  reap,
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
let base = async <T>(
  names: string[],
  body: (dir: string) => T | Promise<T>,
): Promise<T> => {
  let dir = Deno.makeTempDirSync({ prefix: 'scratch-base-' })
  for (let name of names) Deno.mkdirSync(`${dir}/${name}`)
  try {
    return await body(dir)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
}

// A box of the test's own. Its process table is a map, a signal ends what it
// reaches unless the process is deaf to it, time moves when the test says, and
// the child a run starts plays here with the environment the run hands it.
type Running = {
  env: Record<string, string>
  cwd: string
  cmd: string
  deaf?: Deno.Signal
}
let rig = ({ tmp = '/nowhere', child = (_: Record<string, string>) => {} }: {
  tmp?: string
  child?: (env: Record<string, string>) => number | void
} = {}) => {
  let table = new Map<number, Running>()
  let next = 100
  let signals: string[] = []
  return {
    ...clock(),
    tmp,
    signals,
    spawn: (p: Partial<Running> = {}) => {
      table.set(++next, { env: {}, cwd: '/', cmd: 'sleep 30', ...p })
      return next
    },
    ps: () =>
      [...table].map(([pid, { env, cwd }]) => ({
        pid,
        cwd,
        env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      })),
    command: (pid: number) => table.get(pid)?.cmd ?? '',
    running: (pid: number) => table.has(pid),
    kill: (pid: number, signal: Deno.Signal) => {
      signals.push(`${pid} ${signal}`)
      if (table.get(pid)?.deaf != signal) table.delete(pid)
    },
    start: (_: string[], env: Record<string, string>) => {
      let code = child(env) || 0
      let status = { success: !code, code, signal: null }
      return { status: Promise.resolve(status), kill: () => {} }
    },
    gitLocal: () => Promise.resolve([]),
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

// procfs as Linux writes it: environ and cmdline are split by NULs, cwd is a
// link that marks a removed directory ' (deleted)', and stat has the state
// after the command's closing parenthesis. This process is never in the table.
test('procfs reads the process table, and a zombie no longer runs', () =>
  base(['42', String(Deno.pid)], (root) => {
    let write = (path: string, text: string) =>
      Deno.writeTextFileSync(`${root}/${path}`, text)
    write('42/environ', 'HOME=/h\0TMPDIR=/env/t\0')
    write('42/cmdline', 'sleep\x0030\0')
    write('42/stat', '42 (a) b) Z 1')
    Deno.symlinkSync('/cwd (deleted)', `${root}/42/cwd`)
    write(`${Deno.pid}/environ`, 'TMPDIR=/env\0')
    let box = procfs(root)
    let ps = box.ps()
    assertEquals([inside('/env', ps), inside('/cwd', ps)], [[42], [42]])
    assertEquals([box.command(42), box.running(42)], ['sleep 30', false])
  }))

// The predicate above decides an exit code, and it was the exit code that
// failed runs which had leaked nothing — so the wiring gets its own proof.
// The run leaks by hand: a command that mkdirs a `tasks-*` entry in the base
// is exactly the spawn site writing past TMPDIR that the guard is for.
let leaks = async (dir: string, env: Record<string, string>, stray: string) => {
  let said: string[] = []
  let box = rig({ tmp: dir, child: () => Deno.mkdirSync(`${dir}/${stray}`) })
  let code = await scratch(['mkdir'], env, (l) => said.push(l), box)
  return [code, said.join('\n')] as const
}

test('a stray fails a named base and only warns on the shared one', () =>
  base([], async (dir) => {
    let [code, err] = await leaks(dir, { TMPDIR: dir }, 'tasks-e2e-a')
    assertEquals(code, 1)
    assertStringIncludes(err, 'leaked outside the run directory')

    // No TMPDIR: the base is the box's shared one, also CI's and every other
    // worktree's, so the entry is reported and the run still passes.
    let [shared, warning] = await leaks(dir, {}, 'tasks-e2e-b')
    assertEquals(shared, 0)
    assertStringIncludes(warning, 'appeared beside the run directory')
    assertStringIncludes(warning, 'Not failing')
  }))

test('a default scratch run leaves another dead run directory alone', () =>
  base(['tasks-run-4242'], async (tmp) => {
    let work = `${tmp}/tasks-run-4242/work`
    Deno.writeTextFileSync(work, 'another session')
    assertEquals(await scratch(['true'], {}, () => {}, rig({ tmp })), 0)
    assertEquals(Deno.readTextFileSync(work), 'another session')
  }))

test('scratch lends every machine state directory inside its own run', () =>
  base([], async (root) => {
    // A fresh runner's named base may not exist, even its parent.
    let dir = `${root}/missing/base`
    let env: Record<string, string> = {}
    let box = rig({ child: (given) => void (env = given) })
    assertEquals(
      await scratch(
        ['env'],
        {
          TMPDIR: dir,
          PROCESS_DIR: '/live/processes',
          HARNESS_WORKTREE_DIR: '/live/worktrees',
          HARNESS_DB: '/live/yak.db',
        },
        () => {},
        box,
      ),
      0,
    )
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
  }))

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

// A test's server outlives a test killed before its `finally`, in a session of
// its own; what still marks it is the run in its environment or its cwd.
let run = '/base/tasks-run-1'

test('reap ends what runs in a run directory and leaves the rest', async () => {
  let box = rig()
  let marked = box.spawn({ env: { YAK_CONFIG: `${run}/yak.json` } })
  let working = box.spawn({ cwd: `${run}/repo`, cmd: 'deno serve' })
  let others = [box.spawn({ cwd: `${run}0` }), box.spawn()]
  assertEquals(await reap(run, box), [
    `${marked} sleep 30`,
    `${working} deno serve`,
  ])
  assertEquals(box.signals, [`${marked} SIGTERM`, `${working} SIGTERM`])
  assertEquals(others.map(box.running), [true, true])
})

test('reap cuts off what outlasts its wait, and what started meanwhile', async () => {
  let box = rig()
  let deaf = box.spawn({ cwd: run, deaf: 'SIGTERM' })
  let reaping = reap(run, box, 1000)
  await box.advance(950)
  let late = box.spawn({ cwd: run, cmd: 'late' })
  assertEquals(box.signals, [`${deaf} SIGTERM`])
  await box.advance(50)
  assertEquals(box.signals, [
    `${deaf} SIGTERM`,
    `${deaf} SIGKILL`,
    `${late} SIGKILL`,
  ])
  assertEquals(await reaping, [`${deaf} sleep 30`, `${late} late`])
})

test('a run ends a detached process it left behind and says so', () =>
  base([], async (dir) => {
    let said: string[] = []
    let box = rig({ child: (env) => void box.spawn({ env }) })
    assertEquals(
      await scratch(['sh'], { TMPDIR: dir }, (l) => said.push(l), box),
      0,
    )
    assertStringIncludes(said.join('\n'), '1 process still ran')
    assertEquals(inside(`${dir}/tasks-run-${Deno.pid}`, box.ps()), [])
  }))
