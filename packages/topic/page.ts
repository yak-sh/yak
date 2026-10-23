/**
 * A topic's page, read the way a book is: its cover (`doc{title, body}`, the
 * title and a line or two saying what belongs under it, its body drawn as
 * every doc's is, through `Inspect.Body`), a line to ask about it where the
 * host draws a conversation (`Conversation`: a session opened on the topic,
 * wearing the oracle), its contents (`content.body`, what is
 * understood about it), then what it holds (`contains`), what to understand
 * first (`requires`), what is related (`reads`, `references`) and its sources
 * (`cites`), the beliefs about it (`belief.about`), and the comments on it,
 * with a line to write one, where the host draws a thread (`Comments`); last,
 * the parts any page has (`io.show`: the facts, the links, the history). Its
 * head says what holds it: a topic belongs to whatever contains it.
 *
 * Whatever a topic holds or cites is drawn by its own renderer, asked for as
 * `Topic.List.Tile`: a subtopic as its cover (`TopicTile`), a belief as what
 * it states (@yaks/memory), anything else as it reads in any list. Each part
 * is an ordered list edited in place: a row dragged between two others is
 * put there, and opens where it stands on its title and body.
 *
 * An archived belief is kept, not live, so the beliefs part lists the live
 * ones and opens the archived ones on a press, muted.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { Markdown } from '@yaks/markdown'
import * as ui from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import {
  type Answer,
  type Asks,
  type Bundle,
  edited,
  Held,
  type Io,
  Part,
  type Props,
  usePageNotes,
} from '@yaks/inspect'
import { title, TOPIC } from './topic.ts'

/** How many edges from a topic its page reads. */
export let EDGES = 500

/** How many beliefs about a topic its page lists, live or archived. */
export let BELIEFS = 200

/** The relations a topic's page draws in parts of their own, in order, each
 * under its heading. */
export let PARTS: [string, string[]][] = [
  ['Contains', ['contains']],
  ['Understand first', ['requires']],
  ['Related', ['reads', 'references']],
  ['Sources', ['cites']],
]

// What the links part leaves to the parts above: each relation read from the
// topic's end, the topic holding it, and the beliefs about it.
let DRAWN = [
  ...PARTS.flatMap(([, rels]) => rels),
  'contained by',
  'belief.about',
]

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = comp(b, name)[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** What a topic's page asks: its edges, what holds it, and the beliefs about
 * it where the graph keeps beliefs. What holds it comes whole, so the head
 * names it as it first paints. */
export let asks = (e: Bundle, io: Io): Asks => {
  let eid = e.entity.eid
  return {
    out: `.edge.from=${eid}&*&.order=edge.ord&.limit=${EDGES}`,
    within: `.contains[<=1]->${eid}&?doc&?${TOPIC}&.limit=${EDGES}`,
    ...io.vocab.comp('belief')
      ? {
        beliefs: `.belief.about=${eid}&!archived&*` +
          `&.order=-created.at&.limit=${BELIEFS}`,
        archived: `.belief.about=${eid}&.archived&.count`,
      }
      : {},
  }
}

let byTitle = (a: Bundle, b: Bundle) =>
  title(a).localeCompare(title(b), undefined, { sensitivity: 'base' })

// An entity by name, drawn from the answer that brought it, so no id shows
// while its name is on the way.
let named = (io: Io, b: Bundle) => io.show(b, 'Inspect.Reference.Inline')

// Each of some entities by name, a comma between them.
let listed = (io: Io, said: string, all: Bundle[]): ComponentChildren =>
  all.length
    ? [said, ...all.flatMap((b, i) => [i ? ', ' : null, named(io, b)])]
    : null

type Of = { e: Bundle; io: Io; notes: Map<string, Bundle[]> }

/** What is understood about it, as one document. */
let Contents = ({ e, io, notes }: Of): JSX.Element => {
  let text = str(e, 'content', 'body')
  let eid = e.entity.eid
  return h(
    Part,
    { io, eid, subject: io.id(e), heading: 'Contents', notes },
    edited(io, eid)
      ? null
      : text
      ? h(ui.Body, {}, h(Markdown, { source: text }))
      : h(ui.Rows.More, {}, 'nothing is written here yet'),
  )
}

/** One part's far ends, each drawn by its own renderer, in edge order: an
 * ordered list edited in place (@yaks/inspect `Held`), which an entity
 * dragged from elsewhere joins where a part names one relation. */
let Relation = (
  { e, io, notes, heading, rels, edges, ends }: Of & {
    heading: string
    rels: string[]
    edges: Bundle[]
    ends?: Answer
  },
): JSX.Element | null =>
  edges.length
    ? h(
      Part,
      {
        io,
        eid: e.entity.eid,
        subject: io.id(e),
        heading,
        count: edges.length,
        notes,
      },
      h(Held, {
        io,
        from: e.entity.eid,
        links: edges,
        ends,
        tile: 'Topic.List.Tile',
        empty: '',
        tag: rels.length == 1 ? rels[0] : undefined,
      }),
    )
    : null

/** The archived beliefs, asked for only once they are opened. */
let Archived = ({ e, io }: { e: Bundle; io: Io }): JSX.Element => {
  let got = io.ask({
    beliefs: `.belief.about=${e.entity.eid}&.archived&*` +
      `&.order=-created.at&.limit=${BELIEFS}`,
  }).beliefs
  return got?.error
    ? h(ui.Rows.More, {}, got.error)
    : !got?.ready && !rows(got).length
    ? h(ui.Loading, {})
    : h(
      ui.Rows,
      { mod: 'quiet' },
      rows(got).map((b) => io.show(b, 'Topic.List.Tile', {})),
    )
}

/** The beliefs about it: the live ones, newest first, and the archived ones
 * on a press. */
let Beliefs = (
  { e, io, notes, got }: Of & { got: Record<string, Answer> },
): JSX.Element | null => {
  if (!io.vocab.comp('belief')) return null
  let live = rows(got.beliefs)
  let kept = got.archived?.count ?? 0
  let at = disclosureAt(`${e.entity.eid}/archived beliefs`)
  let open = io.state(at) ?? { entity: { eid: at } }
  return h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: io.id(e),
      heading: 'Beliefs',
      count: got.beliefs?.ready ? live.length : undefined,
      notes,
    },
    got.beliefs?.error
      ? h(ui.Rows.More, {}, got.beliefs.error)
      : !got.beliefs?.ready && !live.length
      ? h(ui.Loading, {})
      : live.length
      ? h(ui.Rows, {}, live.map((b) => io.show(b, 'Topic.List.Tile', {})))
      : h(
        ui.Rows.More,
        {},
        kept ? 'none live' : 'nothing is believed about it yet',
      ),
    kept
      ? h(Disclosure, {
        e: open,
        onChange: (b: Bundle) => io.set([b]),
        summary: [isOpen(open) ? '▾ ' : '▸ ', `${kept} archived`],
        summaryProps: { mod: 'quiet' },
      }, h(Archived, { e, io }))
      : null,
  )
}

