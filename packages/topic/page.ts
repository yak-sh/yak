/**
 * A topic's page, read the way a book is: its cover (`doc{title, body}`, the
 * title and a line or two saying what belongs under it), its contents
 * (`content.body`, what is understood about it), then what it holds
 * (`contains`), what to understand first (`requires`), what is related
 * (`reads`, `references`) and its sources (`cites`), and the beliefs about it
 * (`belief.about`); last, the parts any page has (`io.show`: the facts, the
 * links, the history).
 *
 * Whatever a topic holds or cites is drawn by its own renderer, asked for as
 * `Topic.List.Tile`: a subtopic as its cover (`TopicTile`), a belief as what
 * it states (@yaks/memory), anything else as it reads in any list.
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
  type Io,
  mention,
  Part,
  type Props,
  useNamed,
  usePageNotes,
} from '@yaks/inspect'
import { TOPIC } from './topic.ts'

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

/** What a topic is called: its cover's title, else its name. */
export let title = (e: Bundle): string =>
  str(e, 'doc', 'title') || str(e, TOPIC, 'name')

/** What a topic's page asks: its edges, what holds it, and the beliefs about
 * it where the graph keeps beliefs. */
export let asks = (e: Bundle, io: Io): Asks => {
  let eid = e.entity.eid
  return {
    out: `.edge.from=${eid}&*&.order=edge.ord&.limit=${EDGES}`,
    within: `.contains&.edge.to=${eid}&?edge&.limit=${EDGES}`,
    ...io.vocab.comp('belief')
      ? {
        beliefs: `.belief.about=${eid}&!archived&*` +
          `&.order=-created.at&.limit=${BELIEFS}`,
        archived: `.belief.about=${eid}&.archived&.count`,
      }
      : {},
  }
}

// Where it sits: the topics holding it, and the project it holds for.
let where = (io: Io, within: string[], scope: string): ComponentChildren[] => [
  within.length
    ? ['in ', ...within.flatMap((p, i) => [i ? ', ' : null, mention(io, p)])]
    : null,
  within.length ? ' · ' : null,
  scope ? ['holds for ', mention(io, scope)] : 'holds everywhere',
]

/** Its cover's words: what belongs under it. */
let Cover = ({ e, io }: { e: Bundle; io: Io }): JSX.Element | null => {
  let text = str(e, 'doc', 'body')
  return text && !edited(io, e.entity.eid)
    ? h(
      ui.Section,
      { 'data-cover': '' },
      h(ui.Body, {}, h(Markdown, { source: text })),
    )
    : null
}

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

/** One relation's far ends, each drawn by its own renderer, in edge order. */
let Held = (
  { e, io, notes, heading, rels, edges, ends }: Of & {
    heading: string
    rels: string[]
    edges: Bundle[]
    ends?: Answer
  },
): JSX.Element | null => {
  if (!edges.length) return null
  let held = new Map(rows(ends).map((b) => [b.entity.eid, b]))
  return h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: io.id(e),
      heading,
      count: edges.length,
      notes,
    },
    h(
      ui.Rows,
      {},
      edges.map((b) => {
        let to = str(b, 'edge', 'to')
        let end = held.get(to)
        return h(
          ui.Rows.Item,
          { key: b.entity.eid, 'data-held': to },
          rels.length > 1 ? h(ui.Rows.Kind, {}, rels.find((r) => b[r])) : null,
          end
            ? io.show(end, 'Topic.List.Tile', {})
            : ends?.ready
            ? [mention(io, to), ' is gone']
            : h(ui.Loading, {}),
        )
      }),
    ),
  )
}

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
  let within = rows(got.within).map((b) => str(b, 'edge', 'from'))
    .filter(Boolean)
  let scope = str(e, TOPIC, 'scope')
  useNamed(io, [...within, scope])
  return h(
    'div',
    { 'data-inspect': eid },
    io.show(e, 'Inspect.Head', {
      sub: where(io, within, scope),
      notes: notes.get(''),
    }),
    h(Cover, { e, io }),
    h(Contents, { e, io, notes }),
    ...PARTS.map(([heading, rels]) =>
      h(Held, {
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
