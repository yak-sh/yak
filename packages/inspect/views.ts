/**
 * Inspect registrations for vocabulary entities, entity readings, query rows
 * and the map. A host merges them into the same registry as its domain views.
 * @module
 */

import { define, type Registry } from '@yaks/render'
import type { View } from './host.ts'
import { and, parse } from '@yaks/query'
import { h } from 'preact'
import { Tile } from '@yaks/ui'
import { str } from './read.ts'
import { HomePage } from './Home.ts'
import { QueryPage } from './Query.ts'
import { Note } from './notes.ts'
import { compViews } from './Comp.ts'
import { entityViews } from './Entity.ts'
import { packageViews } from './Package.ts'
import { propViews } from './Prop.ts'

// Schema names belong to inspect; every consumer asks for this renderer,
// including the query table and any inline reference.
let schemaTiles: View[] = ['_package', '_comp', '_prop'].flatMap((name) => [
  {
    view: 'Tile',
    match: parse(`.${name}`),
    Render: ({ e, io }) =>
      h(
        Tile,
        { href: io.link(e.entity.eid) },
        h(Tile.Title, {}, str(e, name, 'name')),
        h(Tile.Kind, {}, name.slice(1)),
      ),
  },
  {
    view: 'Inline',
    match: parse(`.${name}`),
    Render: ({ e, io }) =>
      h('a', { href: io.link(e.entity.eid) }, str(e, name, 'name')),
  },
])

/** The pages for vocabulary entities. */
export let schemaPages: View[] = [...compViews, ...propViews, ...packageViews]

/** Every inspector view. */
export let all: View[] = [
  { view: 'Inspect.Note', match: parse('.comment'), Render: Note },
  ...schemaTiles,
  ...compViews,
  ...propViews,
  ...packageViews,
  ...entityViews,
  {
    view: 'Inspect.Reference.Inline',
    match: and(),
    Render: ({ e, io }) =>
      h('a', { href: io.link(e.entity.eid) }, io.name(e.entity.eid)),
  },
  {
    view: 'Inspect.Map',
    match: and(),
    Render: ({ io }) => h(HomePage, { io }),
  },
  {
    view: 'Inspect.Query',
    match: and(),
    Render: ({ io, ctx }) =>
      h(QueryPage, { io, text: String(ctx.query ?? '') }),
  },
]

/** The inspector's views, as a registry. */
export let views: Registry<View> = define(all)

/** The inspector's views with `more` ahead of them, as a registry of its
 * own. */
export let composed = (more: View[]): Registry<View> =>
  more.length ? define([...more, ...all]) : views

/** Query-backed facet contributions, adapted by the app’s host. */
export let inspectViews: View[] = all
