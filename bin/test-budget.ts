#!/usr/bin/env -S deno run -A
// test-budget — the fast tier's 1ms guard.
//
// The rule: no NORMAL test may run slower than 1ms (`deno task test`, TASKS_SLOW
// unset). deno's reporter prints each test's duration — sub-ms as `(NNNµs)`,
// then `(Nms)` once it rounds to a whole millisecond. So an offender is any test
// line reporting `(Nms)` with N >= 2: a µs line is always < 1ms, and `(1ms)` is
// the boundary the rule allows. (deno rounds to the nearest ms, so a `(1ms)`
// line can hide up to ~1.4ms — the slack that lets one freshDb + one apply pass.)
//
// ADVISORY BY DESIGN, not just for now (T-17785, reading A): the remaining
// offenders are db-backed tests whose 2–9ms is production freshDb + apply()
// cost, not trimmable setup — sub-1ms for those needs a server perf pass, not a
// test rewrite. So the guard's job is to flag ACCIDENTAL cost (real I/O, a
// missing slow()), not to gate that band. It runs the normal suite, prints the
// offenders slowest-first, and exits 0 on the budget alone. Set
// TASKS_FAST_STRICT=1 to make the budget FATAL (exit 1 on any offender) — the
// opt-in a targeted trim or a perf-pass branch runs to hold a line locally. A
// real test FAILURE always propagates, strict or not: this guards timing, it
// never hides a red suite.
//
// It reuses `deno task test` verbatim (no flag duplication that could drift from
// deno.json), teeing the child's stdout so the run still streams live while the
// `(Nms)` lines are parsed out of it.

// deno-lint-ignore no-control-regex -- ESC is the ANSI escape we strip
let ansi = /\x1b\[[0-9;]*m/g
let done = /^(.+?) \.\.\. ok \((\d+)ms\)$/ // a passing test's duration line

let child = new Deno.Command('deno', {
  args: ['task', 'test'],
  stdout: 'piped',
  stderr: 'inherit',
}).spawn()

let dec = new TextDecoder()
let buf = ''
let offenders: { name: string; ms: number }[] = []

for await (let chunk of child.stdout) {
  await Deno.stdout.write(chunk) // tee raw bytes so the run streams as usual
  buf += dec.decode(chunk, { stream: true }).replace(ansi, '')
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    let line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    let m = line.match(done)
    if (m && +m[2] >= 2) offenders.push({ name: m[1], ms: +m[2] })
  }
}

let { code } = await child.status
let strict = !!Deno.env.get('TASKS_FAST_STRICT')

offenders.sort((a, b) => b.ms - a.ms)
console.log(
  `\n─── fast-tier budget: ${offenders.length} test(s) over 1ms ───`,
)
for (let o of offenders) {
  console.log(`  ${String(o.ms).padStart(5)}ms  ${o.name}`)
}
if (offenders.length && !strict) {
  console.log(
    '(advisory — db-backed tests carry production freshDb + apply() cost; set TASKS_FAST_STRICT=1 to gate locally)',
  )
}

// A real test failure fails the run regardless of the budget mode.
if (code !== 0) Deno.exit(code)
if (strict && offenders.length) Deno.exit(1)
