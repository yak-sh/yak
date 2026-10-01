/**
 * The inspector views a config's plugins contribute. A package draws its own
 * kind the way it means to be read (a belief with the words it was built
 * from, a transcript entry inside its conversation) by exporting
 * `inspectViews` from its `/views` facet, beside the portable `views` every
 * interface prints with: registrations of a view the inspector draws
 * (`Inspect.Page`, or a part of one, `Inspect.Turn`), which the inspector puts
 * ahead of its own, so the most specific match wins (./views.ts `composed`).
 *
 * Read in the process that serves the page or holds the terminal, never in a
 * browser: a page is bundled with the modules this names imported beside it
 * (./routes.ts).
 *
 * @module
 */

import { located, type Plug, subpath, used } from '@yaks/cli/config'
import type { View } from './host.ts'
import type { AnatomyObserver } from '@yaks/code/anatomy'

/** One plugin's contribution: where its views are, and the ones it gives
 * the inspector. */
export type Contribution = { spec: string; views: View[] }

/** The plugins among `plugins` whose `/views` facet exports inspector views,
 * each with those views, in the order the config names them. */
export let contributed = async (plugins: Plug[], observe?: AnatomyObserver): Promise<Contribution[]> => {
  let others = plugins.map(used).filter((p) => p != '@yaks/inspect')
  let found = await Promise.all(others.map(async (plugin) => {
    let m = await subpath<{ inspectViews?: View[] }>(plugin, 'views')
    observe?.({ package: plugin, facet: 'views', loaded: m !== null, bound: true, value: m })
    let views = m?.inspectViews ?? []
    return views.length ? [{ spec: located(`${plugin}/views`), views }] : []
  }))
  return found.flat()
}
