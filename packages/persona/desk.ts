/**
 * The desk where what agents are given is written: every persona and every
 * skill, found by what is typed, and the one open lit. `Context.Page`, the
 * page the sidebar offers as Context, is the desk alone, each persona with the
 * project it works for and each skill with its description. `Context`, the tab
 * a persona or a skill opens on, sets it beside the desk, titles only, with
 * its Full page in the middle, where what it says and every document it
 * carries are typed into (./carried.ts), and, on the right, what an agent
 * gets: the conversation that tries it, where the host draws one
 * (`Conversation`), and the text it is given. Stacked, as on a phone, the one
 * open comes first and the desk last.
 *
 * A row of the desk drags its entity (@yaks/ux `drag`), so it can be dropped
 * on any list that takes one.
 *
 * What is typed to find one is the person's draft (the UX host's `drafts`), so
 * it stays as they go from one to the next, and in every interface they use.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import * as ui from '@yaks/ui'
import { drag, useHost } from '@yaks/ux'
import {
  type Answer,
  type Bundle,
  type Io,
  type Props,
  useNamed,
} from '@yaks/inspect'
import { PERSONA, SKILL } from './comp.ts'

/** How many personas, and how many skills, the desk lists. */
export let SHELF = 500

/** Where what is typed to find a persona or a skill is kept, as the
 * person's draft. */
export let FINDING = 'context:find'

type Comp = Record<string, unknown>
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = (b?.[name] as Comp | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** What a persona or a skill is called. */
export let title = (b: Bundle): string => str(b, 'doc', 'title')

let byTitle = (a: Bundle, b: Bundle) =>
  title(a).localeCompare(title(b), undefined, { sensitivity: 'base' })

/** Whether what was said finds a persona or a skill: each word of it is in
 * its title or its description, in any case. Nothing said finds everything. */
/// let skill = { entity: { eid: 's' }, doc: { title: 'ui-building', body: 'How to build interface' } }
/// fits('build ui', skill) -> true
/// fits('Interface', skill) -> true
/// fits('tests', skill) -> false
export let fits = (said: string, b: Bundle): boolean => {
  let words = `${title(b)} ${str(b, 'doc', 'body')}`.toLowerCase()
  return said.toLowerCase().split(/\s+/).every((w) => words.includes(w))
}

/** What the desk asks: each persona's title and the project it works for,
 * and each skill's name and description. */
let asking = (io: Io) => {
  let live = io.vocab.comp('archived') ? '&!archived' : ''
  return {
    personas: `.${PERSONA}${live}&.fields=doc.title,${PERSONA}.home` +
      `&.limit=${SHELF}`,
    ...io.vocab.comp(SKILL)
      ? {
        skills: `.${SKILL}${live}&.fields=doc.title,doc.body&.limit=${SHELF}`,
      }
      : {},
  }
}

type Shelved = {
  /** the answers, for whether they have come */
  got: Record<string, Answer>
  /** what was typed to find one */
  said: string
  /** the personas and the skills what was typed finds, each by title */
  personas: Bundle[]
  skills: Bundle[]
}

/** Every persona and skill, found by what was typed: a hook. */
let useDesk = (io: Io): Shelved => {
  let got = io.ask(asking(io))
  let said = useHost().drafts.text(FINDING).trim()
  let found = (a?: Answer) =>
    rows(a).filter((b) => fits(said, b)).toSorted(byTitle)
  return {
    got,
    said,
    personas: found(got.personas),
    skills: found(got.skills),
  }
}

/** The field a persona or a skill is found from: Enter opens the first it
 * finds, Escape clears it. */
let Find = ({ io, said, personas, skills }: Shelved & { io: Io }) => {
  let { drafts } = useHost()
  let box = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    let el = box.current
    if (el && el.value != said) el.value = said
  }, [said])
  let first = personas[0] ?? skills[0]
  return h(ui.Field, {
    elRef: box,
    type: 'search',
    name: 'find',
    'aria-label': 'find a persona or a skill',
    placeholder: 'find a persona or a skill…',
    onInput: (ev: Event) =>
      drafts.type(FINDING, (ev.currentTarget as HTMLInputElement).value),
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key == 'Enter' && first) {
        ev.preventDefault()
        drafts.spend(FINDING)
        io.go(io.link(first.entity.eid))
      } else if (ev.key == 'Escape' && said) {
        ev.preventDefault()
        drafts.spend(FINDING)
      }
    },
  })
}

type Drawn = { io: Io; lit?: string; covers?: boolean }

/** One persona or skill on the desk, linked to its page, lit when open, its
 * cover under it where covers show. Dragged, it drags itself. */
