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
// `deno task test [--tag=t]... [--all] [--times=dir] [path...]` runs what
// lies under the paths given, or all of it, its platforms at once. A
// platform's name is a tag every test on it carries, so `--tag=workerd` runs
// that platform alone. A file whose tests all passed, with nothing it depends
// on changed since, is left out unless `--all` is given
// (packages/testing/deps.ts). `--times` has each platform's runner write what
// it took to `<dir>/<platform>.json`.

import { find, tested } from '@yaks/testing/find'
import { type Result, runTestCommands, type TestCommand } from './phases.ts'

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

let common = [
  'run',
  '--frozen',
  // `deno task gate` runs the stricter whole-repo check first, and it types
  // every example in a doc comment beside the modules (`deno check --doc`).
  '--no-check',
  '-A',
  '--unstable-net',
  '--unstable-worker-options',
]

// Deno prints a test's name before running it, then finishes the same line
// with its result. Keep that name while the reporter's bytes stay buffered
// for an intact report at exit.
// deno-lint-ignore no-control-regex -- ESC starts the reporter's color codes
let ansi = /\x1b\[[0-9;]*m/g

export let observe = async (
  stream: ReadableStream<Uint8Array>,
  progress: { name: string; completed: number; count: number },
) => {
  let decoder = new TextDecoder()
  let pending = ''
  let running = false
  let read = (line: string, done = false) => {
    line = line.replace(ansi, '')
    let test = line.match(/^(.+?) \.\.\./)
    if (test) {
      progress.name = test[1]
      running = true
    }
    // Console output can end the test's opening line. Its result then starts
    // a line of its own; a repeated result outside a running test is no news.
    let result =
      /^(?:.+? \.\.\. )?(ok|FAILED|ignored) \(\d+(?:µs|ms|s|m\d+s)\)$/
    if (done && running && result.test(line)) {
      progress.completed = Date.now()
      progress.count++
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
  let spawn = (
    p: string,
    files: readonly string[],
    more: string[] = [],
    env?: Record<string, string>,
  ) => {
    let child = new Deno.Command(Deno.execPath(), {
      args: [...common, RUNNER, `--platform=${p}`, ...flags, ...more, ...files],
      env,
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
        console.error(`test ${name}: ${p.count} tests completed; now ${p.name}`)
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
    report(Deno.stdout, new Uint8Array(await output))
    report(Deno.stderr, new Uint8Array(await error))
    // Every platform runs to its own end and prints its own report.
    if (!status.success) {
      failed.push(`test ${runs[i][0]}: ${status.signal ?? status.code}`)
    }
  }
  // The workerd platform, once the kernel it shares is up; the kernel stops
  // after its last test.
  let kernel = async (i: number, files: readonly string[]) => {
    let suite
    try {
      suite = await (await import('../workers/yak/probe-suite.ts'))
        .probeSuite()
    } catch (e) {
      console.error(e)
      progress[i].done = true
      failed.push('test workerd: the kernel did not start')
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
  // of them has printed its own report.
  if (failed.length) {
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
  let flags = Deno.args.filter((a) => a.startsWith('--'))
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
  if (worker) await (await import('../workers/yak/wrangler.ts')).ready()
  // The Stripe sandbox every kernel sells in, found once for a run that has
  // the Worker's tests and handed to every process by its environment
  // (probe.ts `vars`).
  if (worker) {
    let { plusPrice, sandboxKey } = await import('../workers/yak/probe.ts')
    let stripe = await sandboxKey()
    if (stripe) {
      Deno.env.set('STRIPE_KEY', stripe)
      Deno.env.set('STRIPE_PRICE', await plusPrice(stripe))
    }
  }
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
      ...files,
    ],
    env: { DENO_DIR: denoDir(), ...GIT },
  }
  let result: Result = files.length
    ? await runTestCommands([bulk])
    : { code: 0 }
  Deno.exit(result.code ?? (result.signal === 'SIGINT' ? 130 : 143))
}
