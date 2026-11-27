/**
 * A workflow's page: its map, then its cases moving through. The map is its
 * steps in stages (./flow.ts), each saying which steps feed it and how many
 * cases stand at it, made rows there and have rows outdated by its last edit.
 * Each case says what it is for, where it stands and what holds it (an open
 * call or task, and who it is for), then what each step made for it, the
 * outdated rows marked. Every row is drawn by its own renderer, asked for as
 * `Workflow.Inspect.Reference.Inline`, so a task reads as a task and a call
 * as a call. The same tree paints in a browser and a terminal.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import {
  type Answer,
  type Asks,
  type Bundle,
  type Io,
  mention,
  type Props,
  type Reader,
  useNamed,
  useReading,
} from '@yaks/inspect'
import {
  Chip,
  Empty,
  Head,
  Loading,
  Pairs,
  Rows,
  Section,
  Tile,
} from '@yaks/ui'
import type { Comp, Eid } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { type Count, type Flow, flow, type Placed, type Read } from './flow.ts'
import { outdated } from './outdated.ts'

/** How many cases a workflow's page lists, newest first. */
export let CASES = 200

/** How many rows made for its cases the page reads. */
export let MADE = 2000

/** The view each row a step made is drawn as. */
export let MADE_VIEW = 'Workflow.Inspect.Reference.Inline'

