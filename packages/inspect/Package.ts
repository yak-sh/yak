/**
 * The sections of a package's page (`_package`, @yaks/vocab): what it is,
 * the components it declares, and the properties it adds to components other
 * packages declare (`extends`).
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import type { Bundle, Props, View } from './host.ts'
import { section } from './page.ts'
import { str } from './read.ts'
import { listed, rows, waiting } from './rows.ts'

let declared = (e: Bundle) =>
  `._comp&._comp.package=${e.entity.eid}&.order=_comp.name`
let props = (e: Bundle) =>
  `._prop&._prop.package=${e.entity.eid}&.order=_prop.comp`

let about = section({
  view: 'Inspect.About',
  match: parse('._package'),
  title: 'About',
  shows: (e) => !!str(e, 'doc', 'body'),
  Body: ({ e }: Props) => h('p', {}, str(e, 'doc', 'body')),
})

let declares = section({
  view: 'Inspect.Declares',
  match: parse('._package'),
  title: 'Declares',
  asks: (e) => ({ comps: declared(e) }),
  count: ({ got }) => got.comps?.ready ? rows(got.comps).length : undefined,
  Body: ({ io, got }: Props) =>
    waiting(got.comps) ??
      listed(io, rows(got.comps).map((b) => io.show(b, 'Inspect.Tile'))),
})

// The properties it declares on a component it does not.
let foreign = (got: Props['got']) => {
  let own = new Set(rows(got.comps).map((b) => b.entity.eid))
  return rows(got.props).filter((b) => !own.has(str(b, '_prop', 'comp')))
}

let extend = section({
  view: 'Inspect.Extends',
  match: parse('._package'),
  title: 'Extends',
  asks: (e) => ({ comps: declared(e), props: props(e) }),
  count: ({ got }) =>
    got.props?.ready && got.comps?.ready ? foreign(got).length : undefined,
  Body: ({ io, got }: Props) =>
    waiting(got.props) ??
      listed(io, foreign(got).map((b) => io.show(b, 'Inspect.Tile'))),
})

/** A package's sections. */
export let packageViews: View[] = [about, declares, extend]