let Item = (
  { io, b, lit, covers }: Drawn & { b: Bundle },
): JSX.Element => {
  let eid = b.entity.eid
  let home = str(b, PERSONA, 'home')
  // A persona's body is what it says to an agent, too long for a cover; a
  // skill's is the description an agent decides by.
  let cover = !covers
    ? ''
    : b[PERSONA]
    ? home ? `for ${io.name(home)}` : 'for no project'
    : str(b, 'doc', 'body')
  return h(
    ui.Rows.Item,
    {
      role: 'listitem',
      'data-given': eid,
      onDragStart: (ev: DragEvent) => drag(ev, eid),
    },
    h(
      ui.Tile,
      {
        href: io.link(eid),
        mod: eid == lit ? 'on' : undefined,
        'aria-current': eid == lit ? 'page' : undefined,
      },
      h(ui.Tile.Title, { mod: covers ? 'wrap' : undefined }, title(b)),
      cover ? h(ui.Tile.Sub, { mod: 'wrap' }, cover) : null,
    ),
  )
}

/** One shelf of the desk, under its heading and count, or why it shows
 * nothing. */
let Shelf = (
  { io, heading, all, got, said, lit, covers }: Drawn & {
    heading: string
    all: Bundle[]
    got?: Answer
    said: string
  },
): JSX.Element | null =>
  !got && !all.length ? null : h(
    ui.Section,
    { 'data-shelf': heading },
    h(
      ui.Section.Title,
      {},
      heading,
      got?.ready ? h(ui.Section.Count, {}, String(all.length)) : null,
    ),
    got?.error
      ? h(ui.Rows.More, {}, got.error)
      : !got?.ready && !all.length
      ? h(ui.Loading, {})
      : !all.length
      ? h(
        ui.Rows.More,
        {},
        said ? `none fits “${said}”` : `no ${heading.toLowerCase()} yet`,
      )
      : h(
        ui.Rows,
        { role: 'list', mod: covers ? 'ruled' : undefined },
        all.map((b) => h(Item, { key: b.entity.eid, io, b, lit, covers })),
      ),
  )

/** The desk's two shelves: the personas, then the skills. */
let Shelves = (d: Shelved & Drawn): JSX.Element => {
  useNamed(d.io, d.covers ? d.personas.map((b) => str(b, PERSONA, 'home')) : [])
  return h(
    'div',
    { 'data-desk': '' },
    h(Shelf, {
      ...d,
      heading: 'Personas',
      all: d.personas,
      got: d.got.personas,
    }),
    h(Shelf, { ...d, heading: 'Skills', all: d.skills, got: d.got.skills }),
  )
}

/** The page the sidebar offers as Context: every persona with the project it
 * works for, every skill with its description, and the field that finds
 * one. */
export let DeskPage = ({ io }: Props): JSX.Element => {
  let d = useDesk(io)
  let ready = d.got.personas?.ready
  let n = (a: Bundle[], one: string) =>
    `${a.length} ${one}${a.length == 1 ? '' : 's'}`
  return h(
    'article',
    { 'data-context': '' },
    h(
      ui.Head,
      {},
      h(ui.Head.Title, {}, 'Context'),
      h(
        ui.Head.Sub,
        {},
        'What agents are given: every persona and skill, and what each contains and reads. Open one to arrange it, read what an agent is given, and try it.',
      ),
      ready
        ? h(
          ui.Head.Facts,
          {},
          n(d.personas, 'persona'),
          ...d.got.skills ? [n(d.skills, 'skill')] : [],
        )
        : null,
    ),
    h(ui.Section, {}, h(Find, { ...d, io })),
    h(Shelves, { ...d, io, covers: true }),
  )
}

/** A persona or a skill opened at the desk: the desk, its Full page without
 * the chat a page has beside it, and what an agent gets beside that: a
 * session to try it where the host draws a conversation, and the text it is
 * given. */
export let Workshop = ({ e, io }: Props): JSX.Element => {
  let d = useDesk(io)
  let eid = e.entity.eid
  return h(
    ui.Panes,
    { 'data-workshop': eid },
    h(
      ui.Panes.Pane,
      { mod: ['nav', 'aside'], 'aria-label': 'Context' },
      h(ui.Panes.Top, {}, h(Find, { ...d, io })),
      h(ui.Panes.Body, {}, h(Shelves, { ...d, io, lit: eid })),
    ),
    h(
      ui.Panes.Pane,
      { mod: 'main', 'aria-label': 'Full' },
      h(ui.Panes.Body, {}, io.show(e, 'Full', { chat: false })),
    ),
    h(
      ui.Panes.Pane,
      { mod: 'side', 'aria-label': 'What an agent gets' },
      h(
        ui.Panes.Body,
        {},
        io.can(e, 'Conversation')
          ? h(
            ui.Section,
            { 'data-section': 'Try it' },
            h(ui.Section.Title, {}, 'Try it'),
            io.show(e, 'Conversation', {}),
          )
          : null,
        h(
          ui.Section,
          { 'data-section': 'What an agent is given' },
          h(ui.Section.Title, {}, 'What an agent is given'),
          io.show(e, 'Markdown', {}),
        ),
      ),
    ),
  )
}
