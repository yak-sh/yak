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
// `deno task test [--tag=t]... [--all] [path...]` runs what lies under the
// paths given, or all of it. A platform's name is a tag every test on it
// carries, so `--tag=workerd` runs that platform alone. A file whose tests
// all passed, with nothing it depends on changed since, is left out unless
// `--all` is given (packages/testing/deps.ts).

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
/// platform('packages/web/tui/run_test.tsx') -> 'terminal'
/// platform('workers/yak/mail_workerd_test.ts') -> 'workerd'
/**
 * The platform a test file runs on. The web app's files set up a browser tab
 * (a document, and the app's own state, which it keeps in its modules) and
 * the TUI's a terminal, a document of another kind: a runtime is one host.
 */
export let platform = (file: string) =>
  workerd(file)
    ? 'workerd'
    : file.includes('packages/web/tui/')
    ? 'terminal'
    : file.includes('packages/web/')
    ? 'browser'
    : 'deno'

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
  let read = (line: string, done = false) => {
    line = line.replace(ansi, '')
    let test = line.match(/^(.+?) \.\.\./)
    if (test) progress.name = test[1]
    if (done && / \.\.\. (ok|FAILED|ignored)(?: |$)/.test(line)) {
      progress.completed = Date.now()
      progress.count++
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

// `--bulk [--tag=t]... [--all] [--also=path]... path...`: a runtime of the
// runner for each platform the paths hold, watched together. A test file
// runs on its platform; a page's examples run on deno.
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
  let children = runs.map(([p, files]) =>
    new Deno.Command(Deno.execPath(), {
      args: [...common, RUNNER, `--platform=${p}`, ...flags, ...files],
      stdin: 'inherit',
      // Keep each reporter intact: interleaved half-lines would also fool
      // test:budget's per-test duration parser. Drain concurrently below.
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
  )
  let failed: string[] = []
  let progress = children.map(() => ({
    name: 'loading tests',
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
  try {
    await Promise.all(children.map(async (child, i) => {
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
    }))
  } finally {
    clearInterval(watch)
  }
  for (let line of failed) console.error(line)
  if (failed.length) Deno.exit(1)
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
  let local = [
    ...tests.filter((f) => !workerd(f) && on(platform(f))),
    ...on('deno') ? pages : [],
  ]
  let wd = on('workerd') ? tests.filter(workerd) : []
  // The Worker's npm dependencies, current before any test loads: workerd
  // bundles from workers/yak/node_modules, and the kernel in memory imports
  // the OAuth provider out of it (workers/yak/oauth-provider.ts). `npm ci`
  // empties that tree before it fills it, so an install racing the deno pass
  // left every runtime that loaded its tests meanwhile without that module
  // for the rest of its life, and each kernel in it answered its first
  // sign-in with a 500.
  if ([...local, ...wd].some((f) => f.startsWith('workers/'))) {
    await (await import('../workers/yak/wrangler.ts')).ready()
  }
  // The Stripe sandbox every kernel sells in, found once for the run and
  // handed to every process by its environment (probe.ts `vars`).
  let { plusPrice, sandboxKey } = await import('../workers/yak/probe.ts')
  let stripe = await sandboxKey()
  if (stripe) {
    Deno.env.set('STRIPE_KEY', stripe)
    Deno.env.set('STRIPE_PRICE', await plusPrice(stripe))
  }
  let env: Record<string, string> = { DENO_DIR: denoDir() }
  // The kernel starts while the deno pass runs, and is ready by its end.
  let started = wd.length
    ? import('../workers/yak/probe-suite.ts').then((m) => m.probeSuite())
    : undefined
  started?.catch(() => {})
  let bulk = (label: string, args: string[], extra = {}): TestCommand => ({
    command: Deno.execPath(),
    args: [
      'run',
      '-A',
      '--unstable-worker-options',
      import.meta.filename!,
      '--bulk',
      ...flags,
      ...args,
    ],
    env: { ...env, ...extra },
    label,
  })
  let failed: string[] = []
  let options = {
    onFailure: (spec: TestCommand) =>
      failed.push(spec.label ?? spec.args.join(' ')),
  }
  let suite: Awaited<typeof started>
  let result: Result = { code: 0 }
  try {
    if (local.length) {
      result = await runTestCommands([bulk('deno', local)], options)
    }
    if (started && !result.signal) {
      try {
        suite = await started
      } catch (e) {
        console.error(e)
        failed.push('workerd: the kernel did not start')
        result = { code: 1 }
      }
      if (suite) {
        // What every workerd test depends on beside its own graph: the
        // Worker the kernel runs, and its config.
        let kernel = ['workers/yak/index.ts', 'workers/yak/wrangler.toml']
        let passed = await runTestCommands(
          [bulk(
            'workerd',
            [...kernel.map((k) => `--also=${k}`), ...wd],
            suite.env,
          )],
          options,
        )
        result = passed.signal || !result.code ? passed : result
      }
    }
  } finally {
    await (suite ?? await started?.catch(() => undefined))?.stop()
    // The closing word on a long run: which platforms were red, after every
    // one of them has printed its own report.
    if (failed.length) {
      console.error(`\n─── ${failed.length} failing platform(s) ───`)
      for (let phase of failed) console.error(`  ${phase}`)
    }
  }
  // The code is said last and outright: wrangler's close sets Node's exit
  // code, which is Deno's.
  Deno.exit(result.code ?? (result.signal === 'SIGINT' ? 130 : 143))
}
