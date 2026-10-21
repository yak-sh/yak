// The inspector's belief page is loaded only by the interface that draws
// it. A portable printer reads this facet without loading UI.
import type { View } from '@yaks/inspect'

/** How many turns either side of a cited one a belief's page shows. */
export let AROUND = { before: 3, after: 2 }

/**
 * What a belief states, without the words it quotes: its body up to the
 * first quote.
 *
 * ```ts
 * import { statement } from './views.ts'
 * statement('Tests never share a lock.\n\n> never share a lock\n(Jeff)')
 * // 'Tests never share a lock.'
 * ```
 */
export let statement = (body: string): string =>
  body.split(/\n\s*\n|\n>/)[0].trim()

/** The inspector's domain pages and parts. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.ts').then((m) => m.inspectViews)
