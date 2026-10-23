// Every test in the repository, divided by the platform it runs on, each
// platform's tests in one runtime of @yaks/testing's runner, started once
// per run (M-39441):
//
// - deno: every `*_test.ts`, and every example: a fenced block in a README
//   or a doc comment, and a `///` doctest;
// - browser and terminal: the web app's tests and the TUI's, each host
//   setting up the globals of its own kind of document;
// - workerd: every `*_workerd_test.ts`, against the one kernel
//   workers/yak/probe-suite.ts starts for the run.
//
// `deno task test [--tag=t]... [--all] [--verbose] [path...]` runs what lies
// under the paths given, or all of it, its platforms at once, and holds what
// each test took to the budget (./test-budget.ts): a test over 1 ms that
// bench/test-budget.json does not list fails the run, measured again first.
// A platform's name is a tag every test on it carries, so `--tag=workerd`
// runs that platform alone. A file whose tests all passed, with nothing it
// depends on changed since, is left out unless `--all` is given
// (packages/testing/deps.ts). `--write`, `--report` and `--from=dir` are the
// budget's.
//
// A run says its failures, each error cut short, a line for what the budget
// flags, and one closing line; an agent reads all of it on every later turn.
// `--verbose` says each test as it ran, each error whole, and the budget's
// findings in full: what the gate's log keeps.

import { find, tested } from '@yaks/testing/find'
import { runTestCommands, type TestCommand } from './phases.ts'
import { budget, hold, measure, OWN, read, type Suite } from './test-budget.ts'
import { SHARED } from './test-runtime.ts'

export let ROOTS = ['packages', 'bin', 'workers', 'apps']

/** Set in a run's environment, naming the run: every process it starts
 * inherits it, so a run started from inside one refuses. */
export let RUN = 'TASKS_TEST_RUN'

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

export let PLATFORMS = ['deno', 'browser', 'terminal', 'workerd']

/** A test that runs against the run's kernel, in workerd. */
export let workerd = (file: string) => /_workerd_test\.tsx?$/.test(file)

/// platform('packages/graph/graph_test.ts') -> 'deno'
/// platform('packages/web/live_test.ts') -> 'browser'
/// platform('packages/browse/tui/run_test.tsx') -> 'terminal'
/// platform('workers/yak/mail_workerd_test.ts') -> 'workerd'
/**
 * The platform a test file runs on. The web app's files set up a browser tab
 * (a document, and the app's own state, which it keeps in its modules) and
 * the TUI's a terminal, a document of another kind: a runtime is one host.
 */
export let platform = (file: string) =>
  workerd(file)
    ? 'workerd'
    : file.includes('packages/browse/tui/')
    ? 'terminal'
    : (file.includes('packages/web/') || file.includes('packages/browse/'))
    ? 'browser'
    : 'deno'

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
    // `deno task gate` runs the stricter whole-repo check first, and it types
    // every example in a doc comment beside the modules (`deno check --doc`).
    '--no-check',
    '-A',
    '--unstable-net',
    '--unstable-worker-options',
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
 * when a test last ended, how many have, and each that failed. */
export type Progress = {
  name: string
  completed: number
  count: number
  failed: string[]
}

