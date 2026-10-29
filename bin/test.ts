// Tests run on Deno, with a separate document for the terminal UI. Page
// behavior runs in process on linkedom. With no paths, the dependency graph
// selects only tests reached by branch and working changes; cached passes
// leave out tests already passed unchanged. Paths narrow an explicit run.
// There are no browser or workerd tests. A run whose files reach the Worker's
// generated files and npm tree makes them current first (`READIES`).

import type { TestCommand } from './phases.ts'
import type { Suite } from './test-budget.ts'

/** Set in a run's environment, naming the run: every process it starts
 * inherits it, so a run started from inside one refuses. */
export let RUN = 'TASKS_TEST_RUN'

if (import.meta.main && Deno.args[0] !== '--bulk') {
  let outer = Deno.env.get(RUN)
  if (outer) {
    console.error(
      `bin/test.ts: refused — this is inside test run ${outer}, and a test ` +
        'never starts the suite (it would start itself again, and again)',
    )
    Deno.exit(2)
  }
}

let { relative } = await import('node:path')
let { fileURLToPath } = await import('node:url')
let { choose } = await import('@yaks/testing/choose')
let { changes } = await import('./test-changes.ts')
let { find, tested } = await import('@yaks/testing/find')
let { own } = await import('@yaks/testing/own')
let { AUDIT } = await import('@yaks/testing/reads')
let { runTestCommands } = await import('./phases.ts')
let { budget, measure, OWN, read, say } = await import('./test-budget.ts')
let { SHARED } = await import('./test-runtime.ts')
let { library } = await import('./sqlite.ts')

export let ROOTS = ['packages', 'bin', 'workers', 'apps', 'homepage-concepts']

/** The module cache this process runs on: DENO_DIR where the environment
 * pins it, and Deno's own default for the platform otherwise. The run pins
 * it for every process it starts, so a test that moves HOME still hands its
 * deno children the cache the run was invoked with. */
export let denoDir = (
  env: Record<string, string | undefined> = Deno.env.toObject(),
  os: string = Deno.build.os,
) =>
  env.DENO_DIR ||
  (os == 'darwin'
    ? `${env.HOME}/Library/Caches/deno`
    : os == 'windows'
    ? `${env.LOCALAPPDATA}\\deno`
    : `${env.XDG_CACHE_HOME ?? `${env.HOME}/.cache`}/deno`)

export let PLATFORMS = ['deno', 'terminal']

/// platform('packages/graph/graph_test.ts') -> 'deno'
/// platform('packages/web/live_test.ts') -> 'deno'
/// platform('packages/browse/tui/run_test.tsx') -> 'terminal'
/** The TUI owns a terminal document; page behavior uses linkedom in Deno. */
export let platform = (file: string) =>
  file.includes('packages/browse/tui/') ? 'terminal' : 'deno'

/**
 * Git as every process a run starts sees it: none of the machine's config
 * (its hooks template, rerere, its default branch), and never a prompt. The
 * global scope holds only an identity, beneath whatever a repository or a
 * command sets.
 */
export let GIT = {
  GIT_CONFIG_GLOBAL: new URL('./test.gitconfig', import.meta.url).pathname,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
}

/** The runner every platform's runtime runs. */
let RUNNER = new URL(import.meta.resolve('@yaks/testing/main')).pathname

/**
 * The module cache a runtime runs on: the run's, every part of it linked but
 * Deno's code cache. A runtime compiles every function as its module loads
 * (`runtime`), and code cached under one V8 flag is refused under another, so
 * sharing a code cache with the `yak` command, the servers and a test's own
 * deno children would have each recompile what the other last wrote there
 * (44 ms to 144 ms for the CLI's import). Kept apart, a runtime reads its
 * code compiled whole, which is most of what loading TypeScript or starting
 * a worker in a test took: 296 ms to 108 ms for the compiler catalog's.
 */
export let wholeDir = (shared: string = denoDir()) => {
  let dir = `${shared.replace(/\/+$/, '')}-whole`
  Deno.mkdirSync(dir, { recursive: true })
  for (let { name } of Deno.readDirSync(shared)) {
    if (name.startsWith('v8_code_cache')) continue
    try {
      Deno.symlinkSync(`${shared}/${name}`, `${dir}/${name}`)
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e
    }
  }
  return dir
}

/** How a platform's runtime starts: its arguments before the runner's, and
 * what it adds to the environment. */
