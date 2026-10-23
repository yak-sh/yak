/**
 * The catalogue: the shelves of topics (./shelves.ts) to find and walk them,
 * and a topic opened beside them. `Topics.Page`, the page the sidebar offers
 * as Topics, is the shelves alone, each topic with its cover. `Topic`, the tab
 * a topic opens on, sets its page (./page.ts) beside the shelves, titles only,
 * the topic open lit and the shelves holding it open; stacked, as on a phone,
 * the page comes first.
 *
 * Over the shelves a field finds a topic by what is typed (`fits`: "data
 * modeling" finds data model), narrowing them to the topics it fits, under the
 * topics holding them; Enter opens the first and clears it, Escape clears it.
 * What is typed there is the person's draft (the UX host's `drafts`,
 * @yaks/ux), so it stays as they go from topic to topic among what it found,
 * and in every interface they use.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import * as ui from '@yaks/ui'
import { useHost } from '@yaks/ux'
import type { Answer, Bundle, Io, Props } from '@yaks/inspect'
import { every, holds, type Shelf, shelves, within } from './shelves.ts'
import { about, cover, fits, title, TOPIC, TOPICS } from './topic.ts'
import { TopicPage } from './page.ts'

/** Where what is typed to find a topic is kept, as the person's draft. */
export let FINDING = 'topics:find'

let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** What the shelves ask: every live topic with its cover, and every
 * `contains` edge from one topic to another. */
let asking = (io: Io) => ({
  topics: `.${TOPIC}&?doc` +
    `${io.vocab.comp('archived') ? '&!archived' : ''}&.limit=${TOPICS}`,
  ...io.vocab.comp('contains')
    ? {
      edges: `.contains&.edge.from.${TOPIC}.name&.edge.to.${TOPIC}.name` +
        `&?edge&.limit=${TOPICS}`,
    }
    : {},
})

type Shelved = {
  /** the topics' answer, for whether it has come */
  got: Answer | undefined
  /** what was typed to find one */
  said: string
  /** every topic, shelved */
  all: Shelf[]
  /** the shelves what was typed narrows them to */
  shown: Shelf[]
  /** the topics what was typed fits, as they are drawn */
  hits: Bundle[]
}

/** Every topic, shelved and narrowed to what was typed to find one: a hook. */
let useShelves = (io: Io): Shelved => {
  let got = io.ask(asking(io))
  let said = useHost().drafts.text(FINDING)
  let all = shelves(rows(got.topics), rows(got.edges))
  let shown = within(all, said)
  let hits = said ? every(shown).filter((t) => fits(said, about(t))) : []
  return { got: got.topics, said, all, shown, hits }
}

/** The field a topic is found from. */
let Find = ({ io, said, hits }: Shelved & { io: Io }): JSX.Element => {
  let { drafts } = useHost()
  let box = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    let el = box.current
    if (el && el.value != said) el.value = said
  }, [said])
  return h(ui.Field, {
    elRef: box,
    type: 'search',
    name: 'find',
    'aria-label': 'find a topic',
    placeholder: 'find a topic…',
    onInput: (ev: Event) =>
      drafts.type(FINDING, (ev.currentTarget as HTMLInputElement).value),
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key == 'Enter' && hits[0]) {
        ev.preventDefault()
        drafts.spend(FINDING)
        io.go(io.link(hits[0].entity.eid))
      } else if (ev.key == 'Escape' && said) {
        ev.preventDefault()
        drafts.spend(FINDING)
      }
    },
  })
}

type Drawn = { io: Io; said: string; lit?: string; covers?: boolean }

/** A topic on its shelf, and the shelves under it where they are open: under
 * the topic open, on the way to it, wherever something was typed, and
 * everywhere the covers show. A closed one counts what it holds. */
let Twig = (
  { io, shelf, said, lit, covers }: Drawn & { shelf: Shelf },
): JSX.Element => {
  let t = shelf.topic
  let eid = t.entity.eid
  let under = shelf.under.length
  let open = !!(covers || said || eid == lit || (lit && holds(shelf, lit)))
  let words = covers ? cover(t) : ''
  return h(
    ui.Rows.Item,
    { role: 'listitem', 'data-shelf': eid },
    h(
      ui.Tile,
      {
        href: io.link(eid),
        mod: eid == lit ? 'on' : undefined,
        'aria-current': eid == lit ? 'page' : undefined,
      },
      h(ui.Tile.Title, { mod: covers ? 'wrap' : undefined }, title(t)),
      under && !open ? h(ui.Tile.Count, {}, String(under)) : null,
      words ? h(ui.Tile.Sub, { mod: 'wrap' }, words) : null,
    ),
    under && open
      ? h(
        ui.Rows,
        { mod: 'nested', role: 'list' },
        shelf.under.map((s) =>
          h(Twig, {
            key: s.topic.entity.eid,
            io,
            shelf: s,
            said,
            lit,
            covers,
          })
        ),
      )
      : null,
  )
}

/** The shelves, or why there are none to show. */
let List = (
  { io, got, said, shown, lit, covers }: Shelved & Drawn,
): JSX.Element =>
  got?.error
    ? h(ui.Rows.More, {}, got.error)
    : !got?.ready && !shown.length
    ? h(ui.Loading, {})
    : !shown.length
    ? h(
      ui.Rows.More,
      {},
      said ? `no topic fits “${said}”` : 'there are no topics yet',
    )
    : h(
      ui.Rows,
      { role: 'list', mod: covers ? 'ruled' : undefined, 'data-shelves': '' },
      shown.map((s) =>
        h(Twig, { key: s.topic.entity.eid, io, shelf: s, said, lit, covers })
      ),
    )

/** The page the sidebar offers as Topics: every topic with its cover, under
 * the topics holding it, and the field that finds one. */
export let TopicsPage = ({ io }: Props): JSX.Element => {
  let s = useShelves(io)
  let n = rows(s.got).length
  return h(
    'article',
    { 'data-topics': '' },
    h(
      ui.Head,
      {},
      h(ui.Head.Title, {}, 'The knowledge graph, by topic'),
      h(
        ui.Head.Sub,
        {},
        'Each topic’s cover, and under it the topics it holds. Open one to read what is known about it, what it holds and where that came from, and to comment on it.',
      ),
      s.got?.ready
        ? h(
          ui.Head.Facts,
          {},
          `${n} ${n == 1 ? 'topic' : 'topics'}`,
          ...s.said ? [`${s.hits.length} fit “${s.said}”`] : [],
        )
        : null,
    ),
    h(ui.Section, {}, h(Find, { ...s, io })),
    h(List, { ...s, io, covers: true }),
  )
}

/** A topic's page beside the shelves: the tab a topic opens on. */
export let ShelvedPage = (p: Props): JSX.Element => {
  let s = useShelves(p.io)
  return h(
    ui.Panes,
    { 'data-catalogue': p.e.entity.eid },
    h(
      ui.Panes.Pane,
      { mod: ['nav', 'aside'], 'aria-label': 'Topics' },
      h(ui.Panes.Top, {}, h(Find, { ...s, io: p.io })),
      h(
        ui.Panes.Body,
        {},
        h(List, { ...s, io: p.io, lit: p.e.entity.eid }),
      ),
    ),
    h(
      ui.Panes.Pane,
      { mod: 'main' },
      h(ui.Panes.Body, {}, h(TopicPage, p)),
    ),
  )
}
