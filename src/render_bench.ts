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
import { md, mdInline, mdMentions } from './md.ts'
import { TElement, TText } from './tui/dom.ts'
import { ansi, pane } from './tui/paint.ts'

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

// --- markdown: the one door every body goes through ------------------------
// md.ts is the single markdown door (the invariant: web content never speaks
// HTML), so every rendered doc body, every comment and every outbound letter
// pays it — a card list pays it per card. The parser is memoized per
// (ref, repo) so it is built once, not per call; a regression that rebuilds it
// per body, or adds a second lexer pass beside the first, shows here.
let BODY = [
  '# A task body',
  '',
  'Some prose with a [link](https://example.test/a) and `code`, plus an',
  'entity reference T-123 and a **bold** run.',
  '',
  '- one',
  '- two',
  '- three',
  '',
  '```ts',
  'let x = 1',
  'let y = x + 1',
  '```',
  '',
  '> a quote, and a trailing paragraph about widgets.',
].join('\n')

Deno.bench('md: render one task body', () => {
  md(BODY)
})
Deno.bench('mdInline: render one title', () => {
  mdInline('A **title** with a T-123 and a [link](https://example.test/a)')
})
// The second reading of the same body — the mention scan that feeds a
// session's aside and the reference index.
Deno.bench('mdMentions: scan one body for references', () => {
  mdMentions(BODY)
})

// --- the TUI repaint -------------------------------------------------------
// pane() walks the WHOLE rendered tree into Line[] on every repaint (the clip
// to the visible window happens after), and ansi() turns one line into the
// bytes the terminal sees. Both are pure over the shim DOM, so they measure
// without a terminal. A regression here is felt as keystroke lag.
let screen = new TElement('root')
for (let i = 0; i < 200; i++) {
  let row = new TElement('div')
  row.className = i == 40 ? 'TRow TRow-on' : 'TRow'
  row.appendChild(new TText(`T-${1000 + i}  a task title for row ${i}`))
  screen.appendChild(row)
}
let footer = new TElement('div')
footer.className = 'footer'
footer.appendChild(new TText('status'))
screen.appendChild(footer)
let painted = pane(screen)

Deno.bench('pane: walk a 200-row TUI tree into lines', () => {
  pane(screen)
})
Deno.bench('ansi: one painted line to terminal bytes', () => {
  ansi(painted.lines[40])
})
