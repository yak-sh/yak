/**
 * The sections of an archetype's page (@yaks/archetype): the components it is
 * made of, and some of the entities made of exactly those.
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import { Rows } from '@yaks/ui'
import type { Asks, Bundle, Props, View } from './host.ts'
import { section } from './page.ts'
import { str, tables } from './read.ts'
import { listed, rows, waiting } from './rows.ts'
import { chips } from './Tile.ts'

/** How many members an archetype's page lists. */
export let MEMBERS = 20

let members = (e: Bundle) => `.entity.archetype=${e.entity.eid}`

let made = section({
  view: 'Inspect.Tables',
  match: parse('.archetype'),
  title: 'Made of',
  asks: (e): Asks =>
    tables(e).length
      ? { comps: `._comp&._comp.name=${tables(e).join(',')}` }
      : {},
  count: ({ e }) => tables(e).length,
  Body: ({ e, io, got }: Props) => {
    let by = new Map(
      rows(got.comps).map((b) => [str(b, '_comp', 'name'), b.entity.eid]),
    )
    return h(
      Rows.Item,
      {},
      chips(tables(e), (t) => {
        let eid = by.get(t)
        return eid && io.link(eid)
      }),
    )
  },
})

let entities = section({
  view: 'Inspect.Members',
  match: parse('.archetype'),
  title: 'Entities',
  asks: (e) => ({
    rows: `${members(e)}&.limit=${MEMBERS}`,
    total: `${members(e)}&.count`,
  }),
  count: ({ got }) => got.total?.count,
  Body: ({ e, io, got }: Props) =>
    waiting(got.rows) ??
      listed(
        io,
        rows(got.rows).map((b) => io.show(b, 'Inspect.Tile')),
        got.total?.count,
        members(e),
      ),
})

/** An archetype's sections. */
export let archetypeViews: View[] = [made, entities]
