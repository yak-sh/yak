// The apply() band below the story, fed from the tab's graph: the last entity
// written as the source of its bundle, annotated, beside the phases apply()
// ran, each phase happening as the reader scrolls past it and undone as they
// scroll back (#12, drawn as bundle mockup 8).
import { type FunctionComponent, h } from 'preact'
import { useRef } from 'preact/hooks'
import { Markdown } from '@yaks/markdown'
import { human } from '@yaks/id'
import { INSIDE, type Phase, PHASES } from '@yaks/graph/plugin'
import type { Bundle } from '@yaks/graph'
import type { Ctx } from './views.ts'
import { text, useHeard, useReached, useTold } from './told.ts'
import { opener } from './editor.ts'
import { proseOf } from './site.ts'

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
  let upto = useReached(list, PHASES.length - 1)
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