export let runtime = (shared: string = denoDir()) => ({
  args: [
    'run',
    '--frozen',
    // Type-checking is separate from running tests (`deno check --doc`).
    '--no-check',
    '-A',
    // Every function compiled as its module loads. A test runs once, so V8's
    // lazy compilation charged each test for compiling its own body and all
    // the code it was the first to call: a third of what a test between 0.5
    // and 1 ms took, paid by whichever test came first. Compiled whole, the
    // run takes as long.
    //
    // Source positions with it. Deno reads the source positions of the
    // functions on the stack whenever an error is made, and V8 keeps none
    // until asked: the first error made in or under a function had it parse
    // that function again, 0.3 to 0.6 ms for the first refusal through the
    // query parser, paid by whichever test refused first.
    '--v8-flags=--no-lazy,--no-enable-lazy-source-positions',
    '--preload',
    new URL('./test-runtime.ts', import.meta.url).pathname,
  ],
  env: { DENO_DIR: wholeDir(shared), [SHARED]: shared },
})

// Deno prints a test's name before running it, then finishes the same line
// with its result. Keep that name, and each test that failed, while the
// reporter's bytes stay buffered for an intact report at exit.
// deno-lint-ignore no-control-regex -- ESC starts the reporter's color codes
let ansi = /\x1b\[[0-9;]*m/g

/** What a platform's runtime has said so far: the test or file it is on,
 * its phase, when that phase began or a test last ended (by the clock
 * `observe` is given), how many tests ended, and each that failed. */
export type Progress = {
  name: string
  at: number
  phase: 'loading' | 'testing'
  count: number
  failed: string[]
}

export let observe = async (
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  progress: Progress,
  now: () => number = () => Date.now(),
) => {
  let decoder = new TextDecoder()
  let pending = ''
  let running = false
  let read = (line: string, done = false) => {
    line = line.replace(ansi, '')
    let loading = line.match(/^loading (.+)$/)
    if (loading && done) {
      progress.name = `loading ${loading[1]}`
      progress.phase = 'loading'
      progress.at = now()
      running = false
    }
    let test = line.match(/^(.+?) \.\.\./)
    if (test) {
      if (progress.phase == 'loading') progress.at = now()
      progress.phase = 'testing'
      progress.name = test[1]
      running = true
    }
    // Console output can end the test's opening line. Its result then starts
    // a line of its own; a repeated result outside a running test is no news.
    let result = line.match(
      /^(?:.+? \.\.\. )?(ok|FAILED|ignored) \(\d+(?:µs|ms|s|m\d+s)\)$/,
    )
    if (done && running && result) {
      progress.at = now()
      progress.count++
      if (result[1] == 'FAILED') progress.failed.push(progress.name)
      running = false
    }
  }
  for await (let bytes of stream) {
    pending += decoder.decode(bytes, { stream: true })
    let lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (let line of lines) read(line, true)
    read(pending)
  }
  read(pending + decoder.decode(), true)
}

/** Loading a runtime or fixture has its own allowance. A short test idle
 * limit begins only once the file's tests start; a load that hangs still
 * ends, by the same own-time clock as a test. */
export let stalled = (progress: Progress, now: number, limit = 60_000) =>
  now - progress.at >= (progress.phase == 'loading' ? 60_000 : limit)

/** Each chunk `stream` says, kept in `into` as it passes. */
export async function* kept(
  stream: AsyncIterable<Uint8Array>,
  into: Uint8Array[],
) {
  for await (let b of stream) {
    into.push(b)
    yield b
  }
}

/// reported('a ... ok (1ms)\n\nok | 1 passed | 0 failed (2ms)\n') -> true
/// reported('a ... ok (1ms)\nb ... ') -> false
/** Whether a runtime said its closing report, the line its runner ends on. */
export let reported = (out: string) =>
  /^(?:ok|FAILED) \| \d+ passed \|/m.test(out.replace(ansi, ''))

/// died({ name: 'b', at: 0, phase: 'testing', count: 9, failed: [] }) -> ' during b, after 9 tests'
/// died({ name: 'c', at: 0, phase: 'testing', count: 1, failed: ['a'] }) -> ' during c, after 1 test; failed before it: a'
/// died({ name: 'd', at: 0, phase: 'testing', count: 9, failed: ['a', 'b'] }) -> ' during d, after 9 tests; failed before it: a; b'
/**
 * What a runtime that ended before its closing report was doing, from what
 * it said as it ran: the test or file it was on, how many tests had ended,
 * and each that failed. Their errors are in what it said (./run.ts `file`);
 * the report that would have listed them never came.
 */
export let died = ({ name, count, failed }: Progress) =>
  ` during ${name}, after ${count} test${count == 1 ? '' : 's'}${
    failed.length ? `; failed before it: ${failed.join('; ')}` : ''
  }`

/// failures('a ... ok (1ms)\n\nERRORS\n\nb => ./a_test.ts\nError: no\n\n\nFAILED | 1 passed | 1 failed (2ms)\n', '') -> 'ERRORS\n\nb => ./a_test.ts\nError: no\n\n'
/// failures('', 'error: Module not found\n', 'test deno: 1') -> 'test deno: 1\nerror: Module not found\n'
/// failures('a ... FAILED (50s)\nError: the test did not end within 50000ms\n\nb ... ok (1ms)\nc ... ', '', 'test deno: SIGTERM during c', 1)
///   -> 'test deno: SIGTERM during c\na ... FAILED (50s)\nError: the test did not end within 50000ms\nc ...\n'
/**
 * What a run says of a platform that failed, unless `--verbose`: its
 * runner's report of the failures, without the counts that the run's own
 * closing line sums (bin/test-budget.ts); or, from a runner that ended
 * before it reported, `why`, each failure it said as it ran (a test's line
 * and its error, packages/testing/run.ts `file`), and the last `lines` it
 * said. Nothing about a test that passed, nor what a test printed:
 * `--verbose` says those.
 */
export let failures = (out: string, err: string, why = '', lines = 40) => {
  let plain = out.replace(ansi, '')
  let at = plain.lastIndexOf('\nERRORS\n')
  if (at >= 0) {
    return plain.slice(at + 1)
      .replace(/\n+(?:ok|FAILED) \| \d+ passed \|[^\n]*\n*$/, '\n\n')
  }
  let all = (plain + err.replace(ansi, '')).trimEnd().split('\n')
  let last = Math.max(0, all.length - lines)
  let said = [
    ...`${all.slice(0, last).join('\n')}\n`.matchAll(
      /^.+? \.\.\. FAILED \([^)]*\)\n(?:[^\n]+\n)*/gm,
    ),
  ].map((m) => m[0].trimEnd())
  return [why, ...said, ...all.slice(last)].join('\n') + '\n'
}

