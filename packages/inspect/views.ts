/**
 * Every inspector view, as the `/views` facet contributes them: one registry
 * (@yaks/render `define`), selected per bundle by the most specific match. A
 * host draws them through `inspector()` (./door.ts).
 *
 * - `Inspect.Page`: an entity's page. A component's (./Comp.ts), a
 *   property's (./Prop.ts) and a package's (./Package.ts) are their own;
 *   anything else is its head, a table per component, its edges and its
 *   history (./Entity.ts).
 * - `Inspect.Detail`: an entity beside a page, picked from a row: its head,
 *   linked to its page, its components and its edges.
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
