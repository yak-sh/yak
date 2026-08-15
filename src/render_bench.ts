// Chrome-free render + hot-logic baselines — the BULK of the perf ratchet.
// A component renders through the SAME linkedom mount the tests use
// (components/mount.ts), no browser: vnode construction + Preact reconcile is
// exactly where the props.ts allocation cost lived (T-17036) and where a
// per-row render regression (the Session-transcript class) shows up, and all of
// it is measurable in-process. `deno task bench`; ratcheted by bin/bench-gate.ts
// with the same MIN metric + BENCH_ACCEPT override as the API benches.
//
// These target <1ms like a test: a single component render + unmount, and the
// pure vocabulary functions every render funnels through. The whole-transcript
// / full-page cost that a browser reveals stays in the few CDP end-to-end
// benches (bin/webperf-gate.ts) — the marked slow exceptions.
Deno.env.set('DB_PATH', ':memory:')

import { h } from 'preact'
import { mount } from './components/mount.ts'
import { resolve } from './components/Entity.tsx'
import { cache, ent } from './live.ts'
import { propAt, propOwners } from './props.ts'

// --- hot pure functions ----------------------------------------------------
// Memoized over the immutable vocabulary (props.ts). A regression here — the
// memo removed, the O(components) owner scan or the fresh spread back on the
// hot path — is what this guards. Sub-µs when the cache holds.
Deno.bench('propOwners: prop -> owning comps', () => {
  propOwners('status')
})
Deno.bench('propAt: comp.prop -> Prop', () => {
  propAt('task', 'status')
})

// --- component render (chrome-free, through linkedom) -----------------------
// One task in the cache, resolved and rendered the production way. Meta is the
// dense fact row every task/board tile delegates to — the hottest per-item
// render, and the one that funnels through props. A full mount+unmount cycle
// per iteration keeps the linkedom document from leaking across the loop.
cache.value = {
  t: {
    entity: { eid: 't', num: 1 },
    doc: { eid: 't', title: 'Bench task', body: 'body text' },
    task: { eid: 't', status: 'open', priority: 1 },
  },
}
let e = ent('t')

Deno.bench('render: task Meta row', () => {
  let m = mount(h(resolve(e, 'Meta').Render, { e, id: true }))
  m.free()
})

Deno.bench('render: task Tile', () => {
  let m = mount(h(resolve(e, 'Tile').Render, { e }))
  m.free()
})
