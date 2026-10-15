// One temp directory per run, owned by the runner. Deno.makeTempDir reads
// TMPDIR, so pointing it at `<base>/tasks-run-<pid>` puts every scratch dir a
// test mints inside one directory the run can remove — whether or not the test
// that made it reached its own cleanup. Roughly two hundred test call sites
// mint one; almost none remove it, and no amount of per-test `finally` survives
// a phase the runner kills, a fixture that throws, or a child that exits.
//
// HARNESS_HOME rides along for the same reason: a harness test that forks a
// task child checks the repository out at `$HARNESS_HOME/worktrees/<child>`,
// ~160 MB a time, and nothing removes it. Left at the owner's `~/.harness`
// that reached 500 checkouts and 81 GB, and a full disk is what made
// packages/harness/task_entry_test.ts fail (T-37621). Inside the run directory
// those checkouts die with the run.
//
// Three doors close the directory: normal exit, an accepted signal, and the
// next run's stale sweep inside an explicitly owned base (a SIGKILLed run
// cannot clean up after itself). Shared /tmp is never swept. Each door first
// ends the processes still running in the directory, since a test's server
// outlives a test killed before its `finally`, and its launcher's child sits
// in a session of its own. Afterwards the run reports any new `tasks-*` entry
// that appeared in the base directory: that is a spawn site writing to a
// hard-coded `/tmp` instead of TMPDIR, and it is how /tmp filled to 0 bytes
// free on this box three times (T-20558).
//
// That check reads the base directory, so a stray is only attributable while
// the base is this run's to watch — and the caller already says which case it
// is by naming TMPDIR or not. A named base (a scratchpad, a CI run) is nobody
// else's, so a stray there is this run's leak and fails it. An unnamed one is
// the shared `/tmp`, where this box runs CI and several worktrees at once: a
// `tasks-*` entry there may be another run's, so it prints as a warning
// naming the rule and the run passes (T-37656).
//
// Everything a run does to the box beyond its directories goes through a
// `Machine`: the processes it reads and signals, the clock it waits on, the
// command it starts and Git's list. The default is this box, through procfs.

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** A process as procfs shows it to a run: the environment it was started
 * with, as `NAME=value` entries, and where it works. */
export type Proc = { pid: number; env: string[]; cwd: string }

/** The box a run acts on. A test hands in one of its own. */
export type Machine = {
  /** The base a caller who names none shares with the whole box. */
  tmp: string
  /** The processes now running, but this one. */
  ps: () => Proc[]
  /** A process's command line, empty once it is gone. */
  command: (pid: number) => string
  /** Whether a process has yet to exit. */
  running: (pid: number) => boolean
  /** Send a process a signal; one already gone is no error. */
  kill: (pid: number, signal: Deno.Signal) => void
  /** The clock a run waits on, in ms. */
  now: () => number
  /** Run `fn` after `ms`; answers a cancel. */
  after: (ms: number, fn: () => void) => () => void
  /** Start a command on this terminal, `env` its whole environment. */
  start: (
    argv: string[],
    env: Record<string, string>,
  ) => Pick<Deno.ChildProcess, 'status' | 'kill'>
  /** The variables Git reads as one repository's own
   * (`git rev-parse --local-env-vars`). */
  gitLocal: () => Promise<string[]>
}

/** The processes of a box through Linux procfs at `root`, the same door
 * bin/test.ts uses to watch a process group. */
export let procfs = (
  root = '/proc',
): Pick<Machine, 'ps' | 'command' | 'running'> => {
  let read = (pid: number, file: string) => {
    try {
      return decode(Deno.readFileSync(`${root}/${pid}/${file}`))
    } catch {
      return undefined
    }
  }
  return {
    ps: () => {
      let names: string[]
      try {
        names = [...Deno.readDirSync(root)].map((e) => e.name)
      } catch {
        return []
      }
      let procs: Proc[] = []
      for (let name of names) {
        let pid = Number(name)
        if (!pid || pid == Deno.pid) continue
        let cwd = ''
        try {
          cwd = Deno.readLinkSync(`${root}/${pid}/cwd`)
            .replace(/ \(deleted\)$/, '')
        } catch { /* gone, or not ours to read */ }
        procs.push({ pid, env: read(pid, 'environ')?.split('\0') ?? [], cwd })
      }
      return procs
    },
    command: (pid) => read(pid, 'cmdline')?.replaceAll('\0', ' ').trim() ?? '',
    // A zombie has exited; only its parent's wait is left.
    running: (pid) => {
      let stat = read(pid, 'stat')
      return stat != null && stat[stat.lastIndexOf(')') + 2] != 'Z'
    },
  }
}

