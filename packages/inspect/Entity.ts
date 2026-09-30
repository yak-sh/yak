/**
 * Any entity's page, read the way a person reads a page: what it is called,
 * and where it came from (./Head.ts); what it says, in full (`Inspect.Body`);
 * what else it states (./Facts.ts); what it is linked to (./Links.ts); and
 * its history (./History.ts).
 *
 * Each part is a view of its own, registered here for anything
 * (`Inspect.Head`, `Inspect.Body`, `Inspect.Facts`, `Inspect.Links`,
 * `Inspect.History`), so a package's own page for its kind draws the parts it
 * has no better way to say through the same registry (`io.show`), and a
 * package can draw one part its own way for its kind: the most specific
 * match wins. What each part is drawn with besides the entity (the notes left
 * under its heading, what the page says elsewhere) is its context.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Markdown } from '@yaks/markdown'
import * as ui from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { factViews } from './Facts.ts'
import { headViews } from './Head.ts'
import { History } from './History.ts'
import { linkViews } from './Links.ts'
import { about, under, useNamed, useNotes } from './notes.ts'
import { bodyOf, comps, cut, str } from './read.ts'
import { edited } from './state.ts'

/** What a page's parts are drawn with: the notes under each heading. */
export type PageCtx = { notes?: Map<string, Bundle[]> }

/** What an entity says, in full: a doc's body, or a message's words, as
 * markdown. Edited, it is typed over in the facts, so it is not said twice. */
export let Body = ({ e, io }: Props): JSX.Element | null => {
  let text = bodyOf(e)
  return text && !edited(io, e.entity.eid)
    ? h(
      ui.Section,
      { 'data-body': '' },
      h(ui.Body, {}, h(Markdown, { source: text })),
    )
    : null
}

/** How much of a turn that is not the one a page is about reads before it is
 * cut. */
export let TURN = 320

/** What a turn is drawn with: whether it is the one the page is about, and
 * whether it is said whole (by default, the one it is about). */
export type TurnCtx = { on?: boolean; whole?: boolean }

/** An entity as one turn of a conversation (`Inspect.Turn`, a @yaks/ui
 * `Turns.Turn`): who wrote it, linked to the turn's own page, and what it
 * says, the one the page is about whole and lit, any other cut short; one
 * that says nothing says its kind. A package whose entities are turns says
 * better who speaks. */
export let Turn = ({ e, io, ctx }: Props): JSX.Element => {
  let { on, whole = on } = ctx as TurnCtx
  let said = bodyOf(e) || str(e, 'doc', 'title')
  let by = str(e, 'created', 'by')
  useNamed(io, [by])
  return h(
    ui.Turns.Turn,
    { mod: on ? 'on' : !said && 'quiet', 'data-turn': e.entity.eid },
    h(
      ui.Turns.Who,
      { href: on ? undefined : io.link(e.entity.eid) },
      by ? io.name(by) : io.kind(e),
    ),
    h(
      ui.Turns.Text,
      {},
      said
        ? h(Markdown, { source: whole ? said : cut(said, TURN) })
        : io.kind(e),
    ),
  )
}

/** Its history, as a part of a page. */
let Told = ({ e, io, ctx }: Props): JSX.Element =>
  h(History, { e, io, notes: (ctx as PageCtx).notes ?? new Map() })

/** The headings a page holds, for its notes: the components it carries, and
 * the parts it draws. */
export let headings = (e: Bundle, more: string[] = []): string[] => [
  ...comps(e).map(([n]) => n),
  'Links',
  'History',
  ...more,
]

/** The notes left on an entity, by the heading each was left under: a hook,
 * for a page. */
export let usePageNotes = (
  io: Io,
  e: Bundle,
  more: string[] = [],
): Map<string, Bundle[]> =>
  under(useNotes(io, e.entity.eid), about(io, e), headings(e, more))

/** Any entity's page. */
export let EntityPage = ({ e, io }: Props): JSX.Element => {
  let notes = usePageNotes(io, e)
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { notes: notes.get('') }),
    io.show(e, 'Inspect.Body'),
    io.show(e, 'Inspect.Facts', { notes }),
    io.show(e, 'Inspect.Links', { notes }),
    io.show(e, 'Inspect.History', { notes }),
  )
}

/** Any entity's page, and every part of it. */
export let entityViews: View[] = [
  ...headViews,
  { view: 'Inspect.Body', match: true, Render: Body },
  ...factViews,
  ...linkViews,
  { view: 'Inspect.History', match: true, Render: Told },
  { view: 'Inspect.Turn', match: true, Render: Turn },
  { view: 'Inspect.Page', match: true, Render: EntityPage },
]
