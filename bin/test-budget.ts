// The suite's times, said beside its budget (M-39441): no test case should
// take more than 1 ms, but the offenders bench/test-budget.json lists, and
// that list only ever shrinks. `deno task test` (bin/test.ts) runs its tests
// through `measure`, which has each platform's runner say what every test
// took, and `say` tells how that stands against the list:
//
//   deno task test [--all] [--write] [--from=dir] [path...]
//
// - a test the list does not name is said when it takes over the budget;
// - a listed test is said when it takes longer than its record allows (the
//   record times `slack.times`, plus `slack.ms`).
//
// What a test took is telemetry, never a verdict: a run's exit code is its
// tests' own, and each test is timed once, as it ran. A busy box stretches
// every test, and V8 runs a function in its interpreter until it has run
// enough times to be compiled, so a test over the line in a run of its file
// alone can be well within it in the whole suite. A test that got slower is
// over in every run, and every run says so.
//
// A test is timed in CPU milliseconds: every thread's user and system time,
// including completed children, from the same clock benchmarks use. Waiting
// for a timer, I/O or a CPU contributes no CPU time. Wall time is diagnostic
// only; the runner's separate timeout still detects a hung test.
//
// A platform's wall clock is said, never compared: it adds every wait among
// the run's processes and the host's other users.
//
// Nothing ever joins the list, and a test renamed is a test not listed; an
// example is listed by its code, not its line or block position (`listed`).
// `--write` takes from it each test that ran within `leave` or no longer
// exists, and lowers each record a run beat by more than the slack: a record
// follows a test that got faster, not one run's luck. A test leaves well
// under the budget, not at it: one that left at 0.9 ms would be over on the
// next loaded run. Without `--write`, the run says what it would change. The
// times a whole run took are kept in bench/test-times/, which CI keeps
// as an artifact, and `--from=<dir>` says a kept set instead of running: a
// CI's, downloaded, shrinks the list by what CI measured.

import type { Result } from './phases.ts'

/** The flags the budget takes; the others are the runner's. */
export let OWN = /^--(write|from=.*)$/

/** The committed list and its rules. */
export type Budget = {
  /** Unit for thresholds and records. */
  unit?: 'cpu-ms'
  /** Old wall-minus-scheduler records retained as upper bounds; `--write`
   * lowers them using CPU samples. They are not CPU baseline measurements. */
  records?: 'legacy-wall-ceilings'
  /** What a test may take, in CPU milliseconds. */
  budget: number
  /** What a listed test runs within to leave the list, in CPU milliseconds. */
  leave: number
  /** How far past its record a listed test may run. */
  slack: Slack
  /** The offenders: by file, each test's record in CPU milliseconds. */
  tests: Record<string, Record<string, number>>
}

/** A record allows itself times `times`, plus `ms`. */
export type Slack = { times: number; ms: number }

/** What a platform's runner wrote (packages/testing `--times`): its wall
 * clock, each test's CPU time, each
 * file it remembered as passed, by key, and how many tests it skipped and
 * files it left out as unchanged. */
export type Times = {
  wall: number
  tests: Timed[]
  remembered?: Record<string, string>
  ignored?: number
  left?: number
}

export let LIST = new URL('../bench/test-budget.json', import.meta.url)

let KEPT = new URL('../bench/test-times/', import.meta.url).pathname

/** A test as a runner timed it, in wall and CPU milliseconds. */
export type Timed = {
  file: string
  name: string
  ms: number
  cpu: number
  ok: boolean
}

/// own({ file: 'a', name: 'x', ms: 9, cpu: 3, ok: true }) -> 3
/** CPU milliseconds. Reject old wall-only artifacts rather than judge them
 * against a CPU budget. */
export let own = (t: Timed) => {
  if (!Number.isFinite(t.cpu) || t.cpu < 0) {
    throw new Error(`Missing or invalid CPU time: ${t.file} › ${t.name}`)
  }
  return t.cpu
}

/** The committed list. */
export let budget = async (): Promise<Budget> =>
  JSON.parse(await Deno.readTextFile(LIST))

/// limit({ times: 2, ms: 10 }, 5) -> 20
/** What a record allows. */
export let limit = (slack: Slack, record: number) =>
  record * slack.times + slack.ms

type Seen = {
  platform: string
  file: string
  name: string
  key: string
  ms: number
}

/** What a run's times say against the list (`judge`). */
export type Judged = {
  over: Seen[]
  slower: Seen[]
  within: Seen[]
  faster: Seen[]
  gone: { file: string; key: string }[]
  walls: { platform: string; ms: number }[]
}

/** What the list names each test by: its name, but an example's without the
 * line the runner says it at (packages/testing examples.ts): a doctest by its
 * code, a fenced block by its code's SHA-256 digest. Adding or removing blocks
 * above an example leaves its listing intact; changing its code does not. */
export let listed = (tests: { file: string; name: string }[]): string[] =>
  tests.map(({ file, name }) => {
    let at = name.startsWith(`${file}:`) &&
      /^(\d+)(?: (.*))?$/.exec(name.slice(file.length + 1))
    return at && at[2] != null ? `${file}: ${at[2]}` : name
  })

