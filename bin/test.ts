// Every test in the repository, divided by the platform it runs on, and each
// platform's environment started once per run (M-39441):
//
// - deno: every `*_test.ts`, and every example in a doc comment or a README
//   (`deno test --doc`), sharded across processes, and each shard's test
//   files loaded into one runtime (bin/shard.ts);
// - workerd: every `*_workerd_test.ts`, against the one kernel
//   workers/yak/probe-suite.ts starts for the run.
//
// `deno task test [--only=deno|workerd] [path...]` runs what lies under the
// paths given, or all of it, on every platform or the one named.

import { type Result, runTestCommands, type TestCommand } from './phases.ts'
import { denoDir } from './testing.ts'

export let ROOTS = ['packages', 'bin', 'workers']

/** Set in a run's environment, naming the run: every process it starts
 * inherits it, so a run started from inside one refuses. */
export let RUN = 'TASKS_TEST_RUN'

/** A test that runs against the run's kernel, in workerd. */
export let workerd = (file: string) => /_workerd_test\.tsx?$/.test(file)

// Ours only. `node_modules` is walked into otherwise, and a dependency that
// ships its own `*_test.ts` (`@jsr/std__streams` does) is then run as if it
// were this repo's, against an import map that is not its own.
let SKIP = ['vendor', 'node_modules', '.wrangler']

/** Where examples are run from: the packages, never a script. */
export let DOCS = 'packages'

let module = (name: string) => /\.tsx?$/.test(name)
let test = (name: string) => /_test\.tsx?$/.test(name)

/** The pieces of `roots` whose examples a shard runs: a directory, or a
 * README.
 *
 * Never a module by name: `deno test --doc a.ts` runs a.ts itself, where a
 * directory only has its examples read. A directory whose own files are all
 * tests (`packages`) is taken one subdirectory at a time. */
export async function pages(roots = [DOCS]) {
  let out: string[] = []
  for (let root of roots) {
    let path = root.replace(/^\.\//, '').replace(/\/+$/, '')
    if (path != DOCS && !path.startsWith(`${DOCS}/`)) continue
    if (!(await Deno.stat(path)).isDirectory) {
      if (path.endsWith('.md')) out.push(path)
      continue
    }
    let entries = await Array.fromAsync(Deno.readDir(path))
    let own = entries.some((e) => e.isFile && module(e.name) && !test(e.name))
    if (own) {
      out.push(path)
      continue
    }
    for (let e of entries) {
      let at = `${path}/${e.name}`
      if (e.isDirectory && !SKIP.includes(e.name)) out.push(at)
      else if (e.isFile && e.name.endsWith('.md')) out.push(at)
    }
  }
  return [...new Set(out)].sort()
}

export async function inventory(roots = ROOTS) {
  let tests: string[] = []
  let collect = async (dir: string): Promise<void> => {
    for await (let entry of Deno.readDir(dir)) {
      let path = `${dir}/${entry.name}`
      if (entry.isFile && /_test\.tsx?$/.test(entry.name)) {
        tests.push(path)
      } else if (entry.isDirectory && !SKIP.includes(entry.name)) {
        await collect(path)
      }
    }
  }
  for (let root of roots) {
    let path = root.replace(/\/+$/, '')
    if ((await Deno.stat(path)).isDirectory) await collect(path)
    else tests.push(path)
  }
  return tests.sort()
}

let common = [
  'test',
  '--frozen',
  // `deno task gate` runs the stricter whole-repo check first. Re-checking
  // every module graph once per pass dominates the few-second test budget and
  // adds no coverage here; direct test runs still exercise module loading.
  '--no-check',
  '-A',
  '--unstable-net',
  '--unstable-worker-options',
  // No --fail-fast. A suite reports every failure it has: stopping at the
  // first one turns a red run into a single symptom, and the shard that never
  // ran is indistinguishable from a green one.
]

/** The module a group of test files loads through, into one runtime. */
let SHARD = `${import.meta.dirname}/shard.ts`

// What a test file makes of its runtime's globals. The web app's files set up
// a browser tab — a document, and the app's own state, which it keeps in its
// modules — and the TUI's set up a terminal, a document of another kind. A
// runtime is one host, so each of those is a group of its own, and every other
// file is plain deno.
let host = (file: string) =>
  file.includes('packages/web/tui/')
    ? 'terminal'
    : file.includes('packages/web/')
    ? 'browser'
    : 'deno'

/** The test files as `deno test` runs them, a runtime to a group: the plain
 * deno files in `jobs` shards, and each other host's files together. */
export let groups = (
  files: string[],
  jobs: number,
  weight?: (file: string) => number,
) => [
  ...shards(files.filter((f) => host(f) == 'deno'), jobs, weight),
  ...['browser', 'terminal'].map((h) => files.filter((f) => host(f) == h))
    .filter((group) => group.length),
]

// How long each test file took when it last ran, kept between runs so the next
// one can deal its shards by it: a run is as long as its slowest shard. Read
// off the JUnit report each group writes beside its usual one; a run rewrites
// only the files it ran.
let TIMES = `${
  Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
}/yak/test-times.json`

/** Seconds per test file in a JUnit report, by its path from the checkout. */
export let timesIn = (xml: string) => {
  let out: Record<string, number> = {}
  let cases = /<testcase [^>]*?classname="\.\/([^"]+)" time="([\d.]+)"/g
  for (let [, file, seconds] of xml.matchAll(cases)) {
    out[file] = (out[file] ?? 0) + Number(seconds)
  }
  return out
}

let timed = (): Record<string, number> => {
  try {
    return JSON.parse(Deno.readTextFileSync(TIMES))
  } catch {
    return {}
  }
}

