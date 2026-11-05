// The apply() band below the story, fed from the tab's graph: the last entity
// written as the source of its bundle, annotated, beside the phases apply()
// ran, each phase doing its work on it as the reader scrolls past and undone
// as they scroll back (#12, drawn as bundle mockup 8). Reached, the band makes
// its own write, a letter from your agent, and what its effect did after the
// commit is shown: the outbox it was handed to, and a toast once it was sent.
import { type FunctionComponent, h } from 'preact'
import { useRef } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { human } from '@yaks/id'
import { INSIDE, type Phase, PHASES } from '@yaks/graph/plugin'
import { type Bundle, composed } from '@yaks/graph'
import type { Ctx } from './views.ts'
import type { Change } from './yak.ts'
import type { Try } from './outbox.ts'
import { text, useHeard, useReached, useTold } from './told.ts'
import { opener } from './editor.ts'
import { proseOf, scriptOf } from './site.ts'

type Band = FunctionComponent<Ctx & { e: Bundle }>

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
    "Refuses a component or property the vocabulary doesn't declare, checks each value against it, and turns a short id such as `T-3` into the eid it names.",
  mint:
    'Gives each `$alias` in the batch an eid, new or derived from its content, and rewrites the references to it.',
  prepare:
    'Finishes idempotent work outside the graph, before the transaction opens.',
  precondition:
    "Checks `$was`, the hashes of the values a writer read, so a concurrent edit isn't overwritten.",
  rules:
    'Evaluates rules against the graph as if the batch were already written, and adds the patches they produce, such as a default filled in.',
  mutate: 'Writes the patches.',
  cascade: 'A delete takes its dependents with it.',
  stamp: 'Adds `created` to a new entity and `updated` to a changed one.',
  journal:
    'Where `@yaks/journal` is loaded, records the batch for history and undo.',
  commit: 'The last step inside the transaction. Then the batch is stored.',
  effect:
    "After the commit, each effect the write owes runs on its own, such as handing a letter to a mail service. One that fails is tried again later, and can't undo the write.",
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
        : Object.entries(value).filter(([p, v]) => v != null && stored(p)),
      stamped: STAMPED.has(key),
    }
  })
}

/** The entity a write made or changed as each phase it ran left it: its
 * bundles in the batch, under its alias until mint names it, composed into
 * one. What the effects it owed wrote to it after the commit (`later`) is
 * the effect phase's. */
export let stagesOf = (
  steps: Change['steps'],
  eid: string,
  later: Bundle[] = [],
) => {
  let alias = steps.flatMap(([, b]) => b)
    .find((b) => b.entity.eid == eid && b.$alias)?.$alias
  let its = (b: Bundle) => b.entity.eid == eid || b.entity.eid == alias
  return new Map(steps.flatMap(([phase, bundles]) => {
    let [b] = composed(
      [...bundles, ...phase == 'effect' ? later : []].filter(its),
    )
    return b ? [[phase, b] as const] : []
  }))
}

/** What the reader sees of a write `upto` phases into it (-1 before the
 * first): the entity's rows as the last phase passed that ran left them, and
 * each line the phase the reader is at changed, keyed `comp` for a component
 * it wrote and `comp.prop` for a property, with the value it had before. */
export let seen = (
  stages: Map<Phase, Bundle>,
  upto: number,
  vocab: Ctx['yak']['vocab'],
) => {
  let passed = PHASES.filter((p, i) => i <= upto && stages.has(p))
  let shown = stages.get(passed.at(-1) ?? [...stages.keys()][0])
  let rows = shown ? rowsOf(shown, vocab) : []
  let changed = new Map<string, unknown>()
  let before = stages.has(PHASES[upto]) && passed.length > 1 &&
    stages.get(passed.at(-2)!)
  if (!before) return { rows, changed }
  let was = new Map(
    rowsOf(before, vocab).map((r) => [r.key, new Map(r.props)]),
  )
  for (let r of rows) {
    let had = was.get(r.key)
    if (!had) changed.set(r.key, undefined)
    for (let [p, v] of had ? r.props : []) {
      let old = had!.get(p)
      if (JSON.stringify(old) != JSON.stringify(v)) {
        changed.set(`${r.key}.${p}`, old)
      }
    }
  }
  return { rows, changed }
}

