// Fixed yardstick, sampled throughout a suite rather than before a long run.
// Changing this operation or sampling policy requires a suite metric version bump.
function sample(): number {
  let start = performance.now()
  let s = 1
  for (let i = 0; i < 8_000_000; i++) s = (s * 1103515245 + 12345) >>> 0
  if (s === 0) throw new Error('unreachable')
  return (performance.now() - start) / 1000
}
// Warm the JIT before timing the command.
for (let i = 0; i < 5; i++) sample()
postMessage({ ready: true })
function tick() {
  postMessage({ seconds: sample() })
  setTimeout(tick, 1000)
}
tick()
