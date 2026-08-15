#!/usr/bin/env -S deno run -A
// bench-gate — the performance ratchet. The app only ever gets faster.
//
// Runs the hot-path benches (deno bench --json), compares each bench's MIN time
// to a committed baseline (bench/baseline.json), and FAILS the gate on a real
// regression. On an improvement it ratchets the baseline DOWN, so a faster
// number becomes the new floor no future change may cross. Wired into
// `deno task gate`; also `deno task bench:gate` standalone.
//
// Why MIN, not avg/p75 — this is the resolution of the noise-vs-"any regression
// is unacceptable" tension. A benchmark on a shared box is noisy, but the noise
// is ONE-DIRECTIONAL: contention only ever ADDS time. The fastest observed
// iteration is therefore the code's intrinsic speed, immune to a loaded box,
// and a real regression raises even that floor. min also can't be lured LOW by
// a lucky sample — nothing makes the work take negative time — so it is safe as
// a ratchet floor: only a genuine speedup lowers it.
//
// A regression must clear BOTH a relative band (BENCH_TOL, default 0.10 = 10%)
// AND an absolute floor (BENCH_FLOOR ns, default 500) — so a percent swing on a
// sub-µs op, where relative jitter is largest, is not a false alarm. The floor
// stays small because min barely jitters. Real regressions this class was built
// for were multiples (apply 5-13x, freshDb ~20x), far past either bound.
//
// Override: BENCH_ACCEPT=1 (or `deno task bench:accept`) writes every current
// min as the new baseline, regressions INCLUDED — the explicit, logged path for
// a justified speed-for-correctness tradeoff, and how the baseline is first
// bootstrapped. Loud on purpose: an accepted regression prints a banner.

let TOL = +(Deno.env.get('BENCH_TOL') ?? '0.10')
let FLOOR = +(Deno.env.get('BENCH_FLOOR') ?? '500') // ns — small, since min barely jitters
let ACCEPT = !!Deno.env.get('BENCH_ACCEPT')
let BASELINE = 'bench/baseline.json'
let FILES = [
  'src/db_bench.ts',
  'src/client_bench.ts',
  'src/render_bench.ts',
  'src/recall_bench.ts',
]

let us = (ns: number) =>
  // ns -> a human figure
  ns >= 1e6
    ? `${(ns / 1e6).toFixed(2)}ms`
    : ns >= 1e3
    ? `${(ns / 1e3).toFixed(1)}µs`
    : `${ns | 0}ns`
let pct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`
let sortKeys = (o: Record<string, number>) =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

let readBaseline = (): Record<string, number> => {
  try {
    return JSON.parse(Deno.readTextFileSync(BASELINE))
  } catch {
    return {} // first run — every bench is new
  }
}
let writeBaseline = (b: Record<string, number>) =>
  Deno.writeTextFileSync(BASELINE, JSON.stringify(sortKeys(b), null, 2) + '\n')

// Run the benches to JSON. DB_PATH=:memory: keeps them off the live graph
// (probe hygiene); the sync/embed env mirrors `deno task test`.
let measure = async (): Promise<Record<string, number>> => {
  let { code, stdout } = await new Deno.Command('deno', {
    args: ['bench', '-A', '--json', ...FILES],
    env: {
      DB_PATH: ':memory:',
      TASKS_SYNC: 'off',
      TASKS_EMBED: '0',
      TASKS_BACKOFF: '',
    },
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  if (code !== 0) {
    console.error('bench-gate: the bench run itself failed')
    Deno.exit(code)
  }
  let json = JSON.parse(new TextDecoder().decode(stdout))
  let now: Record<string, number> = {}
  for (let b of json.benches) {
    let min = b.results?.[0]?.ok?.min
    if (typeof min === 'number') now[b.name] = min
  }
  return now
}

let now = await measure()
let base = readBaseline()

// ACCEPT: adopt every current number, regressions included. Bootstrap + override.
if (ACCEPT) {
  let regressed = Object.keys(now).filter((k) =>
    base[k] && now[k] > base[k] * (1 + TOL)
  )
  writeBaseline(now)
  if (regressed.length) {
    console.log(
      '\n⚠️  BENCH_ACCEPT — baseline overwritten INCLUDING regressions:',
    )
    for (let k of regressed) {
      console.log(
        `     ${pct(now[k] / base[k] - 1)}  ${us(base[k])} -> ${
          us(now[k])
        }  ${k}`,
      )
    }
  }
  console.log(
    `\nbench-gate: baseline accepted — ${
      Object.keys(now).length
    } benches recorded to ${BASELINE}`,
  )
  Deno.exit(0)
}

let regressions: string[] = []
let improved: string[] = []
let added: string[] = []
let next = { ...base }

for (let name of Object.keys(now)) {
  let cur = now[name]
  let b = base[name]
  if (b === undefined) { // a new bench — record its floor, never a regression
    next[name] = cur
    added.push(`  NEW   ${us(cur).padStart(8)}  ${name}`)
    continue
  }
  let ratio = cur / b - 1
  let delta = cur - b
  if (delta > FLOOR && ratio > TOL) {
    regressions.push(
      `  ${pct(ratio).padStart(7)}  ${us(b)} -> ${us(cur)}  ${name}`,
    )
  } else if (cur < b) { // ratchet the floor down — the app only gets faster
    next[name] = cur
    improved.push(
      `  ${pct(ratio).padStart(7)}  ${us(b)} -> ${us(cur)}  ${name}`,
    )
  }
}

// Benches that vanished from the source — prune so the file states what IS.
let removed = Object.keys(base).filter((k) => !(k in now))
for (let k of removed) delete next[k]

// A regression fails the gate outright — nothing is written, so improvements in
// the same run are NOT banked (the tree must be fixed and re-run).
if (regressions.length) {
  console.error(
    `\n─── PERFORMANCE REGRESSION — gate FAILED (tol ${pct(TOL)}, floor ${
      us(FLOOR)
    }) ───\n` +
      regressions.join('\n') +
      `\n\nThe app must only get faster. Fix the slowdown, or — for a justified\n` +
      `speed-for-correctness tradeoff — accept it explicitly:\n` +
      `  BENCH_ACCEPT=1 deno task bench:gate   (logs the accepted regression)\n`,
  )
  Deno.exit(1)
}

if (added.length) {
  console.log('\nnew benches (recorded to baseline):\n' + added.join('\n'))
}
if (improved.length) {
  console.log('\nfaster — baseline ratcheted down:\n' + improved.join('\n'))
}
if (removed.length) {
  console.log('\npruned (bench removed): ' + removed.join(', '))
}

// Improvements/new/pruned change the file; a clean run leaves it untouched.
if (improved.length || added.length || removed.length) {
  writeBaseline(next)
  console.log(
    `\nbench-gate: green — baseline updated (${BASELINE}); commit it with your change.`,
  )
} else {
  console.log('\nbench-gate: green — no regression, baseline holds.')
}