/** A line to ask about it: a session opened on the topic, wearing the oracle,
 * wherever the host draws a conversation (`Conversation`); a host without one
 * has no part. */
let Ask = ({ e, io }: { e: Bundle; io: Io }): JSX.Element | null =>
  io.can(e, 'Conversation')
    ? h(
      ui.Section,
      { 'data-section': 'Ask' },
      h(ui.Section.Title, {}, 'Ask'),
      io.show(e, 'Conversation', {}),
    )
    : null

/** What people said about it: the comment thread, with a line to say more,
 * wherever the host draws one (`Comments`); a host without one has no part. */
let Comments = ({ e, io }: { e: Bundle; io: Io }): JSX.Element | null =>
  io.can(e, 'Comments')
    ? h(
      ui.Section,
      { 'data-section': 'Comments' },
      h(ui.Section.Title, {}, 'Comments'),
      io.show(e, 'Comments', {}),
    )
    : null

/** A topic's page. */
export let TopicPage = ({ e, io, got }: Props): JSX.Element => {
  let eid = e.entity.eid
  let notes = usePageNotes(io, e, [
    'Contents',
    ...PARTS.map(([heading]) => heading),
    'Beliefs',
  ])
  let out = rows(got.out)
  let ids = [...new Set(out.map((b) => str(b, 'edge', 'to')).filter(Boolean))]
  let ends = io.ask(
    ids.length ? { ends: `.entity.eid=${ids.join(',')}&*` } : {},
  ).ends
  return h(
    'div',
    { 'data-inspect': eid },
    io.show(e, 'Inspect.Head', {
      sub: listed(io, 'in ', rows(got.within).toSorted(byTitle)),
      notes: notes.get(''),
    }),
    // Its cover's words, what belongs under it, as any page says what an
    // entity says; a topic with no cover has its contents said below alone.
    str(e, 'doc', 'body') ? io.show(e, 'Inspect.Body') : null,
    h(Ask, { e, io }),
    h(Contents, { e, io, notes }),
    ...PARTS.map(([heading, rels]) =>
      h(Relation, {
        key: heading,
        e,
        io,
        notes,
        heading,
        rels,
        edges: out.filter((b) => rels.some((r) => b[r])),
        ends,
      })
    ),
    h(Beliefs, { e, io, notes, got }),
    h(Comments, { e, io }),
    io.show(e, 'Inspect.Facts', { notes, skip: [TOPIC] }),
    io.show(e, 'Inspect.Links', { notes, skip: DRAWN }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

/** A topic in a list: its cover, the title and what belongs under it, so a
 * reader decides by it. */
export let TopicTile = ({ e, io }: Props): JSX.Element => {
  let cover = str(e, 'doc', 'body')
  return h(
    ui.Tile,
    { href: io.link(e.entity.eid), 'data-topic': e.entity.eid },
    h(ui.Tile.Kind, {}, 'topic'),
    h(ui.Tile.Title, { mod: 'wrap' }, title(e)),
    cover ? h(ui.Tile.Sub, { mod: 'wrap' }, cover) : null,
  )
}
