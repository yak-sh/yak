// Tests run on Deno, with a separate document for the terminal UI. Page
// behavior runs in process on linkedom. With no paths, the dependency graph
// selects tests reached by branch and working changes: every test file the
// change edits, then those naming a declaration it edits or one naming it
// (@yaks/testing/names), then a changed workspace package, then its nearest
// consumers, as many as a few seconds hold by what each took as it last ran
// here; main's CI runs the rest after the push. Cached passes leave out tests already passed unchanged.
// Paths narrow an explicit run.
// There are no browser or workerd tests. A run whose files reach the Worker's
// generated files and npm tree makes them current first (`READIES`).

import type { TestCommand } from './phases.ts'
import type { Suite } from './test-budget.ts'
import type { Survey } from '@yaks/testing/deps'
import type { Examples } from '@yaks/testing/examples'
import type { Prepared } from './check-types.ts'

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
let { changes, edits, member } = await import('./test-changes.ts')
let { check, format } = await import('./test-checks.ts')
let { excluded, MADE: GENERATORS, sourceSurvey } = await import(
  './check-types.ts'
)
let { discover, PAGES, tested } = await import('@yaks/testing/find')
let { FACTS, survey, took } = await import('@yaks/testing/deps')
let { own } = await import('@yaks/testing/own')
let { runTestCommands } = await import('./phases.ts')
let { budget, measure, OWN, read, say } = await import('./test-budget.ts')
let { SHARED } = await import('./test-runtime.ts')
let { library } = await import('./sqlite.ts')

export let ROOTS = [
  'apps',
  'bench',
  'bin',
  'packages',
  'workers',
]

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
 * The runtime shares downloaded modules with the run, but keeps its own V8
 * code cache. Its source-position flag differs from the CLI and a test's
 * deno children: sharing their cache would have each replace code the other
 * cannot use. The flag-specific directory also keeps earlier worktrees'
 * eager compilation cache separate.
 */
export let runtimeDir = (shared: string = denoDir()) => {
  let dir = `${shared.replace(/\/+$/, '')}-test-no-lazy-source-positions`
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
    // The run's source checks type its change's reach (./test-checks.ts),
    // and main's CI every module.
    '--no-check',
    '-A',
    // Compile functions when used, so a selected run does not compile unused
    // Store and Builder methods. Keep their source positions when compiled:
    // otherwise the first Error.stack reparses functions on its stack.
    '--v8-flags=--no-enable-lazy-source-positions',
    '--preload',
    new URL('./test-runtime.ts', import.meta.url).pathname,
  ],
  env: { DENO_DIR: runtimeDir(shared), [SHARED]: shared },
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
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  rel(new URL('./test.gitconfig', import.meta.url)),
]

/** Execution and assertions are shared test dependencies. Selection, loading
 * and pass bookkeeping have their own consumers; editing them does not change
 * the behavior each product test checks. */
export let RUNS = [
  rel(new URL('../packages/testing/run.ts', import.meta.url)),
  rel(new URL('./test-runtime.ts', import.meta.url)),
]

/** What the Worker's `ready` makes (workers/yak/wrangler.ts) is read by these:
 * the in-memory platform's static assets over the generated public/ files
 * (binding-probe.ts `assets`, which testing.ts and the RAM probes use). They
 * are gitignored, so a fresh worktree has none until a run that reaches them
 * makes them. */
export let READIES = [
  'workers/yak/binding-probe.ts',
]

/// MADE.test('workers/yak/public/_client.js') -> true
/// MADE.test('workers/yak/public/_web/app.js') -> true
/// MADE.test('workers/yak/public/_headers') -> false
/// MADE.test('workers/yak/public/docs.md') -> false
/// MADE.test('workers/yak/public/pricing.html') -> true
/// MADE.test('workers/yak/public/docs/index.html') -> false
/** The generated assets among those: what public/ holds under a name
 * beginning `_`, but `_headers`, which git keeps, and the site's pages at its
 * top (workers/yak/site/). A run makes them only when a file it runs read one
 * as this version of it last passed, or has no reads kept of this version: a
 * test added to a file may read what its last version did not. Bundling them
 * is seconds a run whose files never read them need not wait. */
export let MADE = /^workers\/yak\/public\/(?:_(?!headers$)|[^/]+\.html$)/

/** The generated modules a source imports (check-types.ts `MADE`): a run
 * whose files import one, as the public client imports its parts, makes the
 * assets whatever its files read. */
let IMPORTED = Object.values(GENERATORS).flat()

/** What a change's own run may expect its tests to take, in milliseconds,
 * loading included: with choosing and starting them, under the ten seconds an
 * agent may wait. The rest of its consumers run in main's CI after the push. */
export let SECONDS = 6_000