// Writes to a pipe may be short. Finish one report synchronously so another
// platform cannot splice bytes into its test names and durations.
function report(
  stream: { writeSync(bytes: Uint8Array): number },
  bytes: Uint8Array,
) {
  while (bytes.length) bytes = bytes.subarray(stream.writeSync(bytes))
}

let group = () => {
  let stat = Deno.readTextFileSync('/proc/self/stat')
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2])
}

// A file from the checkout, as keys name it.
let rel = (url: string | URL) => relative(Deno.cwd(), fileURLToPath(url))

/** What every runtime's files depend on beside their own graphs: the config
 * and lock the runner resolves by, and git's config. */
export let ALSO = [
  'deno.json',
  'deno.jsonc',
  'deno.lock',
  rel(new URL('./test.gitconfig', import.meta.url)),
]

/** What runs every file: the runner, this file starting it, the preload, and
 * the scratch directory `deno task test` gives them (./scratch.ts). Each is
 * keyed by what loads with it. Imports delayed until after the nested-run
 * refusal are explicit roots here too, so budget records participate in
 * every key. */
export let RUNS = [
  rel(import.meta.resolve('@yaks/testing/main')),
  rel(import.meta.url),
  rel(new URL('./phases.ts', import.meta.url)),
  rel(new URL('./test-budget.ts', import.meta.url)),
  rel(new URL('./sqlite.ts', import.meta.url)),
  rel(new URL('./test-runtime.ts', import.meta.url)),
  rel(new URL('./scratch.ts', import.meta.url)),
]

/** What the Worker's `ready` makes (workers/yak/wrangler.ts) is read by these:
 * the OAuth provider out of its npm tree, and the in-memory platform's static
 * assets over the generated public/ files (testing.ts `assets`). Both are
 * gitignored, so a fresh worktree has neither until a run that reaches them
 * makes them. */
export let READIES = [
  'workers/yak/oauth-provider.ts',
  'workers/yak/testing.ts',
]

/** Relevant files, leaving out sources and observed dependencies already passed. */
export let chosen = async (
  files: string[],
  all: boolean,
  also: string[] = [],
  changed?: string[],
) =>
  await choose(files, {
    all,
    changed,
    observed: true,
    kind: (f) => tested(f) ? platform(f) : 'deno',
    also: () => [...ALSO, ...also],
    runner: RUNS,
  })

