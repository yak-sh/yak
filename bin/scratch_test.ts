import { clock, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import {
  inside,
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
let rig = ({
  tmp = '/nowhere',
  base = '/nowhere',
  child = (_: Record<string, string>) => {},
}: {
  tmp?: string
  base?: string
  child?: (env: Record<string, string>) => number | void
} = {}) => {
  let table = new Map<number, Running>()
  let next = 100
  let signals: string[] = []
  return {
    ...clock(),
    tmp,
    base,
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

test("the base is TMPDIR, and the box's own when nothing named one", () => {
  assertEquals(
    tmpBase({ TMPDIR: '/tmp/scratchpad' }, '/own'),
    '/tmp/scratchpad',
  )
  assertEquals(tmpBase({}, '/own'), '/own')
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

// The run leaks by hand: a command that mkdirs a `tasks-*` entry in /tmp is
// exactly the spawn site writing past TMPDIR the check is for. Every
// worktree's run shares /tmp, so the entry is said and the run still passes.
test('a stray in /tmp is said, and the run passes', () =>
  base([], async (tmp) => {
    let said: string[] = []
    let box = rig({
      tmp,
      base: `${tmp}/base`,
      child: () => Deno.mkdirSync(`${tmp}/tasks-e2e-a`),
    })
    assertEquals(await scratch(['mkdir'], {}, (l) => said.push(l), box), 0)
    assertStringIncludes(said.join('\n'), `${tmp}/tasks-e2e-a`)
    assertStringIncludes(said.join('\n'), 'Not failing')
  }))

test("the box's own base loses the runs that are gone and keeps the live", () =>
  base([], async (dir) => {
    let box = rig({ tmp: dir, base: dir })
    let live = `${dir}/tasks-run-${box.spawn()}`
    for (let run of [live, `${dir}/tasks-run-4242`]) Deno.mkdirSync(run)
    assertEquals(await scratch(['true'], {}, () => {}, box), 0)
    assertEquals([...tasksEntries(dir)], [live.slice(dir.length + 1)])
  }))

test('scratch lends every machine state directory inside its own run', () =>
  base([], async (root) => {
    // A fresh runner's named base may not exist, even its parent.
    let dir = `${root}/missing/base`
    let env: Record<string, string> = {}
    let box = rig({ tmp: root, child: (given) => void (env = given) })
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

test('scratch git fixtures do not inherit the caller repository', () =>
  base(['caller'], async (root) => {
    let caller = `${root}/caller`
    let config = '[core]\n\tbare = false\n'
    Deno.writeTextFileSync(`${caller}/config`, config)
    let local = {
      GIT_DIR: caller,
      GIT_COMMON_DIR: caller,
      GIT_INDEX_FILE: `${caller}/index`,
      GIT_OBJECT_DIRECTORY: `${caller}/objects`,
      GIT_CONFIG_PARAMETERS: "'core.bare=false'",
    }
    let env = { ...local, TMPDIR: root, PATH: '/tools' }
    let given: Record<string, string> = {}, initialized = ''
    let box = {
      ...rig({
        tmp: root,
        child: (child) => {
          given = child
          let fixture = `${child.TMPDIR}/fixture`
          Deno.mkdirSync(fixture)
          // Git's repository selector wins over `git -C fixture init --bare`.
          // The process boundary models that effect, without starting Git.
          Deno.writeTextFileSync(
            `${child.GIT_DIR ?? fixture}/config`,
            '[core]\n\tbare = true\n',
          )
          initialized = Deno.readTextFileSync(`${fixture}/config`)
        },
      }),
      gitLocal: () => Promise.resolve(Object.keys(local)),
    }
    assertEquals(
      await scratch(['git', 'init', '--bare'], env, () => {}, box),
      0,
    )
    assertEquals(Deno.readTextFileSync(`${caller}/config`), config)
    assertEquals(initialized, '[core]\n\tbare = true\n')
    for (let name of Object.keys(local)) assertEquals(given[name], undefined)
    assertEquals(given.PATH, env.PATH)
    assertEquals(env, { ...local, TMPDIR: root, PATH: '/tools' })
  }))

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
    let box = rig({ tmp: dir, child: (env) => void box.spawn({ env }) })
    assertEquals(
      await scratch(['sh'], { TMPDIR: dir }, (l) => said.push(l), box),
      0,
    )
    assertStringIncludes(said.join('\n'), '1 process still ran')
    assertEquals(inside(`${dir}/tasks-run-${Deno.pid}`, box.ps()), [])
  }))