let keep = (times: Record<string, number>) => {
  let dir = TIMES.slice(0, TIMES.lastIndexOf('/'))
  Deno.mkdirSync(dir, { recursive: true })
  let draft = `${TIMES}.${Deno.pid}`
  Deno.writeTextFileSync(draft, JSON.stringify({ ...timed(), ...times }))
  Deno.renameSync(draft, TIMES)
}

/** The examples in `pages`, run as tests; the test files are the shards'. */
let examples = (pages: string[]) => [
  ...common,
  '--doc',
  `--ignore=${[
    '**/*_test.ts',
    '**/*_test.tsx',
    ...SKIP.map((d) => `**/${d}`),
  ]}`,
  ...pages,
]

/** Stable, bounded partition: every module runs exactly once. The heaviest
 * file goes first, each to the lightest shard, so the shards end together;
 * files of one weight are dealt round in order. */
export function shards(
  files: string[],
  jobs: number,
  weight: (file: string) => number = () => 1,
): string[][] {
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('invalid test jobs')
  let groups = Array.from(
    { length: Math.min(jobs, files.length) },
    () => ({ files: [] as string[], load: 0 }),
  )
  for (let file of [...files].sort((a, b) => weight(b) - weight(a))) {
    let lightest = groups.reduce((a, b) => b.load < a.load ? b : a)
    lightest.files.push(file)
    lightest.load += weight(file)
  }
  return groups.map((g) => g.files)
}

// Writes to a pipe may be short. Finish one report synchronously so another
// shard cannot splice bytes into its test names/durations.
function report(
  stream: { writeSync(bytes: Uint8Array): number },
  bytes: Uint8Array,
) {
  while (bytes.length) bytes = bytes.subarray(stream.writeSync(bytes))
}

// `--bulk [--doc=<page>]... <file>...`
if (import.meta.main && Deno.args[0] === '--bulk') {
  // Deno --parallel shares a native SQLite allocator across its worker threads.
  // Separate processes avoid its mutex contention. This coordinator and all
  // its children stay in the outer runner's process group: a signal still
  // settles the complete tree, not just a shard's leader.
  let args = Deno.args.slice(1)
  let docs = args.filter((a) => a.startsWith('--doc=')).map((a) => a.slice(6))
  let files = args.filter((a) => !a.startsWith('--doc='))
  let jobs = Number(Deno.env.get('DENO_JOBS') ?? navigator.hardwareConcurrency)
  // A file never timed weighs what the middle one does.
  let known = timed()
  let middle = Object.values(known).sort((a, b) => a - b)
  let usual = middle[middle.length >> 1] ?? 1
  let weight = (file: string) => known[file.replace(/^\.\//, '')] ?? usual
  let reports = await Deno.makeTempDir({ prefix: 'tasks-junit-' })
  let runs = [
    ...groups(files, jobs, weight).map((g, i) => [
      ...common,
      `--junit-path=${reports}/${i}.xml`,
      SHARD,
      '--',
      ...g,
    ]),
    ...shards(docs, jobs).map(examples),
  ]
  let children = runs.map((args) =>
    new Deno.Command(Deno.execPath(), {
      args,
      stdin: 'inherit',
      // Keep each reporter intact: interleaved half-lines would also fool
      // test:budget's per-test duration parser. Drain concurrently below.
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
  )
  let failed: string[] = []
  await Promise.all(children.map(async (child) => {
    let status = await child.output()
    report(Deno.stdout, status.stdout)
    report(Deno.stderr, status.stderr)
    // Every shard runs to its own end and prints its own report. Exiting here
    // on the first failure killed the shards still running, so their failures
    // were never printed at all.
    if (!status.success) {
      failed.push(`test shard ${child.pid}: ${status.signal ?? status.code}`)
    }
  }))
  let times: Record<string, number> = {}
  for await (let e of Deno.readDir(reports)) {
    Object.assign(
      times,
      timesIn(await Deno.readTextFile(`${reports}/${e.name}`)),
    )
  }
  await Deno.remove(reports, { recursive: true })
  keep(times)
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
  let only = Deno.args.find((a) => a.startsWith('--only='))?.slice(7)
  let paths = Deno.args.filter((a) => !a.startsWith('--only='))
  let roots = paths.length ? paths : ROOTS
  let files = (await inventory(roots))
    .filter((f) => !only || workerd(f) == (only == 'workerd'))
  let docs = only == 'workerd' ? [] : await pages(roots)
  // The Stripe sandbox every kernel sells in, found once for the run and
  // handed to every process by its environment (probe.ts `vars`).
  let { plusPrice, sandboxKey } = await import('../workers/yak/probe.ts')
  let stripe = await sandboxKey()
  if (stripe) {
    Deno.env.set('STRIPE_KEY', stripe)
    Deno.env.set('STRIPE_PRICE', await plusPrice(stripe))
  }
  let env: Record<string, string> = {
    TEST_DENO_DIR: denoDir(),
    DENO_DIR: denoDir(),
  }
  let wd = files.filter(workerd)
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
  let result: Result = { code: 1 }
  try {
    result = await runTestCommands([
      bulk('deno', [
        ...docs.map((d) => `--doc=${d}`),
        ...files.filter((f) => !workerd(f)),
      ]),
    ], options)
    if (started && !result.signal) {
      try {
        suite = await started
      } catch (e) {
        console.error(e)
        failed.push('workerd: the kernel did not start')
        result = { code: 1 }
      }
      if (suite) {
        let passed = await runTestCommands(
          [bulk('workerd', wd, suite.env)],
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