/** What a run's times say against the list: the tests over the line, the
 * listed ones now within `leave` or faster than their record by more than its
 * slack, the listed ones that did not run, and each platform's wall. */
export let judge = (b: Budget, runs: Record<string, Times>): Judged => {
  let seen = new Map<string, Seen>()
  let ran = new Set<string>()
  for (let [platform, run] of Object.entries(runs)) {
    let keys = listed(run.tests)
    run.tests.forEach((t, i) => {
      let at = JSON.stringify([t.file, keys[i]])
      ran.add(at)
      // A failed test is the run's news already; what it took is not.
      if (!t.ok) return
      let was = seen.get(at)
      let ms = own(t)
      // Two tests of one name in one file are timed as one: the slower.
      if (!was || ms > was.ms) {
        seen.set(at, { platform, file: t.file, name: t.name, key: keys[i], ms })
      }
    })
  }
  let record = (s: Seen) => b.tests[s.file]?.[s.key]
  let over: Seen[] = [], slower: Seen[] = []
  let within: Seen[] = [], faster: Seen[] = []
  for (let s of seen.values()) {
    let r = record(s)
    if (r == null) {
      if (s.ms > b.budget) over.push(s)
    } else if (s.ms > limit(b.slack, r)) slower.push(s)
    else if (s.ms <= b.leave) within.push(s)
    else if (limit(b.slack, s.ms) < r) faster.push(s)
  }
  let gone = Object.entries(b.tests).flatMap(([file, tests]) =>
    Object.keys(tests).filter((key) => !ran.has(JSON.stringify([file, key])))
      .map((key) => ({ file, key }))
  )
  let walls = Object.entries(runs).map(([platform, run]) => ({
    platform,
    ms: run.wall,
  }))
  return { over, slower, within, faster, gone, walls }
}

/** The list as `--write` leaves it: tests within `leave` or gone taken out,
 * and each record lowered to a time that beat it by more than the slack.
 * Nothing is added. */
export let shrunk = (b: Budget, j: Judged): Budget => {
  let tests: Budget['tests'] = structuredClone(b.tests)
  for (let { file, key } of [...j.within, ...j.gone]) {
    delete tests[file][key]
    if (!Object.keys(tests[file]).length) delete tests[file]
  }
  for (let s of j.faster) tests[s.file][s.key] = ceil(s.ms)
  return { ...b, tests }
}

// A record, to a tenth of a millisecond and never below what was measured.
let ceil = (ms: number) => Math.ceil(ms * 10) / 10

let said = (rows: Seen[], b: Budget) =>
  rows.toSorted((x, y) => y.ms - x.ms).map((s) => {
    let r = b.tests[s.file]?.[s.key]
    return `  ${s.ms.toFixed(1).padStart(9)}ms${
      r == null ? '' : ` (record ${r}ms)`
    }  ${s.name}  (${s.file})`
  })

/** What a run of the suite measured: each platform's times, the run's exit
 * code, what kind of run it was, what it took in milliseconds, and how many
 * files it left out as unchanged since they passed, where it chose them
 * before any platform ran. */
export type Measured = {
  code: number
  runs: Record<string, Times>
  whole: boolean
  ms?: number
  left?: number
}

/** A set of times kept in `dir`: bench/test-times/, or CI's, with the
 * code its run ended with. */
