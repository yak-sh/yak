#!/usr/bin/env -S deno run -A --unstable-net --unstable-worker-options
// webperf-gate — the CDP end-to-end tier of the performance ratchet, and the
// deliberately SMALL slow exception to the sub-1ms bar. The bulk of perf
// coverage is chrome-free and <1ms (bin/bench-gate.ts: db, read, render, and
// pure-fn micro-benches); this tier keeps only what a browser uniquely reveals
// — a real cold load through paint + network (load_to_interactive). It boots a
// throwaway probe server on a COMPACT COPY of the live graph, drives it in
// headless Chrome via bin/webperf.ts, and compares to bench/webperf.baseline
// .json: a regression FAILS the gate, an improvement ratchets the baseline
// DOWN. Wired into `deno task gate`; also `deno task bench:gate:web` standalone.
//
// Why a probe copy, never the live graph: webperf navigates and dispatches
// keys — a gesture-driving probe must never touch the owner's board (probe
// hygiene). VACUUM INTO gives a CONSISTENT snapshot even while the server
// writes, so the copy can't catch the live db mid-transaction.
//
// Tolerance is looser than the sub-1ms micro-benches (default 15%,
// baseline.tolerance_pct / env WEBPERF_TOL): a full page load through chrome is
// wall-clock and jitters far more than an in-process bench. A real load
// regression is measured in SECONDS, far past 15%; a timeout (-1 from webperf:
// a step too slow to finish its budget) is a hard regression regardless.
//
// Override: BENCH_ACCEPT=1 (or `deno task bench:accept:web`) records the current
// timings as the new ceiling, regressions INCLUDED — the same explicit, logged
// path the API ratchet uses, and how this baseline is (re)bootstrapped after a
// deliberate change or a material shift in graph scale.
//
// KNOWN LIMITATION (reported to the owner): load_to_interactive scales with the
// size of the probe graph, so as the live graph grows the baseline drifts and
// should be re-accepted (BENCH_ACCEPT) when scale moves materially. The 15%
// band absorbs ordinary growth; per-scale calibration would remove the drift
// but is out of scope here.
import { liveDb } from '../src/store/sqlite.ts'

// Keys in the baseline file that are metadata, not ratcheted timings.
let META = new Set(['_comment', 'tolerance_pct', '_tol'])
// Timings webperf emits but that are NOT ratcheted here. The perf gate is
// deliberately CHROME-MOSTLY-OUT: the bulk of render/logic coverage is the
// chrome-free micro-benches in bin/bench-gate.ts (each <1ms), and this CDP tier
// keeps only the ONE end-to-end a browser uniquely reveals — a real cold load
// through paint + network (load_to_interactive). Excluded:
//   open_board   — a WARM re-render; its cost is now covered chrome-free by the
//                  component-render micro-benches (render_bench.ts), and as a
//                  single CDP sample it jitters ±50%+. Dropped to keep this tier
//                  small and non-flaky; re-add if a real board-paint end-to-end
//                  is wanted (widen its tolerance and raise WEBPERF_RUNS).
//   open_palette — webperf's selector falls back to a bare `input` that matches
//                  any input already on the page, so it swings 4ms↔310ms on a
//                  stray match, not the palette. Re-add once webperf.ts's
//                  palette selector is tightened to the real palette input.
let SKIP = new Set(['open_palette', 'open_board'])
let BASELINE = 'bench/webperf.baseline.json'
let ACCEPT = !!Deno.env.get('BENCH_ACCEPT')

let raw = ((): Record<string, number | string> => {
  try {
    return JSON.parse(Deno.readTextFileSync(BASELINE))
  } catch {
    return {}
  }
})()
// Per-metric tolerance. Different browser measurements have different noise
// floors: a COLD load (load_to_interactive) is dominated by the ~9s snapshot
// render and barely jitters (±3%), so a tight 15% band catches real slowdowns;
// a WARM re-render (open_board) is a small measurement dominated by render +
// poll jitter, swinging ~50% even at min-of-3, so it needs a wide band. Both
// still catch what actually regresses — those events are multi-x (board went
// to 22000ms), far past any band here. WEBPERF_TOL env overrides all metrics
// (a blunt global knob); otherwise baseline._tol[metric] (pct) then
// tolerance_pct then 15%. Tightening open_board needs a precise render-duration
// measurement in webperf.ts (a Performance mark, not poll-until-painted) — the
// web-perf follow-up; until then its wide band is the honest floor.
let envTol = Deno.env.get('WEBPERF_TOL')
let perTol = (typeof raw._tol == 'object' && raw._tol) as
  | Record<string, number>
  | false