export let observe = async (
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  progress: Progress,
) => {
  let decoder = new TextDecoder()
  let pending = ''
  let running = false
  let read = (line: string, done = false) => {
    line = line.replace(ansi, '')
    let loading = line.match(/^loading (.+)$/)
    if (loading) {
      progress.name = `loading ${loading[1]}`
      running = false
    }
    let test = line.match(/^(.+?) \.\.\./)
    if (test) {
      progress.name = test[1]
      running = true
    }
    // Console output can end the test's opening line. Its result then starts
    // a line of its own; a repeated result outside a running test is no news.
    let result = line.match(
      /^(?:.+? \.\.\. )?(ok|FAILED|ignored) \(\d+(?:µs|ms|s|m\d+s)\)$/,
    )
    if (done && running && result) {
      progress.completed = Date.now()
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

/// reported('a ... ok (1ms)\n\nok | 1 passed | 0 failed (2ms)\n') -> true
/// reported('a ... ok (1ms)\nb ... ') -> false
/** Whether a runtime said its closing report, the line its runner ends on. */
export let reported = (out: string) =>
  /^(?:ok|FAILED) \| \d+ passed \|/m.test(out.replace(ansi, ''))

/// died({ name: 'b', completed: 0, count: 9, failed: [] }) -> ' during b, after 9 tests'
/// died({ name: 'c', completed: 0, count: 1, failed: ['a'] }) -> ' during c, after 1 test; failed before it: a'
/// died({ name: 'd', completed: 0, count: 9, failed: ['a', 'b'] }) -> ' during d, after 9 tests; failed before it: a; b'
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
/**
 * What a run says of a platform that failed, unless `--verbose`: its
 * runner's report of the failures, without the counts that the run's own
 * closing line sums (bin/test-budget.ts); or, from a runner that ended
 * before it reported, `why` and the last `lines` it said. Nothing about a
 * test that passed, nor what a test printed: `--verbose` says those.
 */
export let failures = (out: string, err: string, why = '', lines = 40) => {
  let plain = out.replace(ansi, '')
  let at = plain.lastIndexOf('\nERRORS\n')
  if (at >= 0) {
    return plain.slice(at + 1)
      .replace(/\n+(?:ok|FAILED) \| \d+ passed \|[^\n]*\n*$/, '\n\n')
  }
  let all = (plain + err.replace(ansi, '')).trimEnd().split('\n')
  return `${why}\n${all.slice(-lines).join('\n')}\n`
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

// What every workerd test depends on beside its own graph: the Worker the
// kernel runs, and its config.
let KERNEL = ['workers/yak/index.ts', 'workers/yak/wrangler.toml']

// `--bulk [--tag=t]... [--all] path...`: a runtime of the runner for each
// platform the paths hold, run at once and watched together. A test file runs
// on its platform; a page's examples run on deno. The workerd platform starts
// once the run's kernel is up (probe-suite.ts), which this process holds
// beside the others and stops after its last test.
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
  let spawn = (
    p: string,
    files: readonly string[],
    more: string[] = [],
    env?: Record<string, string>,
  ) => {
    let child = new Deno.Command(Deno.execPath(), {
      args: [
        ...host.args,
        RUNNER,
        `--platform=${p}`,
        ...flags,
        ...more,
        ...files,
      ],
      env: { ...env, ...host.env },
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
  let progress = runs.map(([p]) => ({
    name: p == 'workerd' ? 'starting the kernel' : 'loading tests',
    completed: Date.now(),
    count: 0,
    failed: [] as string[],
    said: 0,
    reported: Date.now(),
    done: false,
  }))
  let parent = Deno.ppid
  let ending = false
  let end = (why: string) => {
    if (ending) return
    ending = true
    console.error(why)
    // runTestCommands starts this coordinator as a session leader. End its
    // whole process group, including test-spawned descendants. A direct
    // `--bulk` invocation only owns its immediate children.
    if (group() == Deno.pid) Deno.kill(-Deno.pid, 'SIGTERM')
    else {
      for (let child of children) child.kill('SIGTERM')
      Deno.exit(1)
    }
  }
  let watch = setInterval(() => {
    if (Deno.ppid != parent) {
      end('test bulk: parent exited; ending its platforms')
      return
    }
    for (let [i, p] of progress.entries()) {
      if (p.done) continue
      let name = runs[i][0]
      let idle = Date.now() - p.completed
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
      if (idle >= idleLimit) {
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
    let [stdout, preview] = child.stdout.tee()
    let [stderr, errors] = child.stderr.tee()
    let output = new Response(stdout).arrayBuffer()
    let error = new Response(stderr).arrayBuffer()
    let followed = Promise.all([
      observe(preview, progress[i]),
      observe(errors, progress[i]),
    ])
    let status = await child.status
    await followed
    progress[i].done = true
    let out = new Uint8Array(await output)
    let said = new TextDecoder().decode(out)
    // A runtime that died (out of memory, say) never listed its failures.
    let why = `test ${runs[i][0]}: ${status.signal ?? status.code}${
      status.success || reported(said) ? '' : died(progress[i])
    }`
    // Every platform runs to its own end and prints its own report: whole
    // when verbose, and otherwise only a red one's failures.
    if (verbose) {
      report(Deno.stdout, out)
      report(Deno.stderr, new Uint8Array(await error))
    } else if (!status.success) {
      let err = new TextDecoder().decode(await error)
      report(Deno.stdout, new TextEncoder().encode(failures(said, err, why)))
    }
    if (!status.success) failed.push(why)
  }
  // The workerd platform, once the kernel it shares is up; the kernel stops
  // after its last test.
  let kernel = async (i: number, files: readonly string[]) => {
    let suite
    try {
      suite = await (await import('../workers/yak/probe-suite.ts'))
        .probeSuite()
    } catch (e) {
      let why = 'test workerd: the kernel did not start'
      if (!verbose) console.error(why)
      console.error(e)
      progress[i].done = true
      failed.push(why)
      return
    }
    try {
      progress[i].name = 'loading tests'
      progress[i].completed = Date.now()
      let also = KERNEL.map((k) => `--also=${k}`)
      await run(i, spawn('workerd', files, also, suite.env))
    } finally {
      await suite.stop()
    }
  }
  try {
    await Promise.all(
      runs.map(([p, files], i) =>
        p == 'workerd' ? kernel(i, files) : run(i, spawn(p, files))
      ),
    )
  } finally {
    clearInterval(watch)
  }
  // The closing word on a long run: which platforms were red, after every one
  // of them has printed its own report. A short run said each as it ended.
  if (verbose && failed.length) {
    console.error(`\n─── ${failed.length} failing platform(s) ───`)
    for (let line of failed) console.error(`  ${line}`)
  }
  // The code is said outright: wrangler's close sets Node's exit code, which
  // is Deno's.
  Deno.exit(failed.length ? 1 : 0)
} else if (import.meta.main) {
  let outer = Deno.env.get(RUN)
  if (outer) {
    console.error(
      `bin/test.ts: refused — this is inside test run ${outer}, and a test ` +
        'never starts the suite (it would start itself again, and again)',
    )
    Deno.exit(2)
  }
  Deno.env.set(RUN, String(Deno.pid))
  let b = await budget()
  let from = Deno.args.find((a) => a.startsWith('--from='))?.slice(7)
  if (from) Deno.exit(await hold(b, await read(from), Deno.args))
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
  // The Worker's npm dependencies, current before any test loads: workerd
  // bundles from workers/yak/node_modules, and the kernel in memory imports
  // the OAuth provider out of it (workers/yak/oauth-provider.ts). `npm ci`
  // empties that tree before it fills it, so an install racing the deno pass
  // left every runtime that loaded its tests meanwhile without that module
  // for the rest of its life, and each kernel in it answered its first
  // sign-in with a 500.
  let worker = files.some((f) => f.startsWith('workers/'))
  let verbose = flags.includes('--verbose')
  if (worker) await (await import('../workers/yak/wrangler.ts')).ready(!verbose)
  // The Stripe sandbox every kernel sells in, found once for a run that has
  // the Worker's tests and handed to every process by its environment
  // (probe.ts `vars`). The same run cancels what an earlier one left renewing
  // there (probe.ts `swept`).
  if (worker) {
    let { plusPrice, sandboxKey, swept } = await import(
      '../workers/yak/probe.ts'
    )
    let stripe = await sandboxKey()
    if (stripe) {
      Deno.env.set('STRIPE_KEY', stripe)
      let [price] = await Promise.all([plusPrice(stripe), swept()])
      Deno.env.set('STRIPE_PRICE', price)
    }
  }
  let suite: Suite = async (more, over = files) => {
    if (!over.length) return { code: 0 }
    let bulk: TestCommand = {
      command: Deno.execPath(),
      args: [
        'run',
        '-A',
        // The kernel's harness loads workers/yak's own wrangler, and Deno
        // resolves it from there only in this mode (probe-suite.ts).
        '--node-modules-dir=manual',
        '--unstable-worker-options',
        import.meta.filename!,
        '--bulk',
        ...flags,
        ...more,
        ...over,
      ],
      env: { DENO_DIR: denoDir(), ...GIT },
    }
    return await runTestCommands([bulk])
  }
  let whole = !paths.length && !tags.length && flags.includes('--all')
  Deno.exit(await hold(b, await measure(b, suite, whole, verbose), Deno.args))
}
