/**
 * Every inspector view, as the `/views` facet contributes them: one registry
 * (@yaks/render `define`), selected per bundle by the most specific match. A
 * host draws them through `inspector()` (./door.ts), with the views the
 * config's other plugins contribute ahead of these (`composed`,
 * ./plugins.ts): a package's page for its own kind wins over the page any
 * entity has.
 *
 * - `Inspect.Page`: an entity's page. A component's (./Comp.ts), a
 *   property's (./Prop.ts) and a package's (./Package.ts) are their own;
 *   anything else is the parts any page has (./Entity.ts).
 * - `Inspect.Head`, `Inspect.Body`, `Inspect.Facts`, `Inspect.Links`,
 *   `Inspect.History`: those parts, each a view, so a package's page draws
 *   the ones it has no better way to say (`io.show`).
 *
 * The first page and a query's page draw no entity, so they are the frame's
 * (./Frame.ts), not views.
 *
 * @module
 */

import { define, type Registry } from '@yaks/render'
import type { View } from './host.ts'
import { compViews } from './Comp.ts'
import { entityViews } from './Entity.ts'
import { packageViews } from './Package.ts'
import { propViews } from './Prop.ts'

/** Every inspector view. */
export let all: View[] = [
  ...compViews,
  ...propViews,
  ...packageViews,
  ...entityViews,
]

/** The inspector's views, as a registry. */
export let views: Registry<View> = define(all)

/** The inspector's views with `more` ahead of them, as a registry of its
 * own. */
export let composed = (more: View[]): Registry<View> =>
  more.length ? define([...more, ...all]) : views
