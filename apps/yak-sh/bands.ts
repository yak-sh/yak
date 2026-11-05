// The two bands below the story, fed from the tab's graph: the last entity
// written as the source of its bundle, annotated, beside the phases apply()
// ran, each phase happening as the reader scrolls past it and undone as they
// scroll back (#12, drawn as bundle mockup 8); and the doors, the ways into
// one graph, with what came in through them drawn on its sheet (#14).
import { type FunctionComponent, h } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { human } from '@yaks/id'
import { INSIDE, type Phase, PHASES } from '@yaks/graph/plugin'
import type { Bundle } from '@yaks/graph'
import { LINE } from './figure.ts'
import type { Ctx } from './views.ts'
import { text, useHeard, useTold } from './told.ts'
import { clicked, opener } from './editor.ts'
import { proseOf, SITE } from './site.ts'

type Band = FunctionComponent<Ctx & { e: Bundle }>

let cut = (s: unknown, n: number) => {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** The glow a lit stroke wears, and the hatch a stored plate's sides take. */
let defs = () =>
  h('defs', null, [
    h(
      'filter',
      { id: 'band-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' },
      [
        h('feGaussianBlur', { stdDeviation: 2.2, result: 'b' }),
        h('feMerge', null, [
          h('feMergeNode', { in: 'b' }),
          h('feMergeNode', { in: 'SourceGraphic' }),
        ]),
      ],
    ),
    h('pattern', {
      id: 'band-hatch',
      width: 6,
      height: 6,
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
    }, [
      h('rect', { class: 'Hatch_Ground', width: 6, height: 6 }),
      h('path', { class: 'Hatch_Line', d: 'M0 0V6' }),
    ]),
  ])

let Head = ({ e }: { e: Bundle }) =>
  h('div', { class: 'Band_Text' }, [
    h('h2', null, text(e, 'doc', 'title')),
    h(Markdown, { source: proseOf(text(e, 'doc', 'body')) }),
  ])

// ------------------------------------------------------------------ #12

/** What each phase of apply() does, as #12 says it. */
export let DOES: Record<Phase, string> = {
  normalize: 'Rewrites what arrived into one canonical form.',
  admit:
    "Refuses a component or property the vocabulary doesn't declare, and checks each value against it.",
  mint:
    'Gives each `$alias` in the batch an eid, new or derived from its content, and rewrites the references to it.',
  prepare:
    'Finishes idempotent work outside the graph, before the transaction opens.',
  precondition:
    "Checks `$was`, the hashes of the values a writer read, so a concurrent edit isn't overwritten.",
  rules:
    'Evaluates rules against the graph as if the batch were already written, and adds the patches they produce.',
  mutate: 'Writes the patches.',
  cascade: 'A delete takes its dependents with it.',
  stamp: 'Adds `created` to a new entity and `updated` to a changed one.',
  journal:
    'Where `@yaks/journal` is loaded, records the batch for history and undo.',
  commit: 'The last step inside the transaction. Then the batch is stored.',
  effect:
    "Observers run after the commit, each on its own: a failing one can't undo the write.",
  audit:
    'Runs after a rollback instead, from a refusal or a dry run, to see what was refused.',
}

/** A line of the source: a component's key and its properties as the bundle
 * writes them, what the margin says it is, and whether apply() stamps it
 * rather than the writer writing it. */
export type Row = {
  key: string
  name: string
  note: string
  props: [string, unknown][]
  stamped: boolean
}

// What apply() itself adds to the bundle it was given (DOES.stamp).
const STAMPED = new Set(['created', 'updated'])

/** An entity as the source of the bundle that wrote it: its id, what it
 * carries, then the marks on it in the order they were made. `updated`
 * repeats the marks and is left off, as the mockup leaves it. */
export let rowsOf = (b: Bundle, vocab: Ctx['yak']['vocab']): Row[] => {
  let comps = Object.keys(b).filter((k) =>
    !k.startsWith('$') && k != 'updated' && b[k] && typeof b[k] == 'object'
  )
  let mark = (k: string) => !!vocab.comp(k)?.mark
  let at = (k: string) => text(b, k, 'at')
  let rank = (k: string) => k == 'entity' ? -1 : mark(k) ? 1 : 0
  let order = (a: string, z: string) =>
    rank(a) - rank(z) || at(a).localeCompare(at(z)) || a.localeCompare(z)
  return comps.sort(order).map((key) => {
    let value = b[key] as Record<string, unknown>
    let stored = (p: string) => !vocab.prop(key, p)?.computed
    let props = key == 'entity' ? ['eid'] : vocab.props(key).filter(stored)
    return {
      key,
      name: `${key}{${props.join(', ')}}`,
      note: String(vocab.comp(key)?.description ?? ''),
      // What a write wrote: a property read back but never stored, such as
      // a task's status, is left off.
      props: key == 'entity'
        ? [['eid', value.eid]]
        : Object.entries(value).filter(([p, v]) =>
          v !== undefined && stored(p)
        ),
      stamped: STAMPED.has(key),
    }
  })
}

/** How the last write stands with the reader `upto` phases into it (the
 * index of the last phase they have passed): each phase passed ran or was
 * passed by, the phase the reader is at, which have been passed, and
 * whether a line apply() stamps is written yet. */
export let standing = (ran: Set<string>, upto: number) => {
  let past = (p: Phase) => ran.has(p) && PHASES.indexOf(p) <= upto
  return {
    phase: (p: Phase, i: number) =>
      !ran.size || i > upto ? '' : ran.has(p) ? 'on' : 'skip',
    /** The phases passed, and the one the reader is at. */
    passed: ran.size ? PHASES.slice(0, upto + 1) : [],
    now: ran.size ? PHASES[upto] : undefined,
    row: (r: Row) => !r.stamped || past('stamp'),
  }
}

/** The index of the last of `tops` above `line`: how far down a list the
 * reader is, -1 before its first. */
export let passed = (tops: number[], line: number) =>
  tops.reduce((k, top, i) => top < line ? i : k, -1)

let shortly = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

// A value as the source writes it, cut to the line: a string in quotes, a
// number or anything else as JSON.
let valued = (v: unknown) =>
  typeof v == 'string'
    ? h('span', { class: 's' }, JSON.stringify(shortly(v, 34)))
    : typeof v == 'number'
    ? h('span', { class: 'num' }, String(v))
    : h('span', null, shortly(JSON.stringify(v) ?? '', 34))

/** The bundle as its source, mockup 8's: each key a component's name and
 * its object the component's properties, the margin saying what each is.
 * As the reader passes each phase the text changes as apply() changes it:
 * a new entity's alias becomes its eid at mint, `created` appears at
 * stamp, and the braces light at commit. */
let Source = (
  { rows, made, state }: {
    rows: Row[]
    made: boolean
    state: ReturnType<typeof standing>
  },
) => {
  let wide = Math.max(0, ...rows.map((r) => r.key.length))
  // A line of the source; the first of a component's lines names it.
  let line = (cls: string, code: unknown[], note: unknown[] = [], key = '') =>
    h('div', {
      class: `R ${cls}`.trim(),
      key,
      'data-row': key && !key.includes('.') ? key : undefined,
    }, [
      h('div', { class: 'c' }, code as never),
      h('div', { class: 'n' }, note as never),
    ])
  let ok = h('span', { class: 'ok' }, ' ✓')
  let lines = rows.flatMap((r, ri) => {
    let pad = ' '.repeat(wide - r.key.length)
    let props = r.props.map(([p, v], i) => [
      h('span', { class: 'pn' }, p),
      ': ',
      r.key == 'entity' && made
        ? h('span', { class: 'alias' }, [
          h('s', { class: 's' }, '"$new"'),
          h('i', null, JSON.stringify(shortly(String(v), 16))),
        ])
        : valued(v),
      i < r.props.length - 1 ? ',' : '',
    ])
    let head = `    ${r.key}: ${pad}`
    let cls = [
      'comp',
      r.key == 'entity' ? 'ent' : r.stamped ? 'stamp' : 'body',
      `d${Math.min(4, ri + 1)}`,
      state.row(r) ? '' : 'is-out',
    ].join(' ')
    let note = [
      h('code', null, r.name),
      r.stamped
        ? ': written by apply() at stamp, not by you'
        : r.key == 'entity'
        ? made
          ? ': the entity itself. $new is an alias until mint names it'
          : ': the entity this write changed'
        : r.note
        ? `: ${r.note}`
        : '',
      r.stamped ? '' : ok,
    ]
    // One property beside its key; more, one to a line under the first.
    if (!props.length) return [line(cls, [head, '{},'], note, r.key)]
    if (props.length == 1) {
      return [line(cls, [head, '{ ', ...props[0], ' },'], note, r.key)]
    }
    let indent = ' '.repeat(head.length + 2)
    return props.map((p, i) =>
      line(
        cls,
        i == 0
          ? [head, '{ ', ...p]
          : [indent, ...p, i == props.length - 1 ? ' },' : ''],
        i == 0 ? note : [],
        i == 0 ? r.key : `${r.key}.${i}`,
      )
    )
  })
  let brace = (c: string) => h('span', { class: 'brace' }, c)
  return h('div', {
    class: [
      'Source',
      ...state.passed.map((p) => `p-${p}`),
      state.now ? `now-${state.now}` : '',
    ].join(' ').trim(),
    role: 'img',
    'aria-label':
      'The last entity written, as the source of the bundle apply() wrote, each component with a note on what it is',
  }, [
    line('', ['apply(['], [
      'a list: one or many bundles, written in one transaction',
    ]),
    line('', ['  ', brace('{')], [
      'one bundle is one entity, and what its components are is what it is',
    ]),
    ...lines,
    line('', ['  ', brace('}')]),
    line('', ['])']),
  ])
}

export let Stack: Band = (ctx) => {
  let { e, yak, figure } = ctx
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  let { eid, phases, made = false } = figure.last()
  let subject = eid ? yak.row(eid) : undefined
  let rows = subject ? rowsOf(subject, yak.vocab) : []
  let ran = new Set<string>(phases)
  // How far down the phases the reader is, measured each frame they scroll;
  // where nothing measures, as in a test, the whole write has happened.
  let list = useRef<HTMLOListElement>(null)
  let [upto, setUpto] = useState(PHASES.length - 1)
  useLayoutEffect(() => {
    let ol = list.current
    if (!ol || typeof requestAnimationFrame == 'undefined') return
    let frame = 0
    let measure = () => {
      frame = 0
      let tops = [...ol.querySelectorAll('.Dot')]
        .map((d) => d.getBoundingClientRect().top + 4)
      setUpto(passed(tops, innerHeight * LINE))
    }
    let soon = () => frame ||= requestAnimationFrame(measure)
    addEventListener('scroll', soon, { passive: true })
    addEventListener('resize', soon)
    measure()
    return () => {
      removeEventListener('scroll', soon)
      removeEventListener('resize', soon)
      cancelAnimationFrame(frame)
    }
  }, [])
  // A line of the source clicked opens the entity it writes.
  let drawing = useRef<HTMLElement>(null)
  useHeard(drawing, ['click'], (ev) => {
    let row = (ev.target as Element | null)?.closest?.('.Source .R')
    if (row && eid) opener(ctx)(eid)
  })
  let state = standing(ran, upto)
  // A phase turns green once the reader has passed it and it ran.
  let phase = (p: Phase) =>
    h('li', {
      class: state.phase(p, PHASES.indexOf(p)) || undefined,
      // A phase clicked comes to the reading line, so the write runs to it.
      onClick: (ev: Event) =>
        (ev.currentTarget as Element).scrollIntoView?.({
          block: 'center',
          behavior: 'smooth',
        }),
      'data-phase': p,
      key: p,
    }, [
      h('span', { class: 'Dot' }),
      h('b', null, p),
      h(Markdown, { source: DOES[p] }),
      h(
        'span',
        { class: 'Skip' },
        p == 'audit'
          ? "This write committed, so audit didn't run."
          : "This write didn't run this phase.",
      ),
    ])
  // The phases inside the transaction are one box, whatever has run.
  let open = PHASES.indexOf(INSIDE[0])
  let shut = open + INSIDE.length
  return h('section', { class: 'Band Stack', 'data-eid': e.entity.eid }, [
    h('div', { class: 'Stack_Text' }, [
      h(Head, { e }),
      h('ol', {
        class: 'Phases',
        ref: list,
        'aria-label': 'The phases of apply()',
      }, [
        ...PHASES.slice(0, open).map(phase),
        h('li', { class: 'Tx', key: 'tx' }, [
          h('span', { class: 'Tx_Name' }, 'one transaction'),
          h('ol', {
            'aria-label':
              'Inside one transaction: all of these are stored, or none',
          }, PHASES.slice(open, shut).map(phase)),
        ]),
        ...PHASES.slice(shut).map(phase),
      ]),
    ]),
    h('figure', { class: 'Stack_Figure', ref: drawing }, [
      subject ? h(Source, { rows, made, state }) : null,
      h(
        'figcaption',
        null,
        subject
          ? [
            h('span', { class: 'No' }, 'Fig. 2'),
            `${
              human(yak.vocab)(subject)
            } as the graph in this tab holds it, written as the bundle that wrote it.`,
          ]
          : [
            h('span', { class: 'No' }, 'Fig. 2'),
            'Type a command above, and the entity it writes is drawn here.',
          ],
      ),
    ]),
  ])
}

// ------------------------------------------------------------------ #14

/** The sheet's area entities settle in, and where each door's wire meets
 * its edge: #14's own. */
const AREA = { x0: 196, y0: 182, x1: 404, y1: 388 }
const PORT: Record<string, [number, number]> = {
  terminal: [104, 280],
  agent: [496, 280],
  browser: [300, 450],
}
const STAMPS = new Set(['created', 'completed', 'cancelled'])
const ROUTINE = new Set(['entity', 'updated'])

let shown = (b: Bundle) => !!(b.task || b.person || b.session || b.comment)
let kindOf = (b: Bundle) =>
  b.task
    ? 'task'
    : b.person
    ? 'person'
    : b.session
    ? 'session'
    : b.comment
    ? 'comment'
    : 'other'

/** A line between two entities on the sheet: a reference it states, a
 * claim, or the dotted stamp of who made it. */
export type Wire = {
  a: string
  z: string
  kind: 'ref' | 'held' | 'stamp'
  said: string[]
}

/** Every reference between shown entities, one line per pair: what a
 * component states wins over a stamp. */
export let wiresOf = (rows: Bundle[], on: Set<string>): Wire[] => {
  let pairs = new Map<string, Wire>()
  let add = (a: string, z: string, kind: Wire['kind'], said: string) => {
    if (a == z || !on.has(a) || !on.has(z)) return
    let key = a < z ? `${a} ${z}` : `${z} ${a}`
    let l = pairs.get(key) ?? { a, z, kind, said: [] }
    if (kind != 'stamp' && l.kind == 'stamp') (l.kind = kind, l.said = [])
    if (kind == l.kind && !l.said.includes(said)) l.said.push(said)
    pairs.set(key, l)
  }
  for (let b of rows) {
    let edge = b.edge as { from?: string; to?: string } | undefined
    if (edge?.from && edge.to) {
      let rel = Object.keys(b).find((k) =>
        !['entity', 'edge', 'created', 'updated'].includes(k) &&
        !k.startsWith('$')
      ) ?? 'edge'
      add(edge.from, edge.to, 'ref', rel)
      continue
    }
    if (!shown(b)) continue
    for (let [comp, value] of Object.entries(b)) {
      if (ROUTINE.has(comp) || comp.startsWith('$')) continue
      if (!value || typeof value != 'object') continue
      for (let [prop, v] of Object.entries(value)) {
        if (typeof v != 'string' || !on.has(v)) continue
        let kind: Wire['kind'] = STAMPS.has(comp)
          ? 'stamp'
          : comp == 'claim'
          ? 'held'
          : 'ref'
        add(b.entity.eid, v, kind, `${comp}.${prop}`)
      }
    }
  }
  return [...pairs.values()]
}

type Spot = { x: number; y: number; vx: number; vy: number }

/** #14's small force layout, run to rest: entities push apart, lines pull
 * together, people drift toward the terminal's side and sessions toward the
 * agent's. Pure, so the same graph settles the same way. */
export let settle = (
  kinds: Map<string, string>,
  wires: Wire[],
  at: Map<string, Spot>,
  ticks = 300,
) => {
  let w = AREA.x1 - AREA.x0
  for (let t = 0; t < ticks; t++) {
    let list = [...at.entries()]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        let a = list[i][1], z = list[j][1]
        let dx = z.x - a.x, dy = z.y - a.y
        let d2 = Math.max(dx * dx + dy * dy, 25), d = Math.sqrt(d2)
        let f = 1500 / d2
        a.vx -= f * dx / d, a.vy -= f * dy / d
        z.vx += f * dx / d, z.vy += f * dy / d
      }
    }
    for (let l of wires) {
      let a = at.get(l.a), z = at.get(l.z)
      if (!a || !z) continue
      let dx = z.x - a.x, dy = z.y - a.y
      let d = Math.max(Math.hypot(dx, dy), 1)
      let rest = l.kind == 'stamp' ? 120 : 72
      let f = (d - rest) * (l.kind == 'stamp' ? .004 : .03)
      a.vx += f * dx / d, a.vy += f * dy / d
      z.vx -= f * dx / d, z.vy -= f * dy / d
    }
    for (let [eid, n] of list) {
      let k = kinds.get(eid)
      let side = k == 'person' || k == 'session'
      let tx = AREA.x0 + w * (k == 'person' ? .12 : k == 'session' ? .88 : .5)
      n.vx += (tx - n.x) * (side ? .02 : .004)
      n.vy += ((AREA.y0 + AREA.y1) / 2 - n.y) * .004
      n.vx *= .78, n.vy *= .78
      n.x = Math.min(AREA.x1, Math.max(AREA.x0, n.x + n.vx))
      n.y = Math.min(AREA.y1, Math.max(AREA.y0, n.y + n.vy))
    }
  }
  return at
}

