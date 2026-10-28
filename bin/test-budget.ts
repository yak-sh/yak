// The suite held to its budget (M-39441): no test case takes more than 1 ms,
// but the offenders bench/test-budget.json lists, and that list only ever
// shrinks. `deno task test` (bin/test.ts) runs its tests through `measure`,
// which has each platform's runner say what every test took, and holds that
// to the list (`hold`):
//
//   deno task test [--all] [--write] [--report] [--from=dir] [path...]
//
// - a test the list does not name fails when it takes over the budget, on
//   every run;
// - a listed test fails when it takes longer than its record allows (the
//   record times `slack.times`, plus `slack.ms`) in a run of the whole suite
//   (`--all`, no path or tag) on the gate (CI), where the records are taken.
//   Many listed tests wait on more than a CPU: files, the processes they
//   start. The box keeps a run's temporary files on disk where the gate keeps
//   them in memory, and shares its CPUs among agents' runs, so there a
//   file-backed SQLite test takes ten to forty times its record and a
//   process-spawning one up to four: a whole run elsewhere says them and
//   holds none, and a narrowed one says none.
//
// A test is held to its own time: its wall clock less what its runtime
// waited for a CPU another process held (`own`, packages/testing run.ts
// `waited`). The shared runner's host, or a busy box, stretches every test's
// wall clock by that wait; a test that got slower takes longer on the CPU or
// waits longer on what it awaits, and that it still owns.
//
// What runs beside a test still adds to its own time: the gate's runner
// shares its CPU's cache and memory with the box, and a process busy on
// another core makes a test take longer on its own. It never takes time
// away, so each test is held to the fastest time it ran in: one time within
// the line proves a pass, and a test fails only when it is over every time.
// A time over the line is measured again before it counts: the files holding
// such tests run in runtimes of their own, one platform at a time, each file
// loaded more than once (packages/testing/main.ts `--loads`): cold, as the
// first test of a file pays for everything its file is the first to load,
// then warm, as the whole suite runs it. Each pass takes only the files still
// over (`LOADS`), so a run with nothing over the line pays for none, and a
// test near its line is measured most.
//
// A test gets slower when its code does, or the code it runs: its file's key
// (packages/testing/deps.ts). A file that ran with the key it had already
// passed under, before the run began, is spared: the same code passed the
// budget, so a time over the line now is the run's, not its tests'. Only a
// run given `--all` runs such a file, as the gate's whole run does on every
// commit; it holds each file the first time its code runs there, and each
// file it failed until that file passes.
//
// The runner remembers a file whose tests all passed, and a later run leaves
// it out (packages/testing/deps.ts). A file holding a test the budget failed
// did not pass, so `measure` takes that back: the same paths, run again, run
// it again, and fail until it is fast.
//
// A platform's wall clock is said, never held: it adds every wait among the
// run's processes and the host's other users, and grows with each test, so no
// run of it is a floor. Workerd's tests each cross into the run's kernel, and
// are not held one by one: their times, and their wall, are said.
//
// Nothing ever joins the list, and a test renamed is a test not listed; an
// example is listed by its code, not its line or block position (`listed`).
// `--write` takes from it each test that ran within `leave` or no longer
// exists, and lowers each record a run beat by more than the slack: a record
// follows a test that got faster, not one run's luck. A test leaves well
// under the budget, not at it: one that left at 0.9 ms would be over on the
// next loaded run, and could not come back on. Without `--write`, the run
// says what it would change. The times a whole run judged are kept in
// bench/test-times/, which the gate keeps as an artifact, and `--from=<dir>`
// judges a kept set instead of running: a gate's, downloaded, shrinks the
// list by what the gate measured. The exit code is the run's own when it
// failed, and 1 when anything went over; `--report` says what went over and
// holds the run to nothing but its own tests.

import { forget, passed } from '@yaks/testing/deps'
import type { Result } from './phases.ts'

/** The flags the budget takes; the others are the runner's. */
export let OWN = /^--(write|report|from=.*)$/

/** The committed list and its rules. */
export type Budget = {
  /** What a test may take, in milliseconds. */
  budget: number
  /** What a listed test runs within to leave the list, in milliseconds. */
  leave: number
  /** How far past its record a listed test may run. */
  slack: Slack
  /** The offenders: by file, each test's record in milliseconds. */
  tests: Record<string, Record<string, number>>
}

/** A record allows itself times `times`, plus `ms`. */
export type Slack = { times: number; ms: number }