// `--bulk` gives each document environment its selected files and their keys.
if (import.meta.main && Deno.args[0] === '--bulk') {
  // This coordinator and all its children stay in the outer runner's process
  // group: a signal still settles the complete tree, not just a platform's
  // leader.
  let args = Deno.args.slice(1)
  let flags = args.filter((a) => a.startsWith('--'))
  let paths = args.filter((a) => !a.startsWith('--'))
  let verbose = flags.includes('--verbose')
  let idleLimit = Number(Deno.env.get('TASKS_TEST_IDLE_MS') ?? 60_000)
  if (!Number.isFinite(idleLimit) || idleLimit < 1) {
    throw new Error('invalid test idle limit')
  }
  // How often the watch looks: at each tick it detects a vanished parent and
  // an idle platform, so its granularity bounds how fast either is caught. A
  // second in a run; a test that provokes one of those sets it small.
  let pulse = Number(Deno.env.get('TASKS_TEST_WATCH_MS') ?? 1_000)
  if (!Number.isFinite(pulse) || pulse < 1) {
    throw new Error('invalid test watch interval')
  }
  let runs = PLATFORMS.map((p) =>
    [
      p,
      paths.filter((f) => tested(f) ? platform(f) == p : p == 'deno'),
    ] as const
  ).filter(([, files]) => files.length)
  let children: Deno.ChildProcess[] = []
  let host = runtime()
  // Each runtime audits into a file of its own, so the runner sees what each
  // test file reads (@yaks/testing/reads).
  let audit = (p: string) => ({
    [AUDIT]: Deno.makeTempFileSync({ prefix: `test-${p}-`, suffix: '.jsonl' }),
  })
  let spawn = (
    p: string,
    files: readonly string[],
    env?: Record<string, string>,
  ) => {
    let child = new Deno.Command(Deno.execPath(), {
      args: [...host.args, RUNNER, `--platform=${p}`, ...flags, ...files],
      env: { ...env, ...host.env, ...audit(p) },
      stdin: 'inherit',
      // Keep each reporter intact: platforms running at once would
      // interleave their half-lines. Drain concurrently below.
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    children.push(child)
    return child
  }
  let failed: string[] = []
  // Each platform is idle by its runtime's own time once that runtime starts
  // (@yaks/testing/own): the wall clock less what the box kept it, and every
  // process it started, waiting for a CPU. A runtime that hangs waits for no
  // CPU, so it is ended as soon on a busy box as on an idle one.
  let progress = runs.map(() => {
    let now = own(Deno.pid, { every: pulse / 2 })
    return {
      now,
      name: 'loading tests',
      at: now(),
      phase: 'loading' as Progress['phase'],
      count: 0,
      failed: [] as string[],
      said: 0,
      reported: Date.now(),
      done: false,
    }
  })
  // What each platform has said, kept as it comes: one ended before its
  // closing report is said with all of it.
  let heard = runs.map(() => ({
    out: [] as Uint8Array[],
    err: [] as Uint8Array[],
  }))
  let bytes = (parts: Uint8Array[]) => {
    let all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    parts.reduce((at, p) => (all.set(p, at), at + p.length), 0)
    return all
  }
  // A platform's report, once: whole when verbose, and otherwise only a red
  // one's failures. `status` is how its runtime ended; none, when it outlived
  // the run's end.
  let say = (i: number, status?: Deno.CommandStatus) => {
    if (progress[i].done) return
    progress[i].done = true
    let out = bytes(heard[i].out), err = bytes(heard[i].err)
    let said = new TextDecoder().decode(out)
    let ok = status?.success ?? false
    // A runtime that died (out of memory, say) never listed its failures.
    let why = `test ${runs[i][0]}: ${
      status ? status.signal ?? status.code : 'still running'
    }${ok || reported(said) ? '' : died(progress[i])}`
    if (verbose) {
      report(Deno.stdout, out)
      report(Deno.stderr, err)
    } else if (!ok) {
      let text = failures(said, new TextDecoder().decode(err), why)
      report(Deno.stdout, new TextEncoder().encode(text))
    }
    if (!ok) failed.push(why)
  }
  // The closing word on a long run: which platforms were red, after every one
  // of them has printed its own report. A short run said each as it ended.
  let finish = () => {
    clearInterval(watch)
    if (verbose && failed.length) {
      console.error(`\n─── ${failed.length} failing platform(s) ───`)
      for (let line of failed) console.error(`  ${line}`)
    }
    Deno.exit(failed.length ? 1 : 0)
  }
  // How long ended platforms have to end and say what they said; one still
  // going after it is said as it stands.
  let GRACE = 10_000
  let parent = Deno.ppid
  let ending = false
  // Ends the run: every platform ends, then each says what it said, so the
  // failure that came before a hang is in the report.
  let end = (why: string) => {
    if (ending) return
    ending = true
    console.error(why)
    failed.push(why)
    // runTestCommands starts this coordinator as a session leader. End its
    // whole process group, including test-spawned descendants, but this
    // process, which hears its own signal as nothing. A direct `--bulk`
    // invocation only owns its immediate children.
    if (group() == Deno.pid) {
      Deno.addSignalListener('SIGTERM', () => {})
      Deno.kill(-Deno.pid, 'SIGTERM')
    } else for (let child of children) child.kill('SIGTERM')
    setTimeout(() => {
      for (let i of runs.keys()) say(i)
      finish()
    }, GRACE)
  }
  let watch = setInterval(() => {
    if (Deno.ppid != parent) {
      end('test bulk: parent exited; ending its platforms')
      return
    }
    for (let [i, p] of progress.entries()) {
      if (p.done) continue
      let name = runs[i][0]
      let now = p.now()
      let idle = now - p.at
      if (p.count > p.said && Date.now() - p.reported >= 15_000) {
        // Progress is news to a person watching, not to an agent reading
        // the run once it ends; a wait is news to both.
        if (verbose) {
          console.error(
            `test ${name}: ${p.count} tests completed; now ${p.name}`,
          )
        }
        p.said = p.count
        p.reported = Date.now()
      } else if (idle >= 30_000 && Date.now() - p.reported >= 30_000) {
        console.error(
          `test ${name}: waiting ${Math.floor(idle / 1000)}s on ${p.name}`,
        )
        p.reported = Date.now()
      }
      if (stalled(p, now, idleLimit)) {
        end(
          `test ${name}: no test completed for ${
            Math.ceil(idle / 1000)
          }s; last: ${p.name}`,
        )
        return
      }
    }
  }, pulse)
  let run = async (i: number, child: Deno.ChildProcess) => {
    let p = progress[i]
    p.now = own(child.pid, { every: pulse / 2 })
    p.at = p.now()
    let followed = Promise.all([
      observe(kept(child.stdout, heard[i].out), p, p.now),
      observe(kept(child.stderr, heard[i].err), p, p.now),
    ])
    let status = await child.status
    await followed
    say(i, status)
  }
  await Promise.all(runs.map(([p, files], i) => run(i, spawn(p, files))))
  finish()
} else if (import.meta.main) {
  Deno.env.set(RUN, String(Deno.pid))
  // The one SQLite every runtime of the run opens, on this box as on main's
  // gate (./sqlite.ts). Every file's key holds the library's bytes, so a file
  // that passed on another SQLite runs again.
  let sqlite = await library()
  Deno.env.set('DENO_SQLITE_PATH', sqlite)
  let b = await budget()
  let from = Deno.args.find((a) => a.startsWith('--from='))?.slice(7)
  if (from) Deno.exit(await say(b, await read(from), Deno.args))
  let flags = Deno.args.filter((a) => a.startsWith('--') && !OWN.test(a))
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let tags = flags.filter((a) => a.startsWith('--tag='))
    .flatMap((a) => a.slice(6).split(','))
  let named = PLATFORMS.filter((p) => tags.includes(p))
  let on = (p: string) => !named.length || named.includes(p)
  let { tests, pages } = await find(paths.length ? paths : ROOTS)
  let files = [
    ...tests.filter((f) => on(platform(f))),
    ...on('deno') ? pages : [],
  ]
  // Choose files before starting runtimes; hand each its dependency keys.
  let all = flags.includes('--all')
  let changed = !paths.length && !all ? await changes() : undefined
  let { keys, run, reaches } = await chosen(files, all, [sqlite], changed)
  if (run.length && reaches(READIES)) {
    let { ready } = await import('../workers/yak/wrangler.ts')
    await ready(!flags.includes('--verbose'))
  }
  let keyed = await Deno.makeTempFile({ prefix: 'test-keys-', suffix: '.json' })
  await Deno.writeTextFile(keyed, JSON.stringify(Object.fromEntries(keys)))
  let suite: Suite = async (more) => {
    if (!run.length) return { code: 0 }
    let bulk: TestCommand = {
      command: Deno.execPath(),
      args: [
        'run',
        '-A',
        import.meta.filename!,
        '--bulk',
        ...flags,
        `--keys=${keyed}`,
        ...more,
        ...run,
      ],
      env: { DENO_DIR: denoDir(), ...GIT },
    }
    return await runTestCommands([bulk])
  }
  let whole = !paths.length && !tags.length && flags.includes('--all')
  let left = files.length - run.length
  let measured = await measure(suite, whole)
  Deno.exit(await say(b, { ...measured, left }, Deno.args))
}