let glyph = (kind: string) =>
  kind == 'task'
    ? h('path', { class: 'g', d: 'M0 -10L20 0L0 10L-20 0Z' })
    : kind == 'person'
    ? h('circle', { class: 'g', r: 10 })
    : kind == 'session'
    ? h('rect', { class: 'g', x: -18, y: -9, width: 36, height: 18, rx: 9 })
    : kind == 'comment'
    ? h('rect', { class: 'g', x: -8, y: -8, width: 16, height: 16 })
    : h('circle', { class: 'g', r: 6 })

let statusOf = (b: Bundle) =>
  b.completed ? 'done' : b.cancelled ? 'cancelled' : 'open'

let named = (b: Bundle, id: string) => {
  let doc = b.doc as { title?: string; body?: string } | undefined
  let kind = kindOf(b)
  if (kind == 'task') return [`${id} ${statusOf(b)}`, cut(doc?.title, 22)]
  if (kind == 'person') return [id, cut(doc?.title, 18)]
  if (kind == 'session') return [id, 'session']
  if (kind == 'comment') return [id, cut(doc?.body, 20)]
  return [id, kind]
}

let DOOR_BOXES = [
  h(
    'g',
    { class: 'Door', id: 'door-terminal', transform: 'translate(60 280)' },
    [
      h('rect', { class: 'box', x: -44, y: -30, width: 88, height: 44 }),
      h('text', { class: 'glyph', x: -34, y: -3 }, '$ yak_'),
      h('text', { class: 'cap', x: 0, y: 34, 'text-anchor': 'middle' }, 'you'),
      h(
        'text',
        { class: 'cap2', x: 0, y: 48, 'text-anchor': 'middle' },
        'terminal',
      ),
    ],
  ),
  h('g', { class: 'Door', id: 'door-agent', transform: 'translate(540 280)' }, [
    h('rect', { class: 'box', x: -44, y: -30, width: 88, height: 44 }),
    h('path', {
      class: 'ico',
      d: 'M-14 -16h28v20h-28zM-7 -6h1M6 -6h1M-6 0h12M0 -16v-6M-3 -22h6',
    }),
    h('text', { class: 'cap', x: 0, y: 34, 'text-anchor': 'middle' }, 'agent'),
    h(
      'text',
      { class: 'cap2', x: 0, y: 48, 'text-anchor': 'middle' },
      'over /mcp',
    ),
  ]),
  h(
    'g',
    { class: 'Door', id: 'door-browser', transform: 'translate(300 478)' },
    [
      h('rect', { class: 'box', x: -50, y: -28, width: 100, height: 40 }),
      h('path', {
        class: 'ico',
        d: 'M-50 -18H50M-42 -23h1M-36 -23h1M-30 -23h1M-38 -10h44M-38 -2h30',
      }),
      h('text', { class: 'cap', x: 64, y: -8 }, 'browser'),
      h('text', { class: 'cap2', x: 64, y: 6 }, 'at /'),
    ],
  ),
]

