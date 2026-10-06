// One incarnation's authoritative wake catalog. Conditions are never cached:
// rouse still checks their current peer/durable truth on every invocation.
import { type Bundle, comps, dead } from '@yaks/graph'
import { rouse } from '@yaks/wake'
import type { Driver } from '@yaks/wake'

export let conditionalWakes = (graph: Driver) => {
  let catalog: Promise<Bundle[]> | undefined
  return async (bundles: Bundle[], now: number) => {
    if (
      bundles.some((b) => dead(b) || comps(b).some(([name]) => name == 'wake'))
    ) catalog = undefined
    if (!catalog) {
      let loading = Promise.resolve(
        graph.read('.wake.while', { now, durable: true }),
      )
        .then((rows) => structuredClone(rows))
      catalog = loading
      loading.catch(() => {
        if (catalog === loading) catalog = undefined
      })
    }
    return rouse(graph, now, await catalog)
  }
}
