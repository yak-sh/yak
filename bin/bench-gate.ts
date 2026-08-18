#!/usr/bin/env -S deno run -A
// bench-gate — the performance ratchet. The app only ever gets faster.
//
// Runs the hot-path benches (deno bench --json) and gates each one — but on its
// RATIO to a fixed reference bench, not its absolute time. On an improvement it
// ratchets the stored ratio DOWN, so a faster number becomes the new floor no
// future change may cross. Wired into `deno task gate`; also standalone as
// `deno task bench:gate`.
//
// Why RATIO, not absolute — this box is shared and virtualized, and under
// concurrent load EVERY bench slows by a similar factor. (Measured: even
// process CPU-time inflates ~2x under load here, via vCPU frequency-scaling /
// steal — so switching the clock does NOT help.) An absolute-min gate therefore
// cries wolf whenever the box is busy — a different bench each run. The fix:
// the control bench (src/control_bench.ts, a fixed op) is slowed by the SAME
// box conditions, so `bench.min / control.min` cancels them out. Empirically
// this pulls contention inflation from ~2x down to within the tolerance band,
// while a real code regression still raises a bench's ratio (the control is
// unaffected by your diff).
//
// Why MIN, over RUNS runs — the fastest observed ratio is the code's intrinsic
// speed; noise is one-directional (contention only ever ADDS time), and min
// can't be lured low (nothing makes work take negative time), so it's a safe
// ratchet floor. Taking the min ACROSS several suite runs also cancels the
// shared control's own run-to-run jitter (~6% under ambient load).
//
// A regression must clear the relative band (BENCH_TOL, default 0.25) on the
// ratio — the box's measurement noise floor is ~15-20%, so a tighter band false-
// fails; the regressions this catches are multiples, far past 25%. A busy box is
// detected (control far above its floor) and suppresses ratcheting, never the
// regression check — with the control the slowest op, load only LOWERS ratios.
//
// VERSIONING — the baseline stores a `version`. When it doesn't match VERSION
// (a metric change, like this absolute->ratio switch, or a control-op change),
// the stored numbers are incomparable, so the gate RE-BASELINES (writes the
// current ratios, no comparison) instead of flagging every bench. Zero false
// failures on a switchover; normal comparison resumes next run. A bench with no
// stored ratio is likewise recorded, never failed.
//
// Override: BENCH_ACCEPT=1 (or `deno task bench:accept`) writes every current
// ratio as the new baseline, regressions INCLUDED — the explicit, logged path
// for a justified speed-for-correctness tradeoff. Loud on purpose.

let VERSION = 3 // bump when the metric or the control op changes -> re-baseline
let CONTROL = 'control: fixed reference (LCG)' // src/control_bench.ts
let TOL = +(Deno.env.get('BENCH_TOL') ?? '0.25') // the box's measurement noise floor
//   is ~15-20% (shared, virtualized; sub-µs benches jitter hardest as ratios), so a
//   tighter band false-fails. The regressions this gate exists for are MULTIPLES
//   (apply 5-13x, freshDb ~20x, contextDigest scans) — far past 25%. Sub-25%
//   detection isn't achievable here without dedicated hardware; don't pretend it.
let RUNS = +(Deno.env.get('BENCH_RUNS') ?? '3') // suite runs; per bench we take the
//   MIN ratio across them, so ambient jitter in the shared control denominator
//   (measured ~6% run-to-run under background fleet load) can't false-regress.
let LOAD_TOL = +(Deno.env.get('BENCH_LOAD_TOL') ?? '1.5') // control this-far over its
//   idle floor => box is loaded => compare, but don't ratchet/bank (see below)
let ACCEPT = !!Deno.env.get('BENCH_ACCEPT')
let BASELINE = 'bench/baseline.json'
let FILES = [
  'src/control_bench.ts', // the yardstick — must run alongside the rest
  'src/db_bench.ts',
  'src/client_bench.ts',
  'src/render_bench.ts',
  'src/recall_bench.ts',
  'src/embed_bench.ts',
]

