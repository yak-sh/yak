/** Browser-safe facet gathering, without loading any painter. */
import type { Contributions } from './theme.ts'

/** Gather installed facets. Duplicate contribution names are an error rather
 * than an order-dependent choice of someone else's kit. */
export let gather = (facets: Contributions[]): Contributions => {
  let out: Contributions = { kits: {}, ux: {}, themes: {}, skins: {} }
  for (let facet of facets) {
    for (let kind of ['kits', 'ux', 'themes', 'skins'] as const) {
      for (let [name, value] of Object.entries(facet[kind] ?? {})) {
        if (Object.hasOwn(out[kind]!, name)) {
          throw new Error(`duplicate UI ${kind}: ${name}`)
        }
        Object.assign(out[kind]!, { [name]: value })
      }
    }
  }
  return out
}

export type { Contributions } from './theme.ts'
