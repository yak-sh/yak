/**
 * Every inspector view, as the `/views` facet contributes them: one registry
 * (@yaks/render `define`), selected per bundle by the most specific match. A
 * host draws them through `inspector()` (./door.ts), and may put views of its
 * own before them (`Inspect.Markdown`, a lens only it can draw).
 *
 * - `Inspect.Full`: a page. The map for the map, else the page frame
 *   (./page.ts) around the kind's sections.
 * - `Inspect.Sections`: which sections a kind's page shows, in order.
 * - `Inspect.List`: a listing on the map (./List.ts).
 * - `Inspect.Tile`: one row standing for one thing (./Tile.ts).
 * - `Inspect.JSON`: the bundle as it arrived.
 * - each section, a view of its own: `Inspect.Fields`, `Inspect.Links`,
 *   `Inspect.History`, `Inspect.Feedback`, and the kinds' own.
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'
import { Value } from '@yaks/ui'
import type { View } from './host.ts'
import { archetypeViews } from './Archetype.ts'
import { compViews } from './Comp.ts'
import { feedbacks } from './Feedback.ts'
import { fields } from './Fields.ts'
import { histories, history, where, which, wrote } from './History.ts'
import { links } from './Links.ts'
import { lists } from './List.ts'
import { mapViews } from './Map.ts'
import { packageViews } from './Package.ts'
import { Full, sections } from './page.ts'
import { propViews } from './Prop.ts'
import { tiles } from './Tile.ts'

// What every entity's page ends with: its values, links, history and what
// was said about it.
let ENTITY = [
  'Inspect.Fields',
  'Inspect.Links',
  'Inspect.History',
  'Inspect.Feedback',
]

/** The sections each kind's page shows, in order. */
export let kinds: [string, string[]][] = [
  ['._comp', [
    'Inspect.About',
    'Inspect.Props',
    'Inspect.Refers',
    'Inspect.Archetypes',
    'Inspect.Carriers',
    'Inspect.Feedback',
    'Inspect.History',
    'Inspect.Fields',
  ]],
  ['._prop', [
    'Inspect.About',
    'Inspect.Values',
    'Inspect.Feedback',
    'Inspect.History',
    'Inspect.Fields',
  ]],
  ['._package', [
    'Inspect.About',
    'Inspect.Declares',
    'Inspect.Extends',
    'Inspect.Feedback',
    'Inspect.Fields',
  ]],
  ['.archetype', ['Inspect.Tables', 'Inspect.Members', 'Inspect.Fields']],
  ['._tx', ['Inspect.History', 'Inspect.Fields']],
]

// A transaction's history is what it wrote.
let wroteBy = history({
  view: 'Inspect.History',
  match: parse('._tx'),
  title: 'Changes',
  where: (e) => `tx=${e.entity.eid}`,
  what: (io, b) =>
    h('span', {}, which(io, b), ' ', where(io, b), ' ', wrote(b)),
})

let json: View = {
  view: 'Inspect.JSON',
  match: true,
  Render: ({ e }) => h(Value, { mod: 'json' }, JSON.stringify(e, null, 2)),
}

/** Every inspector view. */
export let all: View[] = [
  ...mapViews,
  { view: 'Inspect.Full', match: true, Render: Full },
  ...kinds.map(([kind, views]): View => ({
    view: 'Inspect.Sections',
    match: parse(kind),
    Render: sections(views),
  })),
  { view: 'Inspect.Sections', match: true, Render: sections(ENTITY) },
  ...lists,
  ...tiles,
  json,
  fields,
  links,
  feedbacks,
  wroteBy,
  ...histories,
  ...compViews,
  ...propViews,
  ...packageViews,
  ...archetypeViews,
]

/** The inspector's views, as a registry. */
export let views: Registry<View> = define(all)
