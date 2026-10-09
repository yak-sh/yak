#!/usr/bin/env -S deno run -A
// test-budget — the suite held to its budget (M-39441): no test case takes
// more than 1 ms, but the offenders bench/test-budget.json lists, and that
// list only ever shrinks.
//
//   deno task test:budget [--write] [--report] [--from=dir] [path...]
//
// It runs `deno task test --all --times=…` (bin/test.ts), streaming the run
// as usual, reads what every test took, and holds it to the list:
//
// - a test the list does not name fails when it takes over the budget;
// - a listed test fails when it takes longer than its record allows: the
//   record times `slack.tests.times`, plus `slack.tests.ms`;
// - a platform's wall clock fails past its record by `slack.walls`, on the
//   gate (CI), where its records are taken, and in a run of the whole suite.
//   Elsewhere a run says its walls and holds none of them.
//
// A time over the line is measured once more before it counts: the files
// holding such tests run again together in runtimes of their own, and a test
// fails only when it is over both times. A collection, or another process on
// the box, can stretch any one run of a test; a slow test is slow every time.
//
// Workerd's tests are held by their platform's wall alone: each crosses into
// the run's kernel, and there are few of them.
//
// Nothing ever joins the list, and a test renamed is a test not listed; an
// example is listed by its code or its place, not its line (`listed`).
// `--write` takes from it each test that ran within `leave` or no longer
// exists, and lowers each record a run beat by more than the slack, and each
// platform's on the gate: a record follows a test that got faster, not one
// run's luck. A test leaves well under the budget, not at it: one that left
// at 0.9 ms would be over on the next loaded run, and could not come back on.
// Without `--write`, the run says what it would change. The times it judged
// are kept in bench/test-times/, which the gate keeps as an artifact, and
// `--from=<dir>` judges a kept set instead of running: a gate's, downloaded,
// shrinks the list by what the gate measured. The exit code is the run's own
// when it failed, and 1 when anything went over; `--report` says what went
// over and holds the run to nothing but its own tests.

/** The committed list and its rules. */
export type Budget = {
  /** What a test may take, in milliseconds. */
  budget: number
  /** What a listed test runs within to leave the list, in milliseconds. */
  leave: number
  /** How far past its record a listed test, or a platform's wall, may run. */
  slack: { tests: Slack; walls: Slack }
  /** Each platform's wall clock on the gate, in milliseconds. */
  platforms: Record<string, number>
  /** The offenders: by file, each test's record in milliseconds. */
  tests: Record<string, Record<string, number>>
}

/** A record allows itself times `times`, plus `ms`. */
export type Slack = { times: number; ms: number }

/** What a platform's runner wrote (packages/testing `--times`). */
export type Times = {
  wall: number
  tests: { file: string; name: string; ms: number; ok: boolean }[]
}

export let LIST = new URL('../bench/test-budget.json', import.meta.url)
let KEPT = new URL('../bench/test-times/', import.meta.url).pathname

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

/** What the list names each test by: its name, but an example's without the
 * line the runner says it at (packages/testing examples.ts): a doctest by its
 * code, a fenced block by its place among its page's blocks. An edit above an
 * example takes it off no list. */
export let listed = (tests: { file: string; name: string }[]): string[] => {
  let blocks = new Map<string, number>()
  return tests.map(({ file, name }) => {
    let at = name.startsWith(`${file}:`) &&
      /^(\d+)(?: (.*))?$/.exec(name.slice(file.length + 1))
    if (!at) return name
    if (at[2] != null) return `${file}: ${at[2]}`
    let n = (blocks.get(file) ?? 0) + 1
    blocks.set(file, n)
    return `${file} block ${n}`
  })
}

/** What a run's times say against the list: the tests over the line, the
 * listed ones now within `leave` or faster than their record by more than its
 * slack, the listed ones that did not run, and each platform's wall against
 * its record. */
export let judge = (b: Budget, runs: Record<string, Times>) => {
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
      // Two tests of one name in one file are held as one: the slower.
      if (!was || t.ms > was.ms) seen.set(at, { platform, ...t, key: keys[i] })
    })
  }
  let record = (s: Seen) => b.tests[s.file]?.[s.key]
  let over: Seen[] = [], slower: Seen[] = [], within: Seen[] = []
  let faster: Seen[] = []
  for (let s of seen.values()) {
    let r = record(s)
    if (r == null) {
      if (s.ms > b.budget) over.push(s)
    } else if (s.ms > limit(b.slack.tests, r)) slower.push(s)
    else if (s.ms <= b.leave) within.push(s)
    else if (limit(b.slack.tests, s.ms) < r) faster.push(s)
  }
  let gone = Object.entries(b.tests).flatMap(([file, tests]) =>
    Object.keys(tests).filter((key) => !ran.has(JSON.stringify([file, key])))
      .map((key) => ({ file, key }))
  )
  let walls = Object.entries(runs).map(([platform, run]) => ({
    platform,
    ms: run.wall,
    record: b.platforms[platform] as number | undefined,
  }))
  return { over, slower, within, faster, gone, walls }
}

/** The list as `--write` leaves it: tests within `leave` or gone taken out,
 * each record lowered to a time that beat it by more than the slack, and each
 * platform's wall too when `walls` holds. Nothing is added. */