let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let AND = new Intl.ListFormat('en', { type: 'conjunction' })
let plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n == 1 ? one : many}`

/** What a workflow's page asks: the steps it contains, its cases (newest
 * first where the graph stamps when a row was made), the rows made for them
 * and the results answering their calls. */
export let asks = (e: Bundle, io: Io): Asks => {
  let w = e.entity.eid
  let newest = io.vocab.comp('created') ? '&.order=-created.at' : ''
  return {
    steps: `.contains[<=1]<-${w}&.step&*`,
    cases: `.workflow_case.workflow=${w}&*${newest}&.limit=${CASES}`,
    made: `.made.case.workflow_case.workflow=${w}&*&.limit=${MADE}`,
    results:
      `.result.call.made.case.workflow_case.workflow=${w}&?result&.limit=${MADE}`,
  }
}

// The rows each step made before its last edit, read from the journal where
// the graph keeps one.
let stale = (vocab: Vocab, steps: Eid[]) => (r: Reader): Eid[] =>
  vocab.comp('_change')
    ? steps.flatMap((s) => {
      let found = outdated({ ...r, vocab }, s)
      return Array.isArray(found) ? found : []
    })
    : []

/** A workflow read from the page's answers: the steps' `requires` edges and
 * the journal are asked here, as they depend on which steps it holds. */
let useFlow = (io: Io, got: Props['got']): Flow => {
  let steps = rows(got.steps)
  let ids = steps.map((b) => b.entity.eid)
  let edges = io.ask({
    requires: ids.length
      ? `.requires&.edge.from=${ids.join(',')}&?edge&.limit=${ids.length * 8}`
      : '',
  })
  let old = useReading(io, stale(io.vocab, ids)).value
  return flow({
    steps,
    requires: rows(edges.requires),
    cases: rows(got.cases),
    made: rows(got.made),
    results: rows(got.results),
    outdated: old,
  }, io.vocab)
}

// How many cases stand at a step, made rows there, and are outdated.
let counted = (c: Count): string =>
  [
    c.at ? `${c.at.toLocaleString('en')} here` : '',
    c.made ? `${c.made.toLocaleString('en')} made` : '',
    c.outdated ? `${c.outdated.toLocaleString('en')} outdated` : '',
  ].filter(Boolean).join(' · ')

/** The map: each stage's steps side by side, each saying what feeds it. */
let Map_ = (
  { io, read }: { io: Io; read: Flow },
): JSX.Element => {
  let titles = new Map(read.stages.flat().map((s) => [s.eid, s.title]))
  let step = (s: Placed) =>
    h(
      Tile,
      { key: s.eid, href: io.link(s.eid), 'data-step': s.eid },
      h(Tile.Title, {}, s.title),
      h(
        Tile.Sub,
        {},
        s.after.length
          ? `after ${AND.format(s.after.map((a) => titles.get(a)!))}`
          : 'starts a case',
      ),
      h(Tile.End, {}, counted(read.counts[s.eid])),
    )
  return h(
    Section,
    { 'data-section': 'Steps' },
    h(Section.Title, {}, 'Steps', h(Section.Count, {}, titles.size)),
    titles.size
      ? read.stages.map((stage, i) => [
        h(
          Rows.Note,
          { key: `stage${i}` },
          i ? 'Then' : 'First',
          stage.length > 1 ? ', side by side' : '',
        ),
        h(Rows, { key: `rows${i}`, 'data-stage': i }, stage.map(step)),
      ])
      : h(Rows.Note, {}, 'it holds no steps yet'),
  )
}

// A row a step made, drawn by its own renderer, and who it is for where it
// is a task filed to someone.
let made = (io: Io, b: Bundle): JSX.Element => {
  let to = str(comp(b, 'filed').assignee)
  return h(
    'span',
    { key: b.entity.eid, 'data-made': b.entity.eid },
    io.show(b, MADE_VIEW),
    to ? [' for ', mention(io, to)] : null,
  )
}

let listed = (io: Io, all: Bundle[], out = new Set<Eid>()) =>
  all.flatMap((b, i) => [
    i ? ', ' : null,
    made(io, b),
    out.has(b.entity.eid)
      ? [' ', h(Chip, { mod: 'quiet', 'data-outdated': '' }, 'outdated')]
      : null,
  ])

/** Where a case stands, in words. */
let where = (io: Io, c: Read, titles: Map<Eid, string>) =>
  c.done
    ? 'done'
    : c.held.length
    ? ['waiting on ', listed(io, c.held)]
    : c.at.length
    ? `after ${AND.format(c.at.map((s) => titles.get(s) ?? s))}`
    : 'not started'

/** One case: what it is for and where it stands, then what each step made. */
let Case = ({ io, c, read }: { io: Io; c: Read; read: Flow }): JSX.Element => {
  let out = new Set(c.outdated)
  let steps = read.stages.flat()
  let titles = new Map(steps.map((s) => [s.eid, s.title]))
  let reached = steps.filter((s) => c.made[s.eid])
  return h(
    Rows.Item,
    { 'data-case': c.eid, 'data-done': c.done ? '' : undefined },
    h(
      Rows.Main,
      {},
      h(Rows.Name, { mod: 'line' }, c.item ? mention(io, c.item) : c.eid),
      h(Rows.Meta, { mod: 'line', 'data-where': '' }, where(io, c, titles)),
    ),
    reached.length
      ? h(
        Rows.Detail,
        {},
        h(
          Pairs,
          {},
          reached.flatMap((s) => [
            h(Pairs.Key, { key: `k${s.eid}` }, s.title),
            h(
              Pairs.Value,
              { key: `v${s.eid}`, 'data-by': s.eid },
              listed(io, c.made[s.eid], out),
            ),
          ]),
        ),
      )
      : null,
  )
}

/** Its cases, those still moving first. */
let Cases = (
  { io, read, ready }: { io: Io; read: Flow; ready: boolean },
): JSX.Element => {
  let moving = read.cases.filter((c) => !c.done)
  let done = read.cases.filter((c) => c.done)
  return h(
    Section,
    { 'data-section': 'Cases' },
    h(
      Section.Title,
      {},
      'Cases',
      h(Section.Count, {}, read.cases.length),
    ),
    !ready ? h(Loading, {}, 'Loading its cases…') : read.cases.length
      ? h(
        Rows,
        { mod: 'ruled' },
        [...moving, ...done].map((c) => h(Case, { key: c.eid, io, c, read })),
      )
      : h(Rows.Note, {}, 'nothing has moved through it yet'),
    read.cases.length >= CASES
      ? h(Rows.More, {}, `the newest ${CASES} cases`)
      : null,
  )
}

/** A workflow's page. */
export let WorkflowPage = ({ e, got, io }: Props): JSX.Element => {
  let read = useFlow(io, got)
  useNamed(io, [
    ...read.cases.map((c) => c.item),
    ...read.cases.flatMap((c) =>
      c.held.map((b) => str(comp(b, 'filed').assignee))
    ),
  ])
  let failed = Object.values(got).find((a) => a.error)
  let moving = read.cases.filter((c) => !c.done).length
  let doc = comp(e, 'doc')
  return h(
    'article',
    { 'data-workflow': e.entity.eid },
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        str(doc.title) || 'Workflow',
        ' ',
        h(Head.Id, {}, io.id(e)),
      ),
      doc.body ? h(Head.Sub, {}, str(doc.body)) : null,
      h(
        Head.Facts,
        {},
        plural(read.stages.flat().length, 'step'),
        plural(read.cases.length, 'case'),
        `${moving.toLocaleString('en')} moving`,
      ),
    ),
    failed ? h(Section.Sub, { role: 'alert' }, failed.error) : null,
    rows(got.steps).length || !got.steps?.ready ? h(Map_, { io, read }) : h(
      Empty,
      {},
      h(Empty.Title, {}, 'No steps yet'),
      'A step this workflow contains shows here, with the cases moving through it.',
    ),
    h(Cases, {
      io,
      read,
      ready: !!(got.cases?.ready && got.made?.ready),
    }),
  )
}
