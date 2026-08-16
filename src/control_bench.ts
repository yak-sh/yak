// control_bench — the contention yardstick for the perf gate.
//
// The gate can't trust ABSOLUTE bench times on this shared, virtualized box:
// under concurrent load every bench (and even process CPU-time — measured, it
// inflates ~2x too, via vCPU frequency-scaling/steal) slows by a similar
// factor, so an absolute-min gate cries wolf. The fix is to gate on each
// bench's RATIO to this fixed reference: load slows the reference and the
// measured bench together, so the ratio cancels the box conditions out.
//
// CRITICAL SIZING: this op must be AT LEAST AS SLOW as the slowest gated bench
// (~1-3ms). Under heavy load a long op is preempted proportionally more than a
// short one, so if the control were tiny, a millisecond-scale bench would
// inflate FASTER than the control and false-regress (measured: a 2µs control
// let contextDigest read +92% under 2x-oversubscription). With the control the
// slowest thing in the suite, no bench inflates faster than it — ratios stay
// flat-or-down under load (down never fails the gate), while a real code
// slowdown still raises that bench's ratio (this op is unaffected by your diff).
//
// It is therefore a CONSTANT: a fixed, deterministic ~2ms compute (minimal
// allocation, so GC doesn't add jitter). DO NOT MODIFY IT — changing its cost
// silently shifts every stored ratio. If you add a bench SLOWER than this, or
// must change this op, lengthen it to stay the slowest and bump the gate
// VERSION so the baselines re-establish (bin/bench-gate.ts).
Deno.bench('control: fixed reference (LCG)', () => {
  // ~3ms of deterministic work: an LCG, each step dependent on the last — a true
  // dependency chain the JIT can't vectorize or eliminate, so the cost scales
  // LINEARLY and stays stable run-to-run (unlike a foldable arithmetic loop,
  // which the optimizer times unpredictably). 600k steps ≈ 3ms here, comfortably
  // slower than the slowest gated bench (~1.5ms).
  let s = 1
  for (let i = 0; i < 600_000; i++) s = (s * 1103515245 + 12345) >>> 0
  if (s === 0) throw new Error('unreachable') // keep the work observable
})
