/**
 * The inspector's own page, in three panes (@yaks/ui `Panes`): on the left
 * the index (./Index.ts) under the field that narrows it; in the middle the
 * page for what the address names (a component, a property, a package, any
 * entity, a query, or the first page); and beside it the entity last picked
 * from a row (`inspector.detail`, ./state.ts), with a link to its own page.
 *
 * What scrolls, and how the field takes what is typed, are the host's
 * (`Chrome`): a browser's panes scroll under the pointer, a terminal's under
 * its keys, and a terminal too narrow for three leaves the detail out.
 *
 * @module
 */

import { type ComponentChildren, type FunctionComponent, h } from 'preact'
import { Panes, Rows } from '@yaks/ui'
import type { Inspector } from './door.ts'
import { HomePage } from './Home.ts'
import { Index } from './Index.ts'
import { QueryPage } from './Query.ts'
import { INSPECT, me } from './state.ts'
import { type At, entityLine } from './where.ts'

/** What a browser or a terminal gives the page around the views. */
export type Chrome = {
  /** the index's query field (@yaks/filter), on the entity `inspect` */
  Bar: FunctionComponent<{ id: string }>
  /** a pane's body, scrolling on its own; `on` while its pane has the keys */
  Scroll: FunctionComponent<
    { id: string; on: boolean; children?: ComponentChildren }
  >
  /** whether there is room for the detail beside the page (default: yes) */
  aside?: () => boolean
}

/** The page every inspector address draws, over an inspector's door. */
export let frame = (
  { Door, io }: Inspector,
  { Bar, Scroll, aside = () => true }: Chrome,
): FunctionComponent<{ where: At }> => {
  // An entity, by any id the graph resolves, drawn as `view`.
  let Shown = ({ id, view }: { id: string; view: string }) => {
    let { it } = io.ask({ it: entityLine(id) })
    let [e] = it.rows
    return e ? h(Door, { e, view }) : h(
      Rows.More,
      {},
      it.error ?? (it.ready ? `${id} names nothing.` : '…'),
    )
  }
  return ({ where }) => {
    let s = me(io)
    let pane = s.pane ?? 'page'
    let id = 'id' in where ? where.id : undefined
    let query = 'query' in where ? where.query : undefined
    return h(
      Panes,
      {},
      h(
        Panes.Pane,
        { mod: ['nav', pane == 'index' && 'on'], 'data-pane': 'index' },
        h(Panes.Top, {}, h(Bar, { id: INSPECT })),
        h(
          Scroll,
          { id: 'inspect index', on: pane == 'index' },
          h(Index, { io, here: id }),
        ),
      ),
      h(
        Panes.Pane,
        { mod: ['main', pane == 'page' && 'on'], 'data-pane': 'page' },
        h(
          Scroll,
          { id: `inspect page ${id ?? query ?? ''}`, on: pane == 'page' },
          id
            ? h(Shown, { key: id, id, view: 'Inspect.Page' })
            : query
            ? h(QueryPage, { key: query, io, text: query })
            : h(HomePage, { io }),
        ),
      ),
      aside()
        ? h(
          Panes.Pane,
          { mod: ['aside', pane == 'detail' && 'on'], 'data-pane': 'detail' },
          h(
            Scroll,
            { id: `inspect detail ${s.detail ?? ''}`, on: pane == 'detail' },
            s.detail
              ? h(Shown, {
                key: s.detail,
                id: s.detail,
                view: 'Inspect.Detail',
              })
              : h(Rows.More, {}, 'Press a row to see it here.'),
          ),
        )
        : null,
    )
  }
}