/** What a platform's runner wrote (packages/testing `--times`): its wall
 * clock, each test's time and what of it the test waited for a CPU, each
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

/** How many times each pass measuring tests again loads a file: the first
 * takes every file holding a test over the line, cold and then warm; the next
 * those still over, cold and then warm twice. A test over every time has had
 * six. */
export let LOADS = [2, 3]
let KEPT = new URL('../bench/test-times/', import.meta.url).pathname

/** A test as a runner timed it; a runner before `waited` said none. */
export type Timed = {
  file: string
  name: string
  ms: number
  waited?: number
  ok: boolean
}

/// own({ file: 'a', name: 'x', ms: 9, waited: 6, ok: true }) -> 3
/// own({ file: 'a', name: 'x', ms: 9, ok: true }) -> 9
/** What a test took of its own: its time, less what it waited for a CPU. */
export let own = (t: Timed) => t.ms - (t.waited ?? 0)

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
  spared: Seen[]
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

/// unchanged({ deno: { wall: 1, tests: [], remembered: { 'a.ts': 'k1', 'b.ts': 'k2' } } }, { k1: 5 })
///   -> ['a.ts']
/** The files `runs` remembered under a key `before` already held: each ran
 * the code it had passed with. */
export let unchanged = (
  runs: Record<string, Times>,
  before: Record<string, number>,
): string[] =>
  Object.values(runs).flatMap((r) =>
    Object.entries(r.remembered ?? {}).filter(([, key]) => key in before)
      .map(([file]) => file)
  )

/** What a run's times say against the list: the tests over the line, those of
 * them spared for running in a file `same` names, the listed ones now within
 * `leave` or faster than their record by more than its slack, the listed ones
 * that did not run, and each platform's wall. */