/** How the last write stands with the reader `upto` phases into it (the
 * index of the last phase they have passed): each phase passed ran or was
 * passed by, which have been passed, and the phase the reader is at. */
export let standing = (ran: Set<string>, upto: number) => ({
  phase: (p: Phase, i: number) =>
    !ran.size || i > upto ? '' : ran.has(p) ? 'on' : 'skip',
  passed: ran.size ? PHASES.slice(0, Math.max(0, upto + 1)) : [],
  now: ran.size ? PHASES[upto] : undefined,
})

let shortly = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

// An eid, which the source shows by its first eight characters.
const EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// A value as the source writes it, cut to the line: a string in quotes, a
// number or anything else as JSON.
let valued = (v: unknown) =>
  typeof v == 'string'
    ? h(
      'span',
      { class: 's' },
      JSON.stringify(shortly(v, EID.test(v) ? 8 : 34)),
    )
    : typeof v == 'number'
    ? h('span', { class: 'num' }, String(v))
    : h('span', null, shortly(JSON.stringify(v) ?? '', 34))

/** The bundle as its source, mockup 8's: each key a component's name and
 * its object the component's properties, the margin saying what each is.
 * As the reader passes each phase the text is the bundle as that phase left
 * it, each line the phase changed lit with what it did, and the braces light
 * at commit. */
