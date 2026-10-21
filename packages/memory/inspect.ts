/**
 * How a belief reads in the inspector (@yaks/inspect): the `/views` facet's
 * `inspectViews`, `Inspect.Page`, drawn ahead of the page any entity has,
 * most specific match first. It draws what is its own and asks the inspector
 * for the parts any page has (`io.show`: the head, the body, the facts, the
 * links, the history).
 *
 * - A belief says what it says in full, what it is about and where it holds,
 *   then what it was built from: each memory it cites (`cites` edges), the
 *   words verbatim with who said them, when and where, the line of context
 *   somebody wrote about them, and the conversation around them where they
 *   were said in one, as the package that keeps conversations draws it
 *   (`Inspect.Conversation`, @yaks/session).
 * - In a topic's lists (`Topic.List.Tile`, @yaks/topic), a belief reads as
 *   what it states, and where it holds.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import * as ui from '@yaks/ui'
import {
  type Answer,
  type Bundle,
  type Io,
  mention,
  Part,
  type Props,
  useNamed,
  usePageNotes,
  type View,
} from '@yaks/inspect'
import { words } from './recall.ts'

import { AROUND, statement } from './views.ts'

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** One memory a belief cites: the words verbatim, who said them, when and
 * where, what somebody wrote about them, and, where they were said in a
 * conversation, the turns around them, drawn as the package that keeps the
 * conversation draws it (`Inspect.Conversation`). */
export let Cited = ({ e: m, io }: Props): JSX.Element => {
  let by = str(m, 'created', 'by')
  let session = str(m, 'entry', 'session')
  let on = str(m, 'comment', 'target')
  useNamed(io, [by, session, on])
  let when = str(m, 'created', 'at')
  let where: ComponentChildren[] = [
    session ? h('span', { key: 'in' }, 'in ', mention(io, session)) : null,
    on ? h('span', { key: 'on' }, 'on ', mention(io, on)) : null,
  ]
  return h(
    'div',
    { 'data-cited': m.entity.eid },
    h(
      ui.Quote,
      {},
      h(ui.Quote.Text, {}, words(m)),
      h(
        ui.Quote.By,
        {},
        by ? mention(io, by) : null,
        when ? h('span', { title: when }, io.when(when)) : null,
        ...where.filter(Boolean),
        h(
          'a',
          { href: io.link(m.entity.eid) },
          m.feedback ? 'a correction' : 'the memory',
        ),
      ),
      str(m, 'memory', 'context')
        ? h(ui.Quote.Note, {}, str(m, 'memory', 'context'))
        : null,
    ),
    io.show(m, 'Inspect.Conversation', { ...AROUND, whole: false }),
  )
}

/** What a belief was built from: each memory it cites, read in place. */
let Evidence = (
  { e, io, notes }: { e: Bundle; io: Io; notes: Map<string, Bundle[]> },
): JSX.Element => {
  let eid = e.entity.eid
  let got = io.ask({ cites: `.cites&.edge.from=${eid}&?edge` })
  let cited = rows(got.cites).map((b) => str(b, 'edge', 'to')).filter(Boolean)
  let whole = io.ask(
    cited.length ? { cited: `.entity.eid=${cited.join(',')}&*` } : {},
  )
  let held = new Map(rows(whole.cited).map((b) => [b.entity.eid, b]))
  let ready = got.cites?.ready && (!cited.length || whole.cited?.ready)
  return h(
    Part,
    {
      io,
      eid,
      subject: io.id(e),
      heading: 'Built from',
      count: got.cites?.ready ? cited.length : undefined,
      notes,
    },
    got.cites?.error || whole.cited?.error
      ? h(ui.Rows.More, {}, got.cites?.error ?? whole.cited?.error)
      : !ready && !held.size
      ? h(ui.Loading, {})
      : !cited.length
      ? h(ui.Rows.More, {}, 'it cites nothing')
      : cited.map((to) => {
        let m = held.get(to)
        return m
          ? io.show(m, 'Belief.Cited', {})
          : !whole.cited?.ready
          ? h(ui.Loading, { key: to })
          : h(ui.Rows.More, { key: to }, mention(io, to), ' is gone')
      }),
  )
}

/** A belief's page. */
export let BeliefPage = ({ e, io }: Props): JSX.Element => {
  let notes = usePageNotes(io, e, ['Built from'])
  let about = str(e, 'belief', 'about')
  let scope = str(e, 'belief', 'scope')
  useNamed(io, [about, scope])
  let sub = [
    about ? ['about ', mention(io, about)] : 'about nothing',
    ' · ',
    scope ? ['holds for ', mention(io, scope)] : 'holds everywhere',
  ]
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub, notes: notes.get('') }),
    io.show(e, 'Inspect.Body'),
    h(Evidence, { e, io, notes }),
    io.show(e, 'Inspect.Facts', { notes, skip: ['belief'] }),
    io.show(e, 'Inspect.Links', { notes, skip: ['cites'] }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

/** A belief's reading in a topic's lists: what it states, and where it
 * holds. */
export let BeliefTile = ({ e: b, io }: Props): JSX.Element => {
  let scope = str(b, 'belief', 'scope')
  useNamed(io, [scope])
  return h(
    ui.Rows.Item,
    { 'data-belief': b.entity.eid },
    io.show(b, 'Inspect.Reference.Inline', {}),
    scope ? [' · for ', mention(io, scope)] : null,
    h(ui.Body, { mod: 'short' }, statement(str(b, 'doc', 'body'))),
  )
}

/** The pages this package draws in the inspector. */
export let inspectViews: View[] = [
  { view: 'Belief.Cited', match: parse('.memory'), Render: Cited },
  { view: 'Topic.List.Tile', match: parse('.belief'), Render: BeliefTile },
  { view: 'Inspect.Page', match: parse('.belief'), Render: BeliefPage },
]
