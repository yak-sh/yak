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
// Tolerance is far looser than the sub-1ms micro-benches (baseline
// .tolerance_pct, currently 150% / env WEBPERF_TOL), and that width is not
// slack — it is the MACHINE. This number is wall-clock on a shared box whose
// load swings ~4x within an hour: measured 2026-09-05 on an unchanged tree, the
// best-of-10 warm sample ranged 266ms to 573ms across consecutive runs. A band
// narrower than that machine variance does not make the gate stricter, it makes
// it random — and a gate that is red on unchanged code teaches everyone to
// ignore it, which is how a true regression gets through. So this tier stays
// what its header says it is: a coarse backstop for the 14s-load / 22s-board
// class, ~45x the ceiling. Fine per-op regressions belong to the chrome-free
// micro-benches, which are in-process and repeat internally. A timeout (-1 from
// webperf: a step too slow to finish its budget) is a hard regression
// regardless of band.
//
// The sampling also has to earn its verdict: a discarded warm-up run (the first
// load against a freshly booted server pays that process's one-time costs,
// which no human ever pays), then samples read twice — BEST to judge a
// regression, FIRM (the second-smallest, i.e. a time hit twice) as the only
// value that may become a stored ceiling. See the RUNS note below for why:
// ratcheting to a lucky single sample is how this baseline went 9310ms ->
// 316ms and then stayed red on an unchanged tree.
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
// Per-metric tolerance. Every browser measurement here sits on the same noise
// floor — the machine — and it is wide: load_to_interactive was long documented
// as "a stable ±3% cold load", which is what justified a tight band, and it is
// not true on a shared box (see the tolerance note in the header for the
// measurements). Both metrics still catch what regresses, because those events
// are multi-x (board went to 22000ms), far past any band here. WEBPERF_TOL env
// overrides all metrics (a blunt global knob); otherwise baseline._tol[metric]
// (pct) then tolerance_pct then 15%. Narrowing either band needs a
// machine-relative measurement — a per-run calibration the app's cost is
// divided by, so contention cancels — not a smaller number here.
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
// The stored ceilings, read once: measure() samples against them.
let base = baseMetrics()

let ms = (n: number) => (n < 0 ? 'timeout' : `${n}ms`)
let pct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`

// Each webperf run is a SINGLE cold page-load sample — a full navigation
// through chrome jitters ±30% (open_board especially). The API gate escapes
// this because deno bench repeats internally and reports the min; the web gate
// must do the repeating itself. So sample N times, then read the samples twice:
//
//   BEST (the min) is what a regression is judged against. Contention can only
//   ADD time, so the fastest sample is the closest thing to intrinsic speed;
//   judging on the min is what keeps a busy box from failing the gate.
//   FIRM (the second-smallest) is what the ceiling may be ratcheted DOWN to. A
//   ceiling nobody can reach twice is not a ceiling: ratcheting to the best
//   single sample lets one lucky quiet moment write a number the gate can never
//   hit again, and every run after that is red. That is exactly how this
//   baseline went 9310ms -> 316ms inside an unrelated commit (2780ff44) and
//   stayed red on an unchanged tree.
//
// The box is SHARED and its load swings ~4x within an hour, so a fixed, small N
// cannot decide anything: 2 contended samples are not evidence, and 2 samples
// never gave FIRM a second value to agree with. So N is a FLOOR, not a count —
// after WEBPERF_RUNS samples the gate keeps sampling while any metric is still
// out of band, up to WEBPERF_MAX. It spends time only when it is about to fail,
// which is exactly when spending it is worth something, and a quiet box pays
// the floor. This buys contention-resistance without widening the band or
// raising the ceiling — both of which would blind the gate to a true
// regression. It cannot mask one either: if the app really is slower, no sample
// lands in the band and the gate burns its whole cap and fails.
let RUNS = Math.max(1, +(Deno.env.get('WEBPERF_RUNS') ?? '3'))
let MAX = Math.max(RUNS, +(Deno.env.get('WEBPERF_MAX') ?? '10'))

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

type Sampled = { best: Record<string, number>; firm: Record<string, number> }

let measure = async (): Promise<Sampled> => {
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

    // Warm-up, discarded: the FIRST page load against a freshly booted server
    // is 2-6x the rest, because it alone pays that process's one-time costs —
    // the per-socket worker's module compile, statement preparation, the first
    // snapshot build. No human ever pays that: nobody loads a server that has
    // served zero requests. Measuring it made half of a 2-sample run an
    // artifact of the probe harness rather than of the app.
    await one()

    // Per-metric BEST (min) and FIRM (second-smallest). A -1 (timeout) is
    // dropped as jitter UNLESS a metric times out in EVERY sample — then it's a
    // real, persistent timeout.
    let samples: Record<string, number[]> = {}
    let n = 0
    let take = async () => {
      let s = await one()
      for (let [k, v] of Object.entries(s)) (samples[k] ??= []).push(v)
      n++
    }
    let stat = (): Sampled => {
      let best: Record<string, number> = {}
      let firm: Record<string, number> = {}
      for (let [k, vs] of Object.entries(samples)) {
        let ok = vs.filter((v) => v >= 0).sort((a, b) => a - b)
        best[k] = ok.length ? ok[0] : -1
        // With one sample there is nothing to agree with it, so FIRM is it.
        firm[k] = ok.length ? ok[1] ?? ok[0] : -1
      }
      return { best, firm }
    }
    // In band = every ratcheted metric's BEST is at or under its ceiling. That
    // is the verdict the gate is about to give, so it is also the right thing
    // to stop sampling on.
    let inBand = () => {
      let { best } = stat()
      return Object.keys(base).every((k) => {
        let v = best[k]
        return typeof v != 'number' ||
          (v >= 0 && v <= base[k] * (1 + tolFor(k)))
      })
    }

    for (let i = 0; i < RUNS; i++) await take()
    // ACCEPT records what is, so it never chases a band it is about to rewrite.
    while (!ACCEPT && n < MAX && !inBand()) await take()
    return stat()
  } finally {
    await cleanup()
  }
}

// `now` is what a regression is judged against; `firm` is the only value that
// may become a stored ceiling — see the RUNS note above.
let { best: now, firm } = await measure()

// ACCEPT: adopt every current timing as the new ceiling, regressions included.
if (ACCEPT) {
  let next: Record<string, number> = {}
  let regressed: string[] = []
  for (let k of Object.keys(base)) {
    let cur = firm[k]
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
  } else if (firm[k] >= 0 && firm[k] < b) {
    // Ratchet the ceiling down — the app only gets faster — but only as far as
    // FIRM, a time this run hit twice. The best single sample is a claim about
    // one quiet moment; the ceiling has to be a claim about the machine.
    next[k] = firm[k]
    improved.push(
      `  ${pct(firm[k] / b - 1).padStart(7)}  ${ms(b)} -> ${
        ms(firm[k])
      }  ${k}  (best ${ms(cur)})`,
    )
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
