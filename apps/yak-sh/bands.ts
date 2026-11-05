// The two bands below the story, drawn as mockups #12 and #14 drew them and
// fed from the tab's graph: the stack is the last entity written as plates,
// one per component, beside the phases apply() ran, each phase happening as
// the reader scrolls past it and undone as they scroll back; the doors are
// the ways into one graph, with what came in through them drawn on its sheet.
import { type FunctionComponent, h } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { human } from '@yaks/id'
import { INSIDE, type Phase, PHASES } from '@yaks/graph/plugin'
import type { Bundle } from '@yaks/graph'
import { proseOf } from './site.ts'
import { LINE } from './figure.ts'
import type { Ctx } from './views.ts'
import { text, useTold } from './told.ts'

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

// The drawing's measures, #12's own: a plate is a rhombus W wide and H tall
// with sides T thick, stacked a STEP apart; the rail stands at RX.
const CX = 128, W = 104, H = 52, T = 8, STEP = 78, BASE = 470
const RX = 532, TOP = 44, BOTTOM = 440

let faces = (cy: number) => ({
  f: `M${CX},${cy - H}L${CX + W},${cy}L${CX},${cy + H}L${CX - W},${cy}Z`,
  l: `M${CX - W},${cy}L${CX},${cy + H}L${CX},${cy + H + T}L${CX - W},${
    cy + T
  }Z`,
  r: `M${CX},${cy + H}L${CX + W},${cy}L${CX + W},${cy + T}L${CX},${
    cy + H + T
  }Z`,
})
let iso = (x: number, y: number) =>
  `translate(${x} ${y}) matrix(.894 .447 -.894 .447 0 0)`

/** A component on the stack: its name with its properties, what the
 * vocabulary says it is, and its first value. */
export type Plate = {
  key: string
  name: string
  note: string
  value: string
  /** A mark, stamped on the entity rather than written into it. */
  mark: boolean
}

/** The plates of an entity, bottom up: its id, what it carries, then the
 * marks stamped on it in the order they were made. `updated` repeats the
 * marks and is left off, as #12 leaves it. */
export let platesOf = (b: Bundle, vocab: Ctx['yak']['vocab']): Plate[] => {
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
    let props = key == 'entity' ? ['eid'] : vocab.props(key)
    let shown = mark(key) ? ['at', value.at] : Object.entries(value)
      .find(([, v]) => v != null && typeof v != 'object')
    return {
      key,
      mark: mark(key),
      name: `${key}{${props.join(', ')}}`,
      note: cut(vocab.comp(key)?.description, 44),
      value: key == 'entity'
        ? String(value.eid)
        : shown
        ? cut(`${shown[0]}: ${JSON.stringify(shown[1])}`, 40)
        : '',
    }
  })
}

/** How the last write stands with the reader `upto` phases into it (the
 * index of the last phase they have passed): each phase passed ran or was
 * passed by; a plate is in once the phase that writes it has run (the id at
 * mint, a mark at stamp, any other component at mutate); and the entity is
 * stored once commit has. */
export let standing = (ran: Set<string>, upto: number) => {
  let past = (p: Phase) => ran.has(p) && PHASES.indexOf(p) <= upto
  let lit = PHASES.map((p, i) => ran.has(p) && i <= upto ? i : -1)
  return {
    phase: (p: Phase, i: number) =>
      !ran.size || i > upto ? '' : ran.has(p) ? 'on' : 'skip',
    plate: (key: string, mark: boolean) =>
      past(key == 'entity' ? 'mint' : mark ? 'stamp' : 'mutate'),
    stored: past('commit'),
    /** The last phase passed that ran, or -1. */
    reached: Math.max(-1, ...lit),
  }
}

/** The index of the last of `tops` above `line`: how far down a list the
 * reader is, -1 before its first. */
export let passed = (tops: number[], line: number) =>
  tops.reduce((k, top, i) => top < line ? i : k, -1)