let tolFor = (k: string): number => {
  if (envTol != null) return +envTol
  if (perTol && typeof perTol[k] == 'number') return perTol[k] / 100
  if (typeof raw.tolerance_pct == 'number') return raw.tolerance_pct / 100
  return 0.15
}
// The metrics under ratchet: the numeric, non-meta keys the baseline curates
// (load_to_interactive, open_board, open_palette). webperf also emits
// render_nodes (a COUNT, not a time) and _top_frame_hits — deliberately not in
// the baseline, so never compared or ratcheted.
let baseMetrics = (): Record<string, number> => {
  let m: Record<string, number> = {}
  for (let [k, v] of Object.entries(raw)) {
    if (!META.has(k) && !SKIP.has(k) && typeof v == 'number') m[k] = v
  }
  return m
}

let ms = (n: number) => (n < 0 ? 'timeout' : `${n}ms`)
let pct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`

// Each webperf run is a SINGLE cold page-load sample — a full navigation
// through chrome jitters ±30% (open_board especially). The API gate escapes
// this because deno bench repeats internally and reports the min; the web gate
// must do the repeating itself. So sample N times and take the per-metric MIN:
// the fastest cold load is the intrinsic speed (contention only adds time), and
// min-of-N is a stable statistic to ratchet against — a lucky single sample
// can't lure the baseline low and then flake every run after. N is tunable
// (WEBPERF_RUNS, default 2 — load_to_interactive is a stable ±3% cold load, so
// a small N suffices); the expensive copy+boot is done once and amortized.
let RUNS = Math.max(1, +(Deno.env.get('WEBPERF_RUNS') ?? '2'))

let writeBaseline = (metrics: Record<string, number>) => {
  // Preserve the meta (_comment, tolerance_pct); write metrics sorted so the
  // file states what IS and diffs cleanly.
  let out: Record<string, unknown> = {}
  if (typeof raw._comment == 'string') out._comment = raw._comment
  if (typeof raw.tolerance_pct == 'number') {
    out.tolerance_pct = raw.tolerance_pct
  }
  if (perTol) out._tol = perTol
  for (let k of Object.keys(metrics).sort()) out[k] = metrics[k]
  Deno.writeTextFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n')
}

// --- boot a throwaway probe server on a compact copy, measure, reap ---------
let freePort = () => {
  let l = Deno.listen({ port: 0 })
  let p = (l.addr as Deno.NetAddr).port
  l.close()
  return p
}

let measure = async (): Promise<Record<string, number>> => {
  let tmp = await Deno.makeTempFile({ prefix: 'webperf-gate-', suffix: '.db' })
  // VACUUM INTO overwrites — it refuses an existing file, so clear the stub.
  await Deno.remove(tmp)
  let vac = await new Deno.Command('sqlite3', {
    args: [liveDb(), `VACUUM INTO '${tmp}'`],
    stdout: 'null',
    stderr: 'inherit',
  }).output()
  if (vac.code !== 0) {
    console.error('webperf-gate: could not snapshot the live db')
    Deno.exit(vac.code)
  }

  let port = freePort()
  let server = new Deno.Command('deno', {
    args: [
      'run',
      '-A',
      '--unstable-net',
      '--unstable-worker-options',
      'src/server.ts',
    ],
    env: {
      PORT: String(port),
      DB_PATH: tmp,
      TASKS_SYNC: 'off',
      TASKS_EMBED: '0',
      TASKS_BACKOFF: '',
    },
    stdout: 'null',
    stderr: 'null',
  }).spawn()

  let cleanup = async () => {
    try {
      server.kill('SIGTERM')
    } catch { /* already gone */ }
    try {
      await server.status
    } catch { /* */ }
    for (let f of [tmp, `${tmp}-journal`, `${tmp}-wal`, `${tmp}-shm`]) {
      try {
        await Deno.remove(f)
      } catch { /* */ }
    }
  }

  try {
    // Wait for the probe server to answer /graph (its own db, not the live one).
    let up = false
    for (let i = 0; i < 300 && !up; i++) {
      try {
        let r = await fetch(`http://localhost:${port}/graph`, {
          signal: AbortSignal.timeout(1000),
        })
        up = r.ok
        await r.body?.cancel()
      } catch { /* not yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 100))
    }
    if (!up) {
      console.error('webperf-gate: probe server never came up')
      await cleanup()
      Deno.exit(1)
    }

    // One webperf invocation = one cold sample. Repeat and keep the min.
    let one = async (): Promise<Record<string, number>> => {
      let { code, stdout, stderr } = await new Deno.Command('deno', {
        args: [
          'run',
          '-A',
          'bin/webperf.ts',
          `http://localhost:${port}`,
          '--json',
        ],
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (code !== 0) {
        console.error('webperf-gate: the webperf probe failed')
        console.error(new TextDecoder().decode(stderr))
        await cleanup()
        Deno.exit(code)
      }
      // --json emits exactly one line: the timings object.
      let line = new TextDecoder().decode(stdout).trim().split('\n').pop() ??
        '{}'
      return JSON.parse(line)
    }

    // Per-metric min across RUNS. A -1 (timeout) is dropped as jitter UNLESS a
    // metric times out in EVERY run — then it's a real, persistent timeout.
    let samples: Record<string, number[]> = {}
    for (let i = 0; i < RUNS; i++) {
      let s = await one()
      for (let [k, v] of Object.entries(s)) (samples[k] ??= []).push(v)
    }
    let mins: Record<string, number> = {}
    for (let [k, vs] of Object.entries(samples)) {
      let ok = vs.filter((v) => v >= 0)
      mins[k] = ok.length ? Math.min(...ok) : -1
    }
    return mins
  } finally {
    await cleanup()
  }
}

let base = baseMetrics()
let now = await measure()

// ACCEPT: adopt every current timing as the new ceiling, regressions included.
if (ACCEPT) {
  let next: Record<string, number> = {}
  let regressed: string[] = []
  for (let k of Object.keys(base)) {
    let cur = now[k]
    if (typeof cur != 'number') { // metric vanished from the probe — keep old
      next[k] = base[k]
      continue
    }
    next[k] = cur
    if (cur < 0 || cur > base[k] * (1 + tolFor(k))) {
      regressed.push(
        `     ${cur < 0 ? 'timeout' : pct(cur / base[k] - 1)}  ${
          ms(base[k])
        } -> ${ms(cur)}  ${k}`,
      )
    }
  }
  writeBaseline(next)
  if (regressed.length) {
    console.log(
      '\n⚠️  BENCH_ACCEPT — web baseline overwritten INCLUDING regressions:',
    )
    for (let r of regressed) console.log(r)
  }
  console.log(
    `\nwebperf-gate: baseline accepted — ${
      Object.keys(next).length
    } metrics recorded to ${BASELINE}`,
  )
  Deno.exit(0)
}

let regressions: string[] = []
let improved: string[] = []
let next = { ...base }

for (let k of Object.keys(base)) {
  let cur = now[k]
  if (typeof cur != 'number') continue // metric not measured this run — hold
  let b = base[k]
  if (cur < 0) { // a timeout is a step too slow to finish — always a regression
    regressions.push(`  timeout (>budget)  was ${ms(b)}  ${k}`)
    continue
  }
  let ratio = cur / b - 1
  if (ratio > tolFor(k)) {
    regressions.push(
      `  ${pct(ratio).padStart(7)} (>${pct(tolFor(k))})  ${ms(b)} -> ${
        ms(cur)
      }  ${k}`,
    )
  } else if (cur < b) { // ratchet the ceiling down — the app only gets faster
    next[k] = cur
    improved.push(`  ${pct(ratio).padStart(7)}  ${ms(b)} -> ${ms(cur)}  ${k}`)
  }
}

if (regressions.length) {
  console.error(
    `\n─── WEB PERFORMANCE REGRESSION — gate FAILED (per-metric tol) ───\n` +
      regressions.join('\n') +
      `\n\nThe app must only get faster. Fix the slowdown, or — for a justified\n` +
      `speed-for-correctness tradeoff — accept it explicitly:\n` +
      `  BENCH_ACCEPT=1 deno task bench:gate:web   (logs the accepted regression)\n`,
  )
  Deno.exit(1)
}

if (improved.length) {
  console.log('\nfaster — web baseline ratcheted down:\n' + improved.join('\n'))
  writeBaseline(next)
  console.log(
    `\nwebperf-gate: green — baseline updated (${BASELINE}); commit it with your change.`,
  )
} else {
  console.log('\nwebperf-gate: green — no web regression, baseline holds.')
}
