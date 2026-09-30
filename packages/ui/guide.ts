/**
 * The style guide: every part of the kit in every variant, built of the kit's
 * own parts, so a browser and a terminal show the same guide: `/ui`
 * (./routes.ts) and `yak ui` (./tui.ts). It is a `Catalog` of the kit's
 * groups (kit.ts), each part an entry saying what it is over a `Gallery` of
 * its variants, and `Contents`, an `Index` of the same groups to jump
 * around it by.
 *
 * Its places are `stops`: the whole guide, then each group and the parts in
 * it. Each is also the id of its section, so `#Dot` is Dot's, and `Page`
 * shows any one of them alone.
 *
 * @module
 */

import { h, type VNode } from 'preact'
import { Catalog } from './Catalog.ts'
import type { Props } from './el.ts'
import { Gallery } from './Gallery.ts'
import { Head } from './Head.ts'
import { Index } from './Index.ts'
import { groups, kit } from './kit.ts'

/** The guide's name, and the stop that is all of it. */
export let title = '@yaks/ui'

/** Every place in the guide, in order: all of it, then each group and its
 * parts. */
export let stops: string[] = [
  title,
  ...Object.entries(groups).flatMap(([g, parts]) => [g, ...Object.keys(parts)]),
]

let { Figure, Caption, Stage } = Gallery

/** One part's entry: its name, what it is, and each variant on a stage of
 * its own under its label. */
export let Specimens = ({ name }: { name: string }): VNode =>
  h(
    Catalog.Entry,
    { id: name },
    h(Catalog.Title, {}, name),
    h(Catalog.Sub, {}, kit[name].description),
    h(
      Gallery,
      {},
      kit[name].specimens().map(([label, node]) =>
        h(Figure, { key: label }, h(Caption, {}, label), h(Stage, {}, node))
      ),
    ),
  )

// One group's section: its heading, then each of its parts.
let Group = ({ name }: { name: string }) =>
  h(
    Catalog.Group,
    { id: name },
    h(Catalog.Heading, {}, name),
    Object.keys(groups[name]).map((part) =>
      h(Specimens, { key: part, name: part })
    ),
  )

/** The whole guide: its head, then every group. */
export let Guide = (): VNode =>
  h(
    Catalog,
    { id: title },
    h(
      Head,
      {},
      h(Head.Title, {}, title),
      h(
        Head.Sub,
        {},
        'Every part in every variant. Each is a Preact component, its CSS ' +
          'and its terminal sheet, so the same tree paints in a browser and ' +
          'in a terminal.',
      ),
    ),
    Object.keys(groups).map((g) => h(Group, { key: g, name: g })),
  )

/** One stop alone: the whole guide, a group, or a part. */
export let Page = ({ stop }: { stop: string }): VNode =>
  stop == title ? h(Guide, {}) : h(
    Catalog,
    {},
    groups[stop] ? h(Group, { name: stop }) : h(Specimens, { name: stop }),
  )

/** An index of every stop, grouped as the guide is; `entry` dresses each
 * one's link (where it goes, whether the walk is on it, what a press does). */
export let Contents = (
  { entry }: { entry: (stop: string) => Props },
): VNode =>
  h(
    Index,
    {},
    h(Index.Group, {}, h(Index.Head, entry(title), title)),
    Object.entries(groups).map(([g, parts]) =>
      h(
        Index.Group,
        { key: g },
        h(Index.Head, entry(g), g),
        Object.keys(parts).map((p) =>
          h(Index.Item, { key: p, ...entry(p) }, p)
        ),
      )
    ),
  )