export let judge = (
  b: Budget,
  runs: Record<string, Times>,
  same: string[] = [],
): Judged => {
  let seen = new Map<string, Seen>()
  let ran = new Set<string>()
  for (let [platform, run] of Object.entries(runs)) {
    if (platform == 'workerd') continue
    let keys = listed(run.tests)
    run.tests.forEach((t, i) => {
      let at = JSON.stringify([t.file, keys[i]])
      ran.add(at)
      // A failed test is the run's news already; what it took is not.
      if (!t.ok) return
      let was = seen.get(at)
      let ms = own(t)
      // Two tests of one name in one file are held as one: the slower.
      if (!was || ms > was.ms) {
        seen.set(at, { platform, file: t.file, name: t.name, key: keys[i], ms })
      }
    })
  }
  let record = (s: Seen) => b.tests[s.file]?.[s.key]
  let spare = new Set(same)
  let over: Seen[] = [], slower: Seen[] = [], spared: Seen[] = []
  let within: Seen[] = [], faster: Seen[] = []
  for (let s of seen.values()) {
    let r = record(s)
    let held = spare.has(s.file) ? spared : r == null ? over : slower
    if (r == null) {
      if (s.ms > b.budget) held.push(s)
    } else if (s.ms > limit(b.slack, r)) held.push(s)
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
  return { over, slower, spared, within, faster, gone, walls }
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

/** The runs as measured again: each test held to the fastest of its own time
 * and the own times it passed with in `again`, which may run it many times. */
export let fastest = (
  runs: Record<string, Times>,
  again: Record<string, Times>,
): Record<string, Times> => {
  let best = new Map<string, Timed>()
  for (let t of Object.values(again).flatMap((r) => r.tests)) {
    let at = JSON.stringify([t.file, t.name])
    let was = best.get(at)
    if (t.ok && (was == null || own(t) < own(was))) best.set(at, t)
  }
  return Object.fromEntries(
    Object.entries(runs).map(([platform, run]) => [platform, {
      ...run,
      tests: run.tests.map((t) => {
        let b = best.get(JSON.stringify([t.file, t.name]))
        return b == null || own(b) >= own(t)
          ? t
          : { ...t, ms: b.ms, waited: b.waited }
      }),
    }]),
  )
}

/** The tests a run fails: each over the budget, and each listed one slower
 * than its record allows where the records are held (`gated`). */
export let failing = (j: Judged, gated: boolean): Seen[] =>
  gated ? [...j.over, ...j.slower] : j.over

/// let b = { budget: 1, leave: 0.5, slack: { times: 2, ms: 0 }, tests: { 'a_test.ts': { y: 3 } } }
/// let run = (x: number, y: number) => ({ wall: 9e9, tests: [{ file: 'a_test.ts', name: 'x', ms: x, ok: true }, { file: 'a_test.ts', name: 'y', ms: y, ok: true }] })
/// failed(b, { code: 0, gate: true, whole: true, runs: { deno: run(2, 7) } }) -> ['a_test.ts: x', 'a_test.ts: y']
/// failed(b, { code: 0, gate: false, whole: true, runs: { deno: run(2, 7) } }) -> ['a_test.ts: x']
/// failed(b, { code: 0, gate: true, whole: true, runs: { deno: run(0.4, 5) } }) -> []
/** What a measured run fails the budget on, each test said in a line by its
 * file and name. The same tests over on two runs say the same lines
 * (bench/ci.ts holds a red run to that). */
export let failed = (b: Budget, m: Measured): string[] =>
  failing(judge(b, m.runs, m.same), m.whole && m.gate)
    .map((s) => `${s.file}: ${s.key}`)

/** The passes the runs remembered that the budget takes back: the keys of the
 * files holding a test it fails. */
export let retracted = (
  runs: Record<string, Times>,
  failed: Seen[],
): string[] => {
  let files = new Set(failed.map((s) => s.file))
  return Object.values(runs).flatMap((r) =>
    Object.entries(r.remembered ?? {}).filter(([file]) => files.has(file))
      .map(([, key]) => key)
  )
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
 * code, what kind of run it was, the files it ran unchanged since they passed
 * (`unchanged`), and what it took in milliseconds. */
export type Measured = {
  code: number
  runs: Record<string, Times>
  gate: boolean
  whole: boolean
  same?: string[]
  ms?: number
}

/** A set of times kept in `dir`: bench/test-times/, or a gate's, with the
 * code its run ended with. */
export let read = async (dir: string): Promise<Measured> => {
  let runs: Record<string, Times> = {}
  let meta = { gate: false, whole: false }
  for await (let e of Deno.readDir(dir)) {
    if (!e.name.endsWith('.json')) continue
    let held = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`))
    if (e.name == 'run.json') meta = held
    else runs[e.name.slice(0, -5)] = held
  }
  return { code: 0, runs, ...meta }
}

/** A run of the suite (bin/test.ts): each platform's runner given `flags`
 * beside the command's own, over `files`, or over every file it names. */
export type Suite = (flags: string[], files?: string[]) => Promise<Result>

// A run of `suite` with its times taken, and its exit code.
let timed = async (suite: Suite, flags: string[], files?: string[]) => {
  let dir = await Deno.makeTempDir({ prefix: 'test-budget-' })
  try {
    let result = await suite([...flags, `--times=${dir}`], files)
    let code = result.code ?? (result.signal == 'SIGINT' ? 130 : 143)
    return { ...await read(dir), code, stopped: !!result.signal }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Runs `suite` with its times taken. The files holding tests it would fail
 * run again, in a pass for each of `LOADS` while any is still over, each test
 * is held to the fastest of its times, and the files it still fails have
 * their passes taken back. A file that ran unchanged since it passed is
 * spared. A run a signal stopped says nothing. */
export let measure = async (
  b: Budget,
  suite: Suite,
  whole: boolean,
  verbose = false,
): Promise<Measured> => {
  let gate = Deno.env.get('CI') == 'true'
  let gated = gate && whole
  let start = performance.now()
  // Before the run: each runtime remembers what it passed as it ends.
  let before = passed()
  let { code, stopped, runs } = await timed(suite, [])
  if (stopped) return { code, runs: {}, gate, whole }
  let same = unchanged(runs, before)
  let slow = failing(judge(b, runs, same), gated)
  let stop: number | undefined
  for (let loads of LOADS) {
    if (!slow.length || stop != null) break
    if (verbose) {
      let files = new Set(slow.map((s) => s.file)).size
      console.log(`\n─── measuring ${files} file(s) again, ${loads} times ───`)
    }
    // One platform at a time: the first pass runs them all at once, so a test
    // measured again beside another platform's runtime meets the same load
    // that put it over. Each of them passed, so the runner remembered it:
    // `--all`.
    let again: Record<string, Times> = {}
    for (let platform of new Set(slow.map((s) => s.platform))) {
      let held = slow.filter((s) => s.platform == platform).map((s) => s.file)
      let one = await timed(suite, ['--all', `--loads=${loads}`], [
        ...new Set(held),
      ])
      Object.assign(again, one.runs)
      if (one.stopped) {
        stop = one.code
        break
      }
    }
    runs = fastest(runs, again)
    slow = failing(judge(b, runs, same), gated)
  }
  forget(retracted(runs, slow))
  if (stop != null) return { code: stop, runs: {}, gate, whole }
  if (whole) {
    await Deno.remove(KEPT, { recursive: true }).catch(() => {})
    await Deno.mkdir(KEPT, { recursive: true })
    for (let [platform, times] of Object.entries(runs)) {
      await Deno.writeTextFile(`${KEPT}${platform}.json`, JSON.stringify(times))
    }
    await Deno.writeTextFile(
      `${KEPT}run.json`,
      JSON.stringify({ gate, whole, code, same }),
    )
  }
  return { code, runs, gate, whole, same, ms: performance.now() - start }
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
 * unchanged since they passed, the tests the budget flags, and what the run
 * took.
 */
export let closing = (
  exit: number,
  runs: Record<string, Times>,
  flagged: number,
  ms?: number,
) => {
  let all = Object.values(runs)
  let tests = all.flatMap((r) => r.tests)
  let failed = tests.filter((t) => !t.ok).length
  let sum = (k: 'ignored' | 'left') => all.reduce((n, r) => n + (r[k] ?? 0), 0)
  return `${exit ? 'FAILED' : 'ok'} | ${
    [
      `${tests.length - failed} passed`,
      `${failed} failed`,
      ...sum('ignored') ? [`${sum('ignored')} ignored`] : [],
      ...sum('left') ? [`${sum('left')} unchanged since they passed`] : [],
      `${flagged} over budget`,
    ].join(' | ')
  }${ms == null ? '' : ` (${seconds(ms)})`}`
}

/** Says what a measured run comes to against the list, writes the list shrunk
 * on `--write`, and returns the command's exit code. Each finding is a line
 * naming the slowest few, then the run's closing line; `--verbose` says each
 * finding whole, each platform's wall clock on a whole run, and how the list
 * would shrink. */
export let hold = async (
  b: Budget,
  { code, runs, gate, whole, same, ms }: Measured,
  args: string[],
): Promise<number> => {
  let write = args.includes('--write')
  let report = args.includes('--report')
  let verbose = args.includes('--verbose')
  let j = judge(b, runs, same)
  // Only a whole run knows which tests are gone, and only one that passed: a
  // runtime that died wrote no times, and every test it held would read as
  // gone. The records are held on the gate's, where they are taken.
  if (!whole || code) j.gone = []
  let gated = whole && gate
  let slower = whole ? j.slower : []
  let shrinking = j.within.length + j.gone.length + j.faster.length
  let spared =
    'test(s) over the line in files unchanged since they passed, spared'
  let lines: string[] = []
  let section = (title: string, rows: string[]) => {
    if (rows.length) lines.push(`\n─── ${title} ───`, ...rows)
  }
  if (verbose) {
    section(
      `${j.over.length} test(s) over the ${b.budget}ms budget, not listed`,
      j.over.length
        ? [
          ...said(j.over, b),
          '  Each was over every time it ran, and the list takes no test on: make it faster.',
        ]
        : [],
    )
    section(
      `${j.slower.length} listed test(s) slower than their record allows`,
      !slower.length
        ? []
        : gated
        ? said(slower, b)
        : [...said(slower, b), '  Held on the gate, where records are taken.'],
    )
    section(
      `${j.spared.length} ${spared}`,
      j.spared.length
        ? [
          ...said(j.spared, b),
          "  Each file passed the budget before with the same code: the time is the run's.",
        ]
        : [],
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
    if (slower.length) {
      lines.push(
        `${slower.length} listed test(s) slower than their record allows${
          gated ? '' : ', held on the gate'
        }: ${worst(slower, b)}`,
      )
    }
    if (j.spared.length) {
      lines.push(`${j.spared.length} ${spared}: ${worst(j.spared, b)}`)
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
  let exit = code || (!report && failing(j, gated).length ? 1 : 0)
  // A run a signal stopped measured nothing to sum.
  if (!code || Object.keys(runs).length) {
    let line = closing(exit, runs, j.over.length + slower.length, ms)
    lines.push(verbose ? `\n${line}` : line)
  }
  if (lines.length) console.log(lines.join('\n'))
  return exit
}