let here = procfs()

/** Whether a process on this box has yet to exit. */
export let running = here.running

/** This box. */
export let machine: Machine = {
  tmp: '/tmp',
  ...here,
  kill: (pid, signal) => {
    try {
      Deno.kill(pid, signal)
    } catch { /* already gone */ }
  },
  now: () => Date.now(),
  after: (ms, fn) => {
    let id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
  start: (argv, env) =>
    new Deno.Command(argv[0], {
      args: argv.slice(1),
      clearEnv: true,
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn(),
  gitLocal: async () => {
    let out = await new Deno.Command('git', {
      args: ['rev-parse', '--local-env-vars'],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) throw new Error(decode(out.stderr))
    return decode(out.stdout).trim().split('\n')
  },
}

/** Where temp dirs land for a process that has not been given a run dir. */
export let tmpBase = (
  env: { TMPDIR?: string } = Deno.env.toObject(),
  tmp = machine.tmp,
) => env.TMPDIR || tmp

/** Whether the base is this run's alone — the caller named it, so nobody
 * else mints there and a stray can be blamed on this run. */
export let ours = (env: { TMPDIR?: string } = Deno.env.toObject()) =>
  !!env.TMPDIR

/** The `tasks-*` entries of a directory — the family this repo mints. */
export let tasksEntries = (base: string) => {
  let names = new Set<string>()
  for (let e of Deno.readDirSync(base)) {
    if (e.name.startsWith('tasks-')) names.add(e.name)
  }
  return names
}

/// inside('/run', [{ pid: 1, env: ['TMPDIR=/run/t'], cwd: '/' }]) -> [1]
/// inside('/run', [{ pid: 2, env: [], cwd: '/run' }]) -> [2]
/// inside('/run', [{ pid: 3, env: ['TMPDIR=/run2'], cwd: '/run2/a' }]) -> []
/**
 * The processes still living in a run directory: a test's server, the worker
 * its launcher handed off, a child whose test was killed before its `finally`.
 * Whatever session or parent each has ended up with, it carries the run in its
 * environment (TMPDIR and the state directories) or works inside it.
 */
export let inside = (dir: string, procs: Proc[]): number[] => {
  let within = (path: string) => path == dir || path.startsWith(dir + '/')
  return procs
    .filter(({ env, cwd }) =>
      within(cwd) || env.some((e) => within(e.slice(e.indexOf('=') + 1)))
    )
    .map((p) => p.pid)
}

/**
 * End what still runs in a run directory before it is removed: asked to stop,
 * then cut off once `wait` ms pass. A process that keeps running after its run
 * holds a port and a deleted graph, and nothing else will ever end it.
 * Answers each process found, by pid and command line.
 */
export let reap = async (
  dir: string,
  m: Machine = machine,
  wait = 10_000,
): Promise<string[]> => {
  let found = new Map<number, string>()
  let ask = (signal: Deno.Signal) => {
    for (let pid of inside(dir, m.ps())) {
      if (!found.has(pid)) found.set(pid, m.command(pid).slice(0, 160))
      m.kill(pid, signal)
    }
  }
  let settle = async (ms: number) => {
    let end = m.now() + ms
    while ([...found.keys()].some(m.running) && m.now() < end) {
      await new Promise<void>((r) => m.after(50, r))
    }
  }
  ask('SIGTERM')
  if (!found.size) return []
  await settle(wait)
  // Whatever outlasted the wait, or started while the rest wound down.
  ask('SIGKILL')
  await settle(2000)
  return [...found].map(([pid, line]) => `${pid} ${line}`)
}

// A process the run left behind is a test that did not stop what it started.
let ended = (lines: string[], say: (line: string) => void) => {
  if (!lines.length) return
  let many = `${lines.length} process${lines.length == 1 ? '' : 'es'}`
  say(`\n─── ${many} still ran in the run directory, now ended ───`)
  for (let line of lines) say(`  ${line}`)
}

/** The run directories among `names` whose runner is gone. */
export let stale = (names: Iterable<string>, alive = running) =>
  [...names].filter((name) => {
    let owner = /^tasks-run-(\d+)$/.exec(name)
    return owner && !alive(Number(owner[1]))
  })

/**
 * Remove the run directories of runs that are gone, among the base's
 * `tasks-*` entries (read here unless the caller already has them). A run
 * killed outright never reaches its own cleanup; its pid is the receipt that
 * says so.
 */
export let sweep = (
  base: string,
  alive = running,
  names: Set<string> = tasksEntries(base),
) => {
  let gone: string[] = []
  for (let name of stale(names, alive)) {
    try {
      Deno.removeSync(`${base}/${name}`, { recursive: true })
      gone.push(name)
    } catch {
      // Another runner's sweep won the race, or the dir is not ours to remove.
    }
  }
  return gone
}

/**
 * `tasks-*` entries that appeared while the run ran. A run directory is
 * excluded: it belongs to whichever run minted it and cleans itself up.
 */
export let strays = (base: string, before: Set<string>) =>
  [...tasksEntries(base)]
    .filter((name) => !before.has(name) && !name.startsWith('tasks-run-'))
    .sort()

/**
 * Run a command in a run directory of its own under the base `env` names,
 * with `env` as its whole environment, and remove the directory once the
 * command ends. A `tasks-*` entry that appeared beside it is reported on
 * `say`. Answers the exit code the run ends with.
 */
export let scratch = async (
  argv: string[],
  env: Record<string, string> = Deno.env.toObject(),
  say: (line: string) => void = console.error,
  m: Machine = machine,
): Promise<number> => {
  let base = tmpBase(env, m.tmp)
  let mine = ours(env)
  if (mine) Deno.mkdirSync(base, { recursive: true })
  // One read of the base serves both: a shared /tmp holds thousands of entries.
  let before = tasksEntries(base)
  // A dead PID proves no process owns it, not that this run owns its files.
  // The default /tmp is shared with other sessions.
  if (mine) {
    for (let name of stale(before, m.running)) {
      ended(await reap(`${base}/${name}`, m), say)
    }
    sweep(base, m.running, before)
  }

  // Git hooks export repository-local coordinates. A fixture's `git -C`
  // does not override GIT_DIR: `init --bare` can reinitialize the caller's
  // checkout instead. Use Git's own list, including command-scope config,
  // so every descendant discovers only the scratch repository it asks for.
  let clean = { ...env }
  for (let name of await m.gitLocal()) delete clean[name]

  let dir = `${base}/tasks-run-${Deno.pid}`
  Deno.mkdirSync(dir, { recursive: true })
  let child = m.start(argv, {
    ...clean,
    TMPDIR: dir,
    TASKS_HOME: `${dir}/tasks`,
    PROCESS_DIR: `${dir}/processes`,
    HARNESS_HOME: `${dir}/harness`,
    HARNESS_WORKTREE_DIR: `${dir}/harness/worktrees`,
    HARNESS_DB: `${dir}/harness/yak.db`,
  })

  // Hand the signal to the run and wait for it: the directory is only safe to
  // remove once the processes writing into it are done. A shell reads 130/143
  // the same way it reads the death itself, and reporting the leak first is
  // worth more here than dying by signal.
  let raise: Deno.Signal | undefined
  let listeners = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    let handler = () => {
      raise ??= signal
      try {
        child.kill(signal)
      } catch {
        // Already gone; the status below is the outcome.
      }
    }
    Deno.addSignalListener(signal, handler)
    return [signal, handler] as const
  })

  let status = await child.status
  for (let [signal, handler] of listeners) {
    Deno.removeSignalListener(signal, handler)
  }

  ended(await reap(dir, m), say)
  let held: unknown
  try {
    Deno.removeSync(dir, { recursive: true })
  } catch (error) {
    held = error
  }

  let leaked = strays(base, before)
  if (held) say(`could not remove ${dir}: ${held}`)
  if (leaked.length) {
    let many = `${leaked.length} temp entr${leaked.length == 1 ? 'y' : 'ies'}`
    say(
      `\n─── ${many} ${
        mine ? 'leaked outside' : 'appeared beside'
      } the run directory ───`,
    )
    for (let name of leaked) say(`  ${base}/${name}`)
    say(
      mine
        ? 'Mint scratch under TMPDIR (Deno.makeTempDir does), never a literal /tmp.'
        : `Not failing: ${base} is shared, so these may be another run's.\n` +
          'Name a base of your own (TMPDIR=<dir>) and the check is exact.',
    )
  }

  let signal = raise ?? status.signal
  if (signal) return signal == 'SIGINT' ? 130 : 143
  return status.code || (held || (mine && leaked.length) ? 1 : 0)
}

if (import.meta.main) {
  if (!Deno.args.length) {
    console.error('usage: scratch.ts <command> [args...]')
    Deno.exit(2)
  }
  Deno.exit(await scratch(Deno.args))
}