let StackDrawing = (
  { plates, ran, upto }: { plates: Plate[]; ran: Set<string>; upto: number },
) => {
  let gap = (BOTTOM - TOP) / (PHASES.length - 1)
  let y = (i: number) => TOP + i * gap
  let slots = Math.max(5, plates.length)
  let cy = (i: number) => BASE - i * STEP
  let top = Math.min(0, cy(slots - 1) - H - 40)
  let inside = INSIDE.map((p) => PHASES.indexOf(p))
  let first = Math.min(...inside), last = Math.max(...inside)
  let state = standing(ran, upto)
  let { reached } = state
  let len = y(PHASES.length - 1) - y(0)
  let ghosts = Array.from({ length: slots }, (_, i) => {
    let { f, l, r } = faces(cy(i))
    return h('g', { class: 'gh', key: i }, [
      h('path', { d: f }),
      h('path', { d: l }),
      h('path', { d: r }),
    ])
  })
  let drawn = plates.map((p, i) => {
    let { f, l, r } = faces(cy(i))
    return h('g', {
      class: state.plate(p.key, p.mark) ? 'pl' : 'pl is-out',
      'data-pl': p.key,
      key: p.key,
      style: `--i:${i}`,
    }, [
      h('path', { class: 'l', d: l }),
      h('path', { class: 'r', d: r }),
      h('path', { class: 'f', d: f }),
      h('text', {
        class: 'face',
        transform: iso(CX, cy(i)),
        'text-anchor': 'middle',
        dy: 5,
      }, p.key),
    ])
  })
  let callouts = plates.map((p, i) => {
    let x = CX + W, at = cy(i)
    return h('g', {
      class: state.plate(p.key, p.mark) ? 'co' : 'co is-out',
      'data-co': p.key,
      key: p.key,
    }, [
      h('circle', { cx: x, cy: at, r: 2.2 }),
      h('path', { d: `M${x} ${at}L${x + 20} ${at - 20}H${x + 38}` }),
      h('text', { class: 'nm', x: x + 44, y: at - 16 }, p.name),
      h('text', { class: 'nt', x: x + 44, y: at }, p.note),
      h('text', { class: 'vl', x: x + 44, y: at + 15 }, p.value),
    ])
  })
  let rail = h('g', { class: 'Rail' }, [
    h('text', { class: 'rail-title', x: RX - 8, y: TOP - 22 }, 'apply()'),
    h('path', {
      class: 'rail-base',
      d: `M${RX} ${y(0)}V${y(PHASES.length - 1)}`,
    }),
    h('path', {
      class: 'rail-lit',
      d: `M${RX} ${y(0)}V${y(PHASES.length - 1)}`,
      'stroke-dasharray': len,
      'stroke-dashoffset': reached < 0 ? len : len - reached * gap,
    }),
    h('path', {
      class: 'bracket',
      d: `M640 ${y(first) - 12}H648V${y(last) + 12}H640`,
    }),
    h('text', {
      class: 'bracket-label',
      transform: `translate(664 ${(y(first) + y(last)) / 2}) rotate(-90)`,
      'text-anchor': 'middle',
    }, 'one transaction'),
    ...PHASES.map((p, i) =>
      h('g', {
        class: `st ${state.phase(p, i)}`.trim(),
        'data-st': p,
        key: p,
      }, [
        h('circle', { cx: RX, cy: y(i), r: 5 }),
        h('text', { x: RX + 16, y: y(i) + 4 }, p),
      ])
    ),
  ])
  let axes = h('path', {
    class: 'axis',
    d: `M${CX - W} ${cy(slots - 1)}V${BASE}M${CX + W} ${
      cy(slots - 1)
    }V${BASE}M${CX} ${cy(slots - 1) + H}V${BASE + 60}`,
  })
  return h('svg', {
    class: `Stack_Draw${state.stored ? ' stored' : ''}`,
    viewBox: `0 ${top} 680 ${560 - top}`,
    role: 'img',
    'aria-label':
      'The last entity written, drawn as stacked plates, one for each component, beside the phases of apply()',
  }, [defs(), axes, ...ghosts, ...drawn, ...callouts, rail])
}

export let Stack: Band = ({ e, yak, figure }) => {
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  let { eid, phases } = figure.last()
  let subject = eid ? yak.row(eid) : undefined
  let plates = subject ? platesOf(subject, yak.vocab) : []
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
  let state = standing(ran, upto)
  let inside = new Set<string>(INSIDE)
  return h('section', { class: 'Band Stack', 'data-eid': e.entity.eid }, [
    h('div', { class: 'Stack_Text' }, [
      h(Head, { e }),
      h(
        'ol',
        {
          class: 'Phases',
          ref: list,
          'aria-label': 'The phases of apply()',
        },
        PHASES.map((p, i) =>
          h('li', {
            class: state.phase(p, i) || undefined,
            'data-phase': p,
            'data-tx': inside.has(p) ? '' : undefined,
            'data-tx-first': p == INSIDE[0] ? '' : undefined,
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
        ),
      ),
    ]),
    h('figure', { class: 'Stack_Figure' }, [
      h(StackDrawing, { plates, ran, upto }),
      h(
        'figcaption',
        null,
        subject
          ? [
            h('span', { class: 'No' }, 'Fig. 2'),
            `${
              human(yak.vocab)(subject)
            } as the graph in this tab holds it, and the phases its write ran.`,
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
export let doorOf = (row: Bundle | undefined, agent: string) => {
  let by = row && (text(row, 'updated', 'by') || text(row, 'created', 'by'))
  return by == agent ? 'agent' : by ? 'terminal' : ''
}

export let Doors: Band = ({ e, yak, figure }) => {
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  let places = useRef(new Map<string, Spot>())
  let rows = yak.rows()
  let { eid } = figure.last()
  let door = doorOf(eid ? yak.row(eid) : undefined, yak.agent)
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
  return h('section', { class: 'Band Doors', 'data-eid': e.entity.eid }, [
    h(Head, { e }),
    h('figure', { class: 'Doors_Figure' }, [
      h('div', { class: 'Doors_Bar' }, [
        h('span', { class: 'No' }, 'Fig. 3'),
        h('span', null, 'The graph in this tab'),
      ]),
      h('svg', {
        class: 'Doors_Draw',
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
