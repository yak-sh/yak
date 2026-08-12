// When a graph-native generation should ask the provider to compact its own
// replay state. The provider owns the compaction itself (it emits a compaction
// item we store as a checkpoint entry); this file owns only the policy — the
// serving-model context window and the token threshold at which to trigger it.
// runner.ts sends the policy; projection reads the checkpoints back.

// Serving-model context windows in tokens, matched by name PREFIX so a dated
// pin (gpt-5.6-sol-2026-08-01) inherits its family's window and a requested
// alias (gpt-5.6-sol) resolves to the same figure. Longest prefix wins.
let windows: [string, number][] = [
  ['gpt-5.6', 400_000],
  ['gpt-5', 400_000],
  ['gpt', 128_000],
]

// The window we know for a model, or undefined when we don't — an unknown
// provider/model then runs with no automatic compaction rather than a guess.
export let contextWindow = (model: string): number | undefined => {
  let best: number | undefined
  let seen = -1
  for (let [prefix, size] of windows) {
    if (model.startsWith(prefix) && prefix.length > seen) {
      best = size
      seen = prefix.length
    }
  }
  return best
}

// Headroom below the hard window: compact once the running input crosses this
// fraction of the window, leaving room for the compaction item and the next
// turn's output.
let headroom = 0.25

// The Responses `context_management` policy for a model, or undefined when we
// have no window for it. The provider compacts when the input crosses the
// threshold and returns a compaction item we retain as a checkpoint entry.
export let compactionPolicy = (
  model: string,
): { type: 'compaction'; compact_threshold: number }[] | undefined => {
  let window = contextWindow(model)
  if (!window) return undefined
  return [{
    type: 'compaction',
    compact_threshold: Math.round(window * (1 - headroom)),
  }]
}