export let shrunk = (
  b: Budget,
  j: ReturnType<typeof judge>,
  walls: boolean,
): Budget => {
  let tests: Budget['tests'] = structuredClone(b.tests)
  for (let { file, key } of [...j.within, ...j.gone]) {
    delete tests[file][key]
    if (!Object.keys(tests[file]).length) delete tests[file]
  }
  for (let s of j.faster) tests[s.file][s.key] = ceil(s.ms)
  let platforms = { ...b.platforms }
  if (walls) {
    for (let w of j.walls) {
      if (w.record != null && limit(b.slack.walls, w.ms) < w.record) {
        platforms[w.platform] = ceil(w.ms)
      }
    }
  }
  return { ...b, platforms, tests }
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

// The times a run wrote, by platform, and what kind of run it was.
let read = async (dir: string) => {
  let runs: Record<string, Times> = {}
  let meta = { gate: false, whole: false }
  for await (let e of Deno.readDir(dir)) {
    if (!e.name.endsWith('.json')) continue
    let held = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`))
    if (e.name == 'run.json') meta = held
    else runs[e.name.slice(0, -5)] = held
  }
  return { runs, ...meta }
}

// `deno task test …`, its output passed through, its times read back.
let run = async (args: string[], task = 'test') => {
  let dir = await Deno.makeTempDir({ prefix: 'test-budget-' })
  try {
    let { code } = await new Deno.Command('deno', {
      args: ['task', task, '--all', `--times=${dir}`, ...args],
      stdout: 'inherit',
      stderr: 'inherit',
    }).output()
    return { code, runs: (await read(dir)).runs }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// What a second run of the files holding `slow` tests says: each test held to
// the faster of its two times.
let again = async (runs: Record<string, Times>, slow: Seen[]) => {
  let files = [...new Set(slow.map((s) => s.file))]
  console.log(`\n─── measuring ${files.length} file(s) again ───`)
  let second = await run(files, 'test:run')
  let best = new Map<string, number>()
  for (let r of Object.values(second.runs)) {
    for (let t of r.tests) {
      if (t.ok) best.set(JSON.stringify([t.file, t.name]), t.ms)
    }
  }
  for (let r of Object.values(runs)) {
    for (let t of r.tests) {
      let ms = best.get(JSON.stringify([t.file, t.name]))
      if (ms != null) t.ms = Math.min(t.ms, ms)
    }
  }
}

if (import.meta.main) {
  let write = Deno.args.includes('--write')
  let report = Deno.args.includes('--report')
  let from = Deno.args.find((a) => a.startsWith('--from='))?.slice(7)
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let b: Budget = JSON.parse(await Deno.readTextFile(LIST))
  let code = 0
  let { runs, gate, whole } = from ? await read(from) : {
    runs: {} as Record<string, Times>,
    gate: Deno.env.get('CI') == 'true',
    whole: !paths.length,
  }
  if (!from) {
    let first = await run(paths)
    code = first.code
    runs = first.runs
  }
  let j = judge(b, runs)
  if (!from && (j.over.length || j.slower.length)) {
    await again(runs, [...j.over, ...j.slower])
    j = judge(b, runs)
  }
  if (!from) {
    await Deno.remove(KEPT, { recursive: true }).catch(() => {})
    await Deno.mkdir(KEPT, { recursive: true })
    for (let [platform, times] of Object.entries(runs)) {
      await Deno.writeTextFile(`${KEPT}${platform}.json`, JSON.stringify(times))
    }
    await Deno.writeTextFile(`${KEPT}run.json`, JSON.stringify({ gate, whole }))
  }
  // Only a whole run knows which tests are gone, and only the gate's walls
  // are held.
  if (!whole) j.gone = []
  let walls = whole && gate
  let wide = j.walls.filter((w) =>
    walls && w.record != null && w.ms > limit(b.slack.walls, w.record)
  )
  let lines: string[] = []
  let section = (title: string, rows: string[]) => {
    if (rows.length) lines.push(`\n─── ${title} ───`, ...rows)
  }
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
    j.walls.map((w) =>
      `  ${w.platform}: ${(w.ms / 1000).toFixed(1)}s${
        w.record == null
          ? ''
          : ` (record ${(w.record / 1000).toFixed(1)}s, allowed ${
            (limit(b.slack.walls, w.record) / 1000).toFixed(1)
          }s${walls ? '' : '; held on the gate'})`
      }`
    ),
  )
  let shrinking = j.within.length + j.gone.length + j.faster.length
  if (shrinking) {
    lines.push(
      `\n─── the list shrinks: ${j.within.length} within ${b.leave}ms, ${j.gone.length} gone, ${j.faster.length} faster than their record allows ───`,
      write
        ? `  written to ${LIST.pathname}`
        : '  `deno task test:budget --write` takes them off and lowers the records',
    )
  }
  if (write) {
    let next = shrunk(b, j, walls)
    await Deno.writeTextFile(LIST, JSON.stringify(next, null, 2) + '\n')
  }
  console.log(lines.join('\n'))
  if (code) Deno.exit(code)
  if (report) Deno.exit(0)
  if (j.over.length || j.slower.length || wide.length) Deno.exit(1)
}