let TICKS = [164, 188, 212, 236, 260, 284, 308, 332, 356, 380, 404, 428]
  .map((x) => `M${x} 136v5M${x} 424v-5`).join('')

let remote = (id: string, x: number, name: string, a: string, b: string) =>
  h('g', { class: 'Remote', id }, [
    h('rect', { class: 'sheet', x, y: 14, width: 200, height: 74 }),
    h('text', { class: 'cap', x: x + 14, y: 40 }, name),
    h('text', { class: 'cap2', x: x + 14, y: 58 }, a),
    h('text', { class: 'cap2', x: x + 14, y: 73 }, b),
  ])

/** The door a write came through: the agent's, or the visitor's terminal. */
export let doorOf = (by: string | undefined, agent: string) =>
  by == agent ? 'agent' : by ? 'terminal' : ''

export let Doors: Band = (ctx) => {
  let { e, yak, figure } = ctx
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  let places = useRef(new Map<string, Spot>())
  let rows = yak.rows()
  let { eid, by } = figure.last()
  let door = doorOf(by, yak.agent)
  let keep = rows.filter(shown).slice(-36)
  let on = new Set(keep.map((b) => b.entity.eid))
  let wires = wiresOf(rows, on)
  let at = places.current
  for (let k of [...at.keys()]) if (!on.has(k)) at.delete(k)
  for (let b of keep) {
    if (at.has(b.entity.eid)) continue
    let [px, py] = PORT[door] ?? []
    let i = at.size
    at.set(b.entity.eid, {
      x: px ?? (AREA.x0 + AREA.x1) / 2 + Math.cos(i * 2.4) * 60,
      y: py ?? (AREA.y0 + AREA.y1) / 2 + Math.sin(i * 2.4) * 50,
      vx: 0,
      vy: 0,
    })
  }
  settle(new Map(keep.map((b) => [b.entity.eid, kindOf(b)])), wires, at)
  let id = human(yak.vocab)
  let calls = rows.filter((b) => b.call).length
  let target = eid ? at.get(eid) : undefined
  let port = PORT[door]
  // An entity clicked opens; the terminal's door goes to the prompt, the
  // agent's opens the agent, and the browser's the page itself.
  let drawn = useRef<SVGSVGElement>(null)
  useHeard(drawn, ['click'], (ev) => {
    let svg = drawn.current!
    let picked = clicked(ev, svg)
    let door = (ev.target as Element | null)?.closest?.('.Door')?.id
    if (picked) return opener(ctx)(picked)
    if (door == 'door-agent') return opener(ctx)(yak.agent)
    if (door == 'door-browser') return opener(ctx)(SITE)
    if (door != 'door-terminal') return
    let input = svg.ownerDocument.querySelector<HTMLInputElement>(
      '.Prompt_Form input',
    )
    input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    input?.focus({ preventScroll: true })
  })
  return h('section', { class: 'Band Doors', 'data-eid': e.entity.eid }, [
    h(Head, { e }),
    h('figure', { class: 'Doors_Figure' }, [
      h('div', { class: 'Doors_Bar' }, [
        h('span', { class: 'No' }, 'Fig. 3'),
        h('span', null, 'The graph in this tab'),
      ]),
      h('svg', {
        class: 'Doors_Draw',
        ref: drawn,
        'data-door': door,
        viewBox: '0 0 600 520',
        role: 'img',
        'aria-label':
          'The graph in this tab: its entities and links as they are written, the terminal, agent and browser that write them, and the graphs on yaks.app and another machine that yak can reach',
      }, [
        defs(),
        remote(
          'remote-box',
          22,
          'build-box',
          'another machine',
          'reached with --host',
        ),
        remote(
          'remote-app',
          378,
          'yaks.app',
          "hosted apps' graphs",
          'on the same packages',
        ),
        h('path', { class: 'Reach', id: 'reach-box', d: 'M60 248V112H122V88' }),
        h('path', { class: 'Reach', id: 'reach-app', d: 'M60 248V120H478V88' }),
        h('rect', { class: 'sheet', x: 140, y: 136, width: 320, height: 288 }),
        h('path', { class: 'sheet-ticks', d: TICKS }),
        h('text', { class: 'cap', x: 152, y: 158 }, 'your graph'),
        h(
          'text',
          { class: 'cap2', id: 'tally', x: 448, y: 158, 'text-anchor': 'end' },
          `${keep.length} entities · ${calls} tool calls`,
        ),
        h('path', { class: 'Wire', id: 'wire-terminal', d: 'M104 280H140' }),
        h('path', { class: 'Wire', id: 'wire-agent', d: 'M496 280H460' }),
        h('path', { class: 'Wire', id: 'wire-browser', d: 'M300 450V424' }),
        ...DOOR_BOXES,
        h(
          'g',
          { class: 'Links' },
          wires.flatMap((l) => {
            let a = at.get(l.a)!, z = at.get(l.z)!
            return [
              h('line', {
                class: `L ${l.kind}`,
                x1: a.x.toFixed(1),
                y1: a.y.toFixed(1),
                x2: z.x.toFixed(1),
                y2: z.y.toFixed(1),
              }),
              h('text', {
                class: `L_Label ${l.kind}`,
                'text-anchor': 'middle',
                x: ((a.x + z.x) / 2).toFixed(1),
                y: ((a.y + z.y) / 2 - 3).toFixed(1),
              }, l.said.join(', ')),
            ]
          }),
        ),
        h(
          'g',
          { class: 'Nodes' },
          keep.map((b) => {
            let p = at.get(b.entity.eid)!
            let [top, sub] = named(b, id(b))
            let cls = ['N', `N-${kindOf(b)}`]
            if (b.task && statusOf(b) == 'done') cls.push('is-done')
            if (b.entity.eid == eid) cls.push('is-new')
            return h('g', {
              class: cls.join(' '),
              'data-eid': b.entity.eid,
              transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
              key: b.entity.eid,
            }, [
              glyph(kindOf(b)),
              h('text', { class: 'id', y: 25 }, top),
              h('text', { class: 'nm', y: 37 }, sub),
            ])
          }),
        ),
        target && port
          ? h('circle', {
            class: 'Pulse',
            r: 3.2,
            key: `${eid}:${rows.length}`,
            style: `--x0:${port[0]}px;--y0:${
              port[1]
            }px;--x1:${target.x}px;--y1:${target.y}px`,
          })
          : null,
      ]),
      h(
        'figcaption',
        null,
        door == 'agent'
          ? 'The agent wrote last, over MCP, to the same graph your commands write.'
          : door
          ? 'You wrote last, from the terminal. The agent calls the same tools over MCP.'
          : 'Each command above writes to this graph through the door it came in by.',
      ),
    ]),
  ])
}