export let read = async (dir: string): Promise<Measured> => {
  let runs: Record<string, Times> = {}
  let meta = { whole: false }
  for await (let e of Deno.readDir(dir)) {
    if (!e.name.endsWith('.json')) continue
    let held = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`))
    if (e.name == 'run.json') meta = held
    else runs[e.name.slice(0, -5)] = held
  }
  return { code: 0, runs, ...meta }
}

/** A run of the suite (bin/test.ts): each platform's runner given `flags`
 * beside the command's own. */
export type Suite = (flags: string[]) => Promise<Result>

/** Runs `suite` with its times taken, once, and keeps a whole run's in
 * bench/test-times/. A run a signal stopped says nothing. */
export let measure = async (
  suite: Suite,
  whole: boolean,
): Promise<Measured> => {
  let start = performance.now()
  let dir = await Deno.makeTempDir({ prefix: 'test-budget-' })
  try {
    let result = await suite([`--times=${dir}`])
    let code = result.code ?? (result.signal == 'SIGINT' ? 130 : 143)
    if (result.signal) return { code, runs: {}, whole }
    let { runs } = await read(dir)
    if (whole) {
      await Deno.remove(KEPT, { recursive: true }).catch(() => {})
      await Deno.mkdir(KEPT, { recursive: true })
      for (let [platform, times] of Object.entries(runs)) {
        await Deno.writeTextFile(
          `${KEPT}${platform}.json`,
          JSON.stringify(times),
        )
      }
      await Deno.writeTextFile(
        `${KEPT}run.json`,
        JSON.stringify({ whole, code }),
      )
    }
    return { code, runs, whole, ms: performance.now() - start }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// A test on one line: what it took, its record, its name and file.
let one = (s: Seen, b: Budget) => {
  let r = b.tests[s.file]?.[s.key]
  return `${s.ms.toFixed(1)}ms${
    r == null ? '' : ` (record ${r}ms)`
  } ${s.name} (${s.file})`
}

// The slowest few of `rows` on one line, and how many more there are.
let worst = (rows: Seen[], b: Budget, few = 3) => {
  let sorted = rows.toSorted((x, y) => y.ms - x.ms)
  let more = sorted.length - few
  return [
    ...sorted.slice(0, few).map((s) => one(s, b)),
    ...more > 0 ? [`${more} more`] : [],
  ].join('; ')
}

let seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/// closing(0, { deno: { wall: 9, tests: [{ file: 'a', name: 'x', ms: 1, ok: true }], ignored: 2, left: 3 } }, 0, 2300)
///   -> 'ok | 1 passed | 0 failed | 2 ignored | 3 unchanged since they passed | 0 over budget (2.3s)'
/// closing(1, { deno: { wall: 9, tests: [{ file: 'a', name: 'x', ms: 1, ok: false }] } }, 2)
///   -> 'FAILED | 0 passed | 1 failed | 2 over budget'
/**
 * The run in one line: its verdict by its exit code, the tests that passed
 * and failed on every platform, those skipped and the files left out as
 * unchanged since they passed (`left`, or as each platform says), the tests
 * the budget flags, and what the run took.
 */
export let closing = (
  exit: number,
  runs: Record<string, Times>,
  flagged: number,
  ms?: number,
  left?: number,
) => {
  let all = Object.values(runs)
  let tests = all.flatMap((r) => r.tests)
  let failed = tests.filter((t) => !t.ok).length
  let sum = (k: 'ignored' | 'left') => all.reduce((n, r) => n + (r[k] ?? 0), 0)
  let unchanged = left ?? sum('left')
  return `${exit ? 'FAILED' : 'ok'} | ${
    [
      `${tests.length - failed} passed`,
      `${failed} failed`,
      ...sum('ignored') ? [`${sum('ignored')} ignored`] : [],
      ...unchanged ? [`${unchanged} unchanged since they passed`] : [],
      `${flagged} over budget`,
    ].join(' | ')
  }${ms == null ? '' : ` (${seconds(ms)})`}`
}

/** Says what a measured run comes to against the list, writes the list shrunk
 * on `--write`, and returns the run's own exit code. Each finding is a line
 * naming the slowest few, then the run's closing line; `--verbose` says each
 * finding whole, each platform's wall clock on a whole run, and how the list
 * would shrink. */
export let say = async (
  b: Budget,
  { code, runs, whole, ms, left }: Measured,
  args: string[],
): Promise<number> => {
  let write = args.includes('--write')
  let verbose = args.includes('--verbose')
  let j = judge(b, runs)
  // Only a whole run knows which tests are gone, and only one that passed: a
  // runtime that died wrote no times, and every test it held would read as
  // gone.
  if (!whole || code) j.gone = []
  let shrinking = j.within.length + j.gone.length + j.faster.length
  let lines: string[] = []
  let section = (title: string, rows: string[]) => {
    if (rows.length) lines.push(`\n─── ${title} ───`, ...rows)
  }
  if (verbose) {
    section(
      `${j.over.length} test(s) over the ${b.budget}ms budget, not listed`,
      said(j.over, b),
    )
    section(
      `${j.slower.length} listed test(s) slower than their record allows`,
      said(j.slower, b),
    )
    section(
      'platform wall clocks',
      whole ? j.walls.map((w) => `  ${w.platform}: ${seconds(w.ms)}`) : [],
    )
    if (shrinking) {
      lines.push(
        `\n─── the list shrinks: ${j.within.length} within ${b.leave}ms, ${j.gone.length} gone, ${j.faster.length} faster than their record allows ───`,
        write
          ? `  written to ${LIST.pathname}`
          : '  the same run with `--write` takes them off and lowers the records',
      )
    }
  } else {
    if (j.over.length) {
      lines.push(
        `${j.over.length} test(s) over the ${b.budget}ms budget, not listed: ${
          worst(j.over, b)
        }`,
      )
    }
    if (j.slower.length) {
      lines.push(
        `${j.slower.length} listed test(s) slower than their record allows: ${
          worst(j.slower, b)
        }`,
      )
    }
    if (write && shrinking) {
      lines.push(
        `the list shrinks by ${shrinking}: written to ${LIST.pathname}`,
      )
    }
  }
  if (write) {
    let next = shrunk(b, j)
    await Deno.writeTextFile(LIST, JSON.stringify(next, null, 2) + '\n')
  }
  // A run a signal stopped measured nothing to sum.
  if (!code || Object.keys(runs).length) {
    let line = closing(code, runs, j.over.length + j.slower.length, ms, left)
    lines.push(verbose ? `\n${line}` : line)
  }
  if (lines.length) console.log(lines.join('\n'))
  return code
}