/// expected({ 'a_test.ts': { x: 100, y: 5 } })('a_test.ts') -> 125
/// expected({})('a_test.ts') -> 20
/// expected({ 'a_test.ts': { x: 100 } }, { 'a_test.ts': 900 })('a_test.ts') -> 900
/// expected({}, { 'b_test.ts': 10, 'c_test.ts': 290 })('a_test.ts') -> 150
/** What a file is expected to take: what it took whole as it last ran here
 * (@yaks/testing/deps `took`), loading included; else what its tests over the
 * budget last took (bench/test-budget.json) and a short load, or what a file
 * that ran here took on average, if that is more. Most files take a few
 * milliseconds and a few take seconds, so one costed at the typical file's
 * load would let every file not yet timed into a run and overrun its budget. */
export let expected = (
  list: Record<string, Record<string, number>>,
  took: Record<string, number> = {},
) => {
  let times = Object.values(took)
  let mean = times.reduce((sum, ms) => sum + ms, 0) / (times.length || 1)
  return (file: string) =>
    took[file] ??
      Math.max(
        Object.values(list[file] ?? {}).reduce((sum, ms) => sum + ms, 20),
        mean,
      )
}

/** Relevant files, leaving out sources and observed dependencies already
 * passed, and those past what a change's own run has time for. */
export let chosen = async (
  files: string[],
  all: boolean,
  also: string[] = [],
  changed?: string[],
  sources: string[] = [],
  inspect = survey,
  parsed?: ReadonlyMap<string, Examples>,
  edited?: Record<string, string[]>,
) =>
  await choose(files, {
    edits: edited,
    budget: SECONDS,
    cost: expected((await budget()).tests, took()),
    all,
    changed,
    sources,
    observed: true,
    kind: (f) => tested(f) ? platform(f) : 'deno',
    also: () => [...ALSO, ...also],
    runner: RUNS,
    owner: member,
    inspect,
    parsed,
  })

/// source('workers/yak/operator-line.ts') -> true
/// source('workers/yak/operator-line_test.ts') -> false
/// source('packages/graph') -> false
/// source('packages/graph/README.md') -> false
/** Whether a path a run is given names a source module: it stands for a
 * change to that module, and the run selects the tests depending on it. */
export let source = (path: string) =>
  /\.[mc]?[jt]sx?$/.test(path) && !tested(path)

/** Plan a run before starting runtimes, and start checking its sources: `ok`
 * settles beside the tests, the types of what the change reaches taking
 * seconds of one core. A whole run needs no git history or source checks: the
 * gate has already checked the sources. */
