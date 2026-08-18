// A registry of the server's recurring reconcilers, and one door to silence
// them all. Every sweep ticks on setInterval; when a source-edit handoff tells
// this process to cede the port, drain() awaits in-flight work settle before it
// exits — an unbounded window (managed.settle() holds for a live codex turn).
// A sweep left ticking through that window keeps firing writes at the live db
// from a process whose CODE the graph already moved past — probe-sweep
// TypeErrors on a shape it predates, telemetry rows the newer CHECK rejects,
// every interval for as long as the drain hangs (T-19494). Registering each
// interval here lets drain stop() them the instant we cede, before that window
// opens, and without cutting the graceful drain short.

type Timer = ReturnType<typeof setInterval>
let live = new Set<Timer>()

// Start a recurring timer AND remember it, so stop() can clear it later — the
// drop-in for setInterval wherever the server means "a sweep that must not
// outlive a decision to cede the port".
export let repeat = (fn: () => void, ms: number): Timer => {
  let id = setInterval(fn, ms)
  live.add(id)
  return id
}

// Clear every timer repeat() started; returns how many were still live. Past
// this point no registered interval fires again on this event loop. Idempotent
// — a cleared id is inert and the set empties, so a second call, or one when
// nothing was started, is a no-op.
export let stop = (): number => {
  let n = live.size
  for (let id of live) clearInterval(id)
  live.clear()
  return n
}
