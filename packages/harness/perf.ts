// Reproducible hot-path probe, outside the fast test tier:
// DENO_SQLITE_PATH=libsqlite3.so.0 deno run -A packages/harness/perf.ts
import type { Bundle } from '@yaks/graph'
import { daemon } from '@yaks/session'
import { open } from './store.ts'
import { seed } from './run.ts'

let h = open(':memory:')
h.g.apply([...seed({ model: 'fake' }), { entity: { eid: 's' }, session: {} }])
let prefix: Bundle[] = Array.from({ length: 1000 }, (_, i) => ({
  entity: { eid: `e${i}` },
  entry: { session: 's', seq: i + 1 },
  content: { body: `entry ${i}` },
  ...i == 0 ? { using: { model: 'model:fake' } } : {},
}))
h.g.apply(prefix)
let apply: number[] = [], overhead: number[] = []
let applied = 0, sample = 0
let d = daemon(h.g, h.fx, {
  tools: [],
  model: (req) => {
    if (sample >= 10) overhead.push(performance.now() - applied)
    return Promise.resolve({ id: 'r', model: req.model, items: [] })
  },
})
for (let i = 0; i < 60; i++) {
  sample = i
  let before = performance.now()
  let wrote = h.g.apply([{
    entity: { eid: `input${i}` },
    entry: { session: 's', seq: 1001 },
    content: { body: `input ${i}` },
  }])
  applied = performance.now()
  await wrote
  await d.idle('s')
  // Remove the ask: every sample sees the same 1,000-entry prefix.
  let asks = [...await h.g.read('.ask'), { entity: { eid: `input${i}` } }]
  await h.g.apply(asks.map((b) => ({ entity: b.entity, tombstone: {} })))
  if (i >= 10) apply.push(applied - before)
}
let summary = (xs: number[]) => {
  xs.sort((a, b) => a - b)
  return {
    median_ms: xs[Math.floor(xs.length / 2)],
    p95_ms: xs[Math.floor(xs.length * .95)],
  }
}
console.log(
  JSON.stringify(
    {
      entries: 1000,
      samples: 50,
      apply: summary(apply),
      react: summary(overhead),
    },
    null,
    2,
  ),
)
h.close()
