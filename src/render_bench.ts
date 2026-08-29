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
import { SessionDot } from './components/session_status.tsx'
import { cache, type Comps, ent } from './live.ts'
import { propAt, propOwners } from './props.ts'
import { threadMentions } from './components/views/Session.tsx'

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
    task: { eid: 't', priority: 1 },
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

// The mention SCAN (mdMentions over the whole thread). It used to run on EVERY
// Session render — a pathological 14M-log session stalled first paint on it;
// now it's memoized in the view (keyed on mentionSig), run once per content
// change. This guards the scan stays cheap for a normal thread; the memo keeps
// a big thread from paying it per render.
let thread = Array.from({ length: 60 }, (_, i) => ({
  row: {
    kind: 'say' as const,
    role: (i % 2 ? 'user' : 'agent') as 'user' | 'agent',
    text: `line ${i}: see T-${i} and [ref](https://example.test/${i})`,
  },
}))

Deno.bench('scan: session mentions over a 60-row thread', () => {
  threadMentions(thread)
})

// A native-session dot with a large entry log in the cache. SessionDot reads
// the server-maintained `standing` facet O(1) (T-17855) — it no longer scans
// the log per render (was 157ms/dot). This bench guards that: the render cost
// must not grow with the log, so a reintroduced scan shows up as a regression
// even though the facet says busy.
let log: Record<string, Comps> = {
  s: {
    entity: { eid: 's', num: 2 },
    doc: { eid: 's', title: 'Native session' },
    session: {
      eid: 's',
      id: 'run',
      origin: 'managed',
      status: null,
      standing: 'busy',
    },
    spawn: { eid: 's', provider: 'codex' },
  },
}
for (let i = 0; i < 400; i++) {
  let id = `e${i}`
  log[id] = {
    entity: { eid: id, num: 100 + i },
    entry: { eid: id, seq: i, session: 's' },
    generation: { eid: id, through: 'input', provider: 'codex', model: 'm' },
  }
}
cache.value = log
let se = ent('s')

Deno.bench('render: native SessionDot (O(1) standing)', () => {
  let m = mount(h(SessionDot, { e: se }))
  m.free()
})