let Source = (
  { rows, changed, state }: {
    rows: Row[]
    changed: Map<string, unknown>
    state: ReturnType<typeof standing>
  },
) => {
  let wide = Math.max(0, ...rows.map((r) => r.key.length))
  let phase = state.now
  // What the phase the reader is at did to a line, if anything.
  let did = (key: string) => {
    if (!changed.has(key)) return
    let was = changed.get(key)
    if (phase == 'effect') return ['an effect wrote this after the commit']
    return was === undefined
      ? [h('b', null, phase), ' wrote this']
      : [h('b', null, phase), ' turned ', valued(was), ' into this']
  }
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
      valued(v),
      i < r.props.length - 1 ? ',' : '',
    ])
    let head = `    ${r.key}: ${pad}`
    let cls = [
      'comp',
      r.key == 'entity' ? 'ent' : r.stamped ? 'stamp' : 'body',
      `d${Math.min(4, ri + 1)}`,
    ].join(' ')
    let alias = r.key == 'entity' && String(r.props[0]?.[1]).startsWith('$')
    let note = [
      h('code', null, r.name),
      r.stamped
        ? ': written by apply() at stamp, not by you'
        : r.key == 'entity'
        ? alias
          ? ': the entity itself, named by an alias until mint gives it an eid'
          : ': the entity itself'
        : r.note
        ? `: ${r.note}`
        : '',
      r.stamped ? '' : ok,
    ]
    // Line i of the component: lit if the phase the reader is at changed
    // it, and in the margin what that phase did, or on the first line what
    // the component is.
    let at = (i: number, code: unknown[], key: string) => {
      let prop = r.props[i]?.[0]
      let now = did(r.key) ?? did(`${r.key}.${prop}`)
      let said = !changed.has(r.key)
        ? now ?? (i == 0 ? note : [])
        : i == 0
        ? [h('code', null, r.name), ': ', ...now!]
        : []
      return line(`${cls}${now ? ' is-now' : ''}`, code, said, key)
    }
    // One property beside its key; more, one to a line under the first.
    if (!props.length) return [at(0, [head, '{},'], r.key)]
    if (props.length == 1) {
      return [at(0, [head, '{ ', ...props[0], ' },'], r.key)]
    }
    let indent = ' '.repeat(head.length + 2)
    return props.map((p, i) =>
      at(
        i,
        i == 0
          ? [head, '{ ', ...p]
          : [indent, ...p, i == props.length - 1 ? ' },' : ''],
        i == 0 ? r.key : `${r.key}.${i}`,
      )
    )
  })
  let brace = (c: string) => h('span', { class: 'brace' }, c)
  return h('div', {
    class: [
      'Source',
      ...state.passed.map((p) => `p-${p}`),
      phase ? `now-${phase}` : '',
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

let secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** What the mail service the letter's effect hands it to did with it: each
 * try, how long after the first, and the id it was given or why it was
 * turned away. */
let Outbox = ({ tries }: { tries: Try[] }) =>
  h('div', { class: 'Outbox' }, [
    h('div', { class: 'Outbox_Bar' }, [
      h('b', null, 'outbox'),
      ' the mail service in this tab, which sends nothing on',
    ]),
    h(
      'ol',
      null,
      tries.map((t) =>
        h('li', { class: t.id ? 'is-taken' : 'is-refused' }, [
          h('span', { class: 'Outbox_At' }, `+${secs(t.at - tries[0].at)}`),
          t.id
            ? `taken as ${t.id}, from ${t.from} to ${t.to}`
            : `turned away: ${t.said}. The effect tries again.`,
        ])
      ),
    ),
  ])

const EFFECT = PHASES.indexOf('effect')

export let Stack: Band = (ctx) => {
  let { e, yak, figure, term } = ctx
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  useTold(yak.outbox.listen)
  let body = text(e, 'doc', 'body')
  let { line: said, eid, phases, steps, later } = figure.last()
  let stages = eid ? stagesOf(steps, eid, later) : new Map<Phase, Bundle>()
  let named = eid ? yak.row(eid) : undefined
  // How far down the list the reader is, measured each frame they scroll:
  // past the band's write it is made, once, and past each phase that phase
  // has happened. Where nothing measures, as in a test, all of it has.
  let list = useRef<HTMLOListElement>(null)
  let upto = useReached(list, PHASES.length, (k) => {
    if (k >= 0) term.once(e.entity.eid, body)
  }) - 1
  // A line of the source clicked opens the entity it writes.
  let drawing = useRef<HTMLElement>(null)
  useHeard(drawing, ['click'], (ev) => {
    let row = (ev.target as Element | null)?.closest?.('.Source .R')
    if (row && eid) opener(ctx)(eid)
  })
  let state = standing(new Set(phases), upto)
  let { rows, changed } = seen(stages, upto, yak.vocab)
  // Past the effect phase, what the effects did: the letter's tries at the
  // outbox, and a toast once it was sent.
  let past = upto >= EFFECT
  let after = stages.get('effect')
  let title = named ? text(named, 'doc', 'title') : ''
  // What the caption calls it: its number, or else its title.
  let called = !named
    ? ''
    : named.entity.num == null && title
    ? `“${title}”`
    : human(yak.vocab)(named)
  let tries = past ? yak.outbox.tries().filter((t) => t.subject == title) : []
  let sent = past && after?.delivered ? text(after, 'mail', 'to') : ''
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
  // The command the write came from: the band's own until a write is made.
  let own = scriptOf(body).mcp[0]
  let call = said ??
    {
      kind: 'agent',
      text: own ? `${own.tool} ${JSON.stringify(own.args)}` : '',
    }
  // The phases inside the transaction are one box, whatever has run.
  let open = PHASES.indexOf(INSIDE[0])
  let shut = open + INSIDE.length
  return h('section', { class: 'Band Stack', 'data-eid': e.entity.eid }, [
    h('div', { class: 'Stack_Text' }, [
      h(Head, { e }),
      h('ol', {
        class: 'Phases',
        ref: list,
        'aria-label': 'The write, and the phases of apply() it ran',
      }, [
        h(
          'li',
          { class: eid && upto >= -1 ? 'Call on' : 'Call', key: 'call' },
          [
            h('span', { class: 'Dot' }),
            h('b', null, 'the write'),
            h('code', null, [
              call.kind == 'agent' ? 'agent ▸ ' : '$ ',
              call.text,
            ]),
          ],
        ),
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
      rows.length ? h(Source, { rows, changed, state }) : null,
      tries.length ? h(Outbox, { tries }) : null,
      h(
        'figcaption',
        null,
        named
          ? [
            h('span', { class: 'No' }, 'Fig. 2'),
            `${called}, the last entity written, as the bundle that wrote it: each phase you pass changes it as apply() did.`,
          ]
          : [
            h('span', { class: 'No' }, 'Fig. 2'),
            'Type a command above, and the entity it writes is drawn here.',
          ],
      ),
    ]),
    sent
      ? h('div', { class: 'Toast', role: 'status', key: eid }, [
        h('b', null, `Email sent to ${sent}`),
        h('span', null, title),
      ])
      : null,
  ])
}