export let prepare = async (
  args: string[],
  sqlite: string,
  effects = {
    changes,
    edits,
    format,
    find: (paths: string[]) => discover(paths, PAGES),
    chosen,
    check: (
      changed: string[],
      prepared: Prepared,
      snapshot?: Promise<Survey | undefined>,
    ) => check(changed, undefined, undefined, prepared, snapshot),
    ready: async (
      quiet: boolean,
      assets: boolean,
    ): Promise<readonly string[] | void> => {
      let { ready } = await import('../workers/yak/wrangler.ts')
      let prepared: string[] = []
      await ready(quiet, {
        assets,
        prepared: (outputs) => {
          prepared = outputs.map((path) => relative(Deno.cwd(), path))
        },
      })
      return prepared
    },
  },
  resolve = sourceSurvey,
) => {
  let flags = args.filter((a) => a.startsWith('--') && !OWN.test(a))
  let paths = args.filter((a) => !a.startsWith('--'))
  let tags = flags.filter((a) => a.startsWith('--tag='))
    .flatMap((a) => a.slice(6).split(','))
  let named = PLATFORMS.filter((p) => tags.includes(p))
  let on = (p: string) => !named.length || named.includes(p)
  // A whole run has no change to find, and main's gate checks out one commit,
  // with no parent for git to compare it with.
  let all = flags.includes('--all')
  let changedPaths = all ? [] : await effects.changes()
  // What a whole change edits, which ranks the files naming it
  // (@yaks/testing/names); a run of named paths is no change's.
  let edited = all || paths.length ? undefined : effects.edits()
  void edited?.catch(() => {})
  let changedFiles = await effects.format(changedPaths)
  let snapshot = Promise.withResolvers<Survey | undefined>()
  void snapshot.promise.catch(() => {})
  let inspected = false
  let inspect = (paths: string[]) => {
    inspected = true
    let work = all ? survey(paths, undefined, FACTS) : resolve(paths)
    snapshot.resolve(work)
    return work
  }
  let imports = Promise.withResolvers<readonly string[]>()
  // A selection failure still settles the source job, even when no program
  // needs generated imports and therefore nobody awaits this receipt.
  void imports.promise.catch(() => {})
  let ok = all
    ? Promise.resolve(true)
    : effects.check(changedFiles, imports.promise, snapshot.promise)
      .catch((e) => (console.error(e), false))
  try {
    // Source files named are selected from as a change is, among every file;
    // the tests and pages named beside them are their own change, so each
    // reaches itself.
    let modules = paths.filter(source)
    let rest = paths.filter((p) => !source(p))
    let given = modules.length && rest.length
      ? await effects.find(rest)
      : undefined
    let { tests, pages, parsed } = await effects.find(
      paths.length && !modules.length ? paths : ROOTS,
    )
    let only = (found: { tests: string[]; pages: string[] }) => [
      ...found.tests.filter((f) => on(platform(f))),
      ...on('deno') ? found.pages : [],
    ]
    let files = only({ tests, pages })
    // Choose files before starting runtimes; hand each its dependency keys.
    let changed = modules.length
      ? [...modules, ...given ? only(given) : []]
      : !paths.length && !all
      ? changedPaths
      : undefined
    let { keys, run, beyond, reaches, read } = await effects.chosen(
      files,
      all,
      [sqlite],
      changed,
      changedFiles.filter((f) => /\.[mc]?[jt]sx?$/.test(f) && !excluded(f)),
      inspect,
      parsed,
      await edited,
    )
    if (!inspected) snapshot.resolve(undefined)
    let imported = reaches(IMPORTED)
    let prepared = imported || reaches(READIES)
      ? effects.ready(
        !flags.includes('--verbose'),
        imported ||
          run.some((f) => read(f)?.some((p) => MADE.test(p)) ?? true),
      ).then((outputs) => outputs ?? [])
      : Promise.resolve([])
    // Source discovery and other checks run beside readiness. Only preparing
    // generated imports awaits its receipts; runtimes still need ready assets.
    imports.resolve(prepared)
    await prepared
    return { flags, paths, tags, files, keys, run, beyond, ok }
  } catch (error) {
    snapshot.reject(error)
    imports.reject(error)
    await ok
    throw error
  }
}

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
  let spawn = (p: string, files: readonly string[], more: string[]) => {
    let child = new Deno.Command(Deno.execPath(), {
      args: [
        ...host.args,
        RUNNER,
        `--platform=${p}`,
        ...flags,
        ...more,
        ...files,
      ],
      env: host.env,
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
      // Where the output of the platform's latest runtime begins.
      from: 0,
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
    let last = new TextDecoder().decode(
      bytes(heard[i].out.slice(progress[i].from)),
    )
    let ok = status?.success ?? false
    // A runtime that died (out of memory, say) never listed its failures.
    let why = `test ${runs[i][0]}: ${
      status ? status.signal ?? status.code : 'still running'
    }${ok || reported(last) ? '' : died(progress[i])}`
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
  // A runtime keeps every module it loaded until it exits, so one that grew
  // full hands the files it did not reach to a fresh one
  // (packages/testing/main.ts `--rest`). The platform's report is all of its
  // runtimes', and its status the first failure, or a death, which ends it.
  let run = async (i: number) => {
    let [name, files] = runs[i]
    let p = progress[i]
    let rest = await Deno.makeTempFile({
      prefix: 'test-rest-',
      suffix: '.json',
    })
    let status: Deno.CommandStatus | undefined
    try {
      for (let part = 1, left = files; left.length && !ending; part++) {
        await Deno.writeTextFile(rest, '[]')
        let child = spawn(name, left, [
          `--rest=${rest}`,
          ...part > 1 ? [`--part=${part}`] : [],
        ])
        p.now = own(child.pid, { every: pulse / 2 })
        p.at = p.now()
        p.from = heard[i].out.length
        let followed = Promise.all([
          observe(kept(child.stdout, heard[i].out), p, p.now),
          observe(kept(child.stderr, heard[i].err), p, p.now),
        ])
        let ended = await child.status
        await followed
        status = ended.success && status ? status : ended
        left = JSON.parse(await Deno.readTextFile(rest))
      }
    } finally {
      await Deno.remove(rest).catch(() => {})
    }
    say(i, status)
  }
  await Promise.all(runs.map((_, i) => run(i)))
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
  let { flags, paths, tags, files, keys, run, beyond, ok } = await prepare(
    Deno.args,
    sqlite,
  )
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
  let left = files.length - run.length - beyond
  let measured = await measure(suite, whole)
  let code = await say(b, { ...measured, left, beyond }, Deno.args)
  // The tests' line closes on their own verdict; a failed source check says
  // its own last, so the run's last line is the run's verdict.
  if (!await ok) console.error('FAILED | the source checks above failed')
  Deno.exit(await ok ? code : 1)
}