type Baseline = {
  version?: number
  control?: string
  controlFloorNs?: number // the control's idle abs min — the load sensor
  ratios?: Record<string, number>
}

let us = (ns: number) =>
  ns >= 1e6
    ? `${(ns / 1e6).toFixed(2)}ms`
    : ns >= 1e3
    ? `${(ns / 1e3).toFixed(1)}µs`
    : `${ns | 0}ns`
let rat = (r: number) => r.toFixed(3)
let pct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`
let sortKeys = (o: Record<string, number>) =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

let readBaseline = (): Baseline => {
  try {
    let j = JSON.parse(Deno.readTextFileSync(BASELINE))
    // old flat format (name -> ns, no version) reads as a version-less baseline,
    // which mismatches VERSION and triggers a clean re-baseline.
    if (j && typeof j === 'object' && 'ratios' in j) return j as Baseline
    return { version: undefined, ratios: undefined }
  } catch {
    return { version: undefined, ratios: {} } // first run
  }
}
let writeBaseline = (ratios: Record<string, number>, controlFloorNs: number) =>
  Deno.writeTextFileSync(
    BASELINE,
    JSON.stringify(
      {
        version: VERSION,
        control: CONTROL,
        controlFloorNs,
        ratios: sortKeys(ratios),
      },
      null,
      2,
    ) + '\n',
  )

// One bench run to JSON. DB_PATH=:memory: keeps them off the live graph (probe
// hygiene); the sync/embed env mirrors `deno task test`.
let measureOnce = async (): Promise<Record<string, number>> => {
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
  let mins: Record<string, number> = {}
  for (let b of json.benches) {
    let min = b.results?.[0]?.ok?.min
    if (typeof min === 'number') mins[b.name] = min
  }
  return mins
}

// Run the suite RUNS times; per bench take the MIN ratio-to-control across runs
// (each run's ratio cancels that run's load; the min picks the cleanest sample
// for both terms). Also return each bench's best absolute min (for display) and
// the best control abs (the load sensor).
let measure = async () => {
  let runs: Record<string, number>[] = []
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce())
  if (!runs.some((r) => r[CONTROL])) {
    console.error(
      `bench-gate: control bench "${CONTROL}" not found — is src/control_bench.ts in FILES?`,
    )
    Deno.exit(1)
  }
  let names = new Set<string>()
  for (let r of runs) {
    for (let k of Object.keys(r)) if (k !== CONTROL) names.add(k)
  }
  let ratios: Record<string, number> = {}
  let absMin: Record<string, number> = {}
  for (let name of names) {
    let bestRatio = Infinity
    let bestAbs = Infinity
    for (let r of runs) {
      let c = r[CONTROL]
      let v = r[name]
      if (c && typeof v === 'number') {
        if (v / c < bestRatio) bestRatio = v / c
        if (v < bestAbs) bestAbs = v
      }
    }
    ratios[name] = bestRatio
    absMin[name] = bestAbs
  }
  let controlAbs = Math.min(
    ...runs.map((r) => r[CONTROL]).filter((x) => typeof x === 'number'),
  )
  return { ratios, absMin, controlAbs }
}

let { ratios, absMin, controlAbs } = await measure()
let mins = absMin // bench display uses each bench's own best abs, not the control's
let bl = readBaseline()

let newFloor = Math.min(bl.controlFloorNs ?? controlAbs, controlAbs)
// The control is (by construction) the slowest op in the suite, so box load
// inflates it at least as much as any bench — load only ever LOWERS ratios. A
// control running well above its idle floor therefore means "box busy": we still
// trust a regression (a ratio RISE can't come from load), but we must NOT bank
// improvements — a load-deflated ratio becoming the new floor would false-regress
// the next quiet run. The floor self-calibrates: it ratchets down toward the true
// idle time as quiet runs happen.
let loaded = controlAbs > newFloor * LOAD_TOL

// ACCEPT or a VERSION mismatch: adopt the current ratios wholesale, no compare.
if (ACCEPT || bl.version !== VERSION) {
  let base = bl.ratios ?? {}
  let regressed = ACCEPT
    ? Object.keys(ratios).filter((k) =>
      base[k] && ratios[k] > base[k] * (1 + TOL)
    )
    : []
  writeBaseline(ratios, controlAbs)
  if (ACCEPT && regressed.length) {
    console.log(
      '\n⚠️  BENCH_ACCEPT — baseline overwritten INCLUDING regressions:',
    )
    for (let k of regressed) {
      console.log(
        `     ${pct(ratios[k] / base[k] - 1)}  ${rat(base[k])} -> ${
          rat(ratios[k])
        }  ${k}`,
      )
    }
  }
  let why = ACCEPT
    ? 'baseline accepted'
    : `metric/version changed (v${
      bl.version ?? '0'
    } -> v${VERSION}) — re-baselined, no comparison this run`
  console.log(
    `\nbench-gate: ${why} — ${
      Object.keys(ratios).length
    } ratios recorded to ${BASELINE} ` +
      `(control ${us(controlAbs)}).`,
  )
  Deno.exit(0)
}

let base = bl.ratios ?? {}
let regressions: string[] = []
let improved: string[] = []
let added: string[] = []
let next = { ...base }

for (let name of Object.keys(ratios)) {
  let cur = ratios[name]
  let b = base[name]
  if (b === undefined) { // a new bench — record its ratio (quiet box only)
    if (!loaded) {
      next[name] = cur
      added.push(`  NEW   ${rat(cur).padStart(8)}  ${us(mins[name])}  ${name}`)
    }
    continue // never a regression
  }
  let delta = cur / b - 1
  if (delta > TOL) {
    regressions.push(
      `  ${pct(delta).padStart(7)}  ${rat(b)} -> ${rat(cur)}  (${
        us(mins[name])
      })  ${name}`,
    )
  } else if (cur < b && !loaded) { // ratchet down — but only on a quiet box
    next[name] = cur
    improved.push(
      `  ${pct(delta).padStart(7)}  ${rat(b)} -> ${rat(cur)}  ${name}`,
    )
  }
}

// Benches that vanished from the source — prune so the file states what IS.
let removed = Object.keys(base).filter((k) => !(k in ratios))
for (let k of removed) delete next[k]

// A regression fails the gate outright — nothing is written, so improvements in
// the same run are NOT banked (the tree must be fixed and re-run).
if (regressions.length) {
  console.error(
    `\n─── PERFORMANCE REGRESSION — gate FAILED (ratio tol ${
      pct(TOL)
    }, control ${us(controlAbs)}) ───\n` +
      regressions.join('\n') +
      `\n\nEach number is the bench's time as a MULTIPLE of the control bench, so\n` +
      `box load cancels out — a rise here is a real slowdown relative to a fixed\n` +
      `op. Fix it, or — for a justified speed-for-correctness tradeoff — accept:\n` +
      `  BENCH_ACCEPT=1 deno task bench:gate   (logs the accepted regression)\n`,
  )
  Deno.exit(1)
}

if (loaded) {
  console.log(
    `\nbench-gate: box loaded (control ${us(controlAbs)} vs floor ${
      us(newFloor)
    }) — ratios held green, baseline NOT ratcheted (improvements deferred to a quiet run).`,
  )
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

// The control floor ratchets down on its own (self-calibrating load sensor), so
// a run can update the baseline for that alone even when nothing else changed.
let floorChanged = newFloor < (bl.controlFloorNs ?? Infinity)
if (improved.length || added.length || removed.length || floorChanged) {
  writeBaseline(next, newFloor)
  console.log(
    `\nbench-gate: green — baseline updated (${BASELINE}); commit it with your change.`,
  )
} else {
  console.log(
    `\nbench-gate: green — no regression, baseline holds (control ${
      us(controlAbs)
    }).`,
  )
}
