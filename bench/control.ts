// Fixed yardstick, sampled throughout a suite rather than before a long run.
// Changing this operation or sampling policy requires a suite metric version bump.
function sample(): number {
  let start = performance.now()
  let s = 1
  for (let i = 0; i < 8_000_000; i++) s = (s * 1103515245 + 12345) >>> 0
  if (s === 0) throw new Error('unreachable')
  return (performance.now() - start) / 1000
}
if (import.meta.main) {
  // Warm the JIT before timing the command. One run does it: the loop is
  // compiled within its first run, which is already as fast as the tenth.
  sample()
  postMessage({ ready: true })
  let tick = () => {
    postMessage({ seconds: sample() })
    setTimeout(tick, 1000)
  }
  tick()
}
