/**
 * The inspector's own page (@yaks/ui `Panes`): on the left the index
 * (./Index.ts) under the field that narrows it, always there; beside it the
 * pages gone to, stacked (@yaks/ux `Stack`), each a component's, a
 * property's, a package's, any entity's, a query's or the first page. The
 * top one is drawn; each under it is a strip saying what it is, and a press
 * on one returns to it. The stack is the page's own graph's (./state.ts
 * `STACK`): a link or a row followed stacks on it (`go` on the host), and a
 * browser says it in the address (./main.ts).
 *
 * What scrolls, and how the field takes what is typed, are the host's
 * (`Chrome`): a browser's panes scroll under the pointer, a terminal's under
 * its keys. What is typed in the field is read through the host's fields
 * (@yaks/filter `text`), where the person's draft is kept.
 *
 * @module
 */

import {
  type ComponentChildren,
  Fragment,
  type FunctionComponent,
  h,
} from 'preact'
import type { Filters } from '@yaks/filter'
import { Panes, Rows, Stack as Look } from '@yaks/ui'
import { panesOf, Stack } from '@yaks/ux'
import type { Inspector } from './door.ts'
import { HomePage } from './Home.ts'
import { Index } from './Index.ts'
import { QueryPage } from './Query.ts'
import { INSPECT, me, stack } from './state.ts'
import { at, entityLine, HOME } from './where.ts'

/** What a browser or a terminal gives the page around the views. */
export type Chrome = {
  /** the index's query field (@yaks/filter), on the entity `inspect` */
  Bar: FunctionComponent<{ id: string }>
  /** the query fields the bar is one of: what is typed in it, read
   * reactively */
  fields: Pick<Filters, 'text'>
  /** a pane's body, scrolling on its own; `on` while its pane has the keys */
  Scroll: FunctionComponent<
    { id: string; on: boolean; children?: ComponentChildren }
  >
}

/** The page every inspector address draws, over an inspector's door. */
export let frame = (
  { Door, io }: Inspector,
  { Bar, fields, Scroll }: Chrome,
): FunctionComponent => {
  // An entity, by any id the graph resolves, and the answer that brings it.
  let useShown = (id: string) => {
    let { it } = io.ask({ it: entityLine(id) })
    return { e: it.rows[0], it }
  }
  let Shown = ({ id }: { id: string }) => {
    let { e, it } = useShown(id)
    return e ? h(Door, { e, view: 'Inspect.Page' }) : h(
      Rows.More,
      {},
      it.error ?? (it.ready ? `${id} names nothing.` : '…'),
    )
  }
  let keys = () => me(io).pane ?? 'page'

  // The page a pane shows, on top of the stack.
  let Page = ({ pane }: { pane: string }) => {
    let where = at(pane)
    return h(
      Scroll,
      { id: `inspect page ${pane}`, on: keys() == 'page' },
      'id' in where
        ? h(Shown, { id: where.id })
        : where.query
        ? h(QueryPage, { io, text: where.query })
        : h(HomePage, { io }),
    )
  }

  // What a pane under the top one is: an entity's name and kind, a query's
  // line, or the first page.
  let Named = ({ id }: { id: string }) => {
    let { e } = useShown(id)
    return h(
      Fragment,
      null,
      h(Look.Name, {}, e ? io.name(e.entity.eid) : id),
      e ? h(Look.Kind, {}, io.kind(e)) : null,
    )
  }
  let Strip = ({ pane }: { pane: string }) => {
    let where = at(pane)
    return 'id' in where ? h(Named, { id: where.id }) : where.query
      ? h(
        Fragment,
        null,
        h(Look.Name, {}, where.query),
        h(Look.Kind, {}, 'query'),
      )
      : h(Look.Name, {}, 'inspect')
  }

  return () => {
    let e = stack(io)
    let top = at(panesOf(e).at(-1) ?? HOME)
    return h(
      Panes,
      {},
      h(
        Panes.Pane,
        { mod: ['nav', keys() == 'index' && 'on'], 'data-pane': 'index' },
        h(Panes.Top, {}, h(Bar, { id: INSPECT })),
        h(
          Scroll,
          { id: 'inspect index', on: keys() == 'index' },
          h(Index, {
            io,
            here: 'id' in top ? top.id : undefined,
            text: fields.text(INSPECT),
          }),
        ),
      ),
      h(Stack, {
        e,
        on: keys() == 'page',
        onChange: (b) => io.set([b]),
        Pane: Page,
        Strip,
      }),
    )
  }
}
