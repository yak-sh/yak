// The providers a harness asks: those of every plugin its config names that
// exports `./provider` (@yaks/model `ProviderFacet`), lent what only this
// machine has. The harness names no provider, so a config serves exactly the
// ones it lists.

import { given, subpaths, used } from '@yaks/cli/config'
import { artifactStore } from '@yaks/blob/identify'
import type { SignIns } from '@yaks/connections'
import type { Plug } from '@yaks/host'
import type { Lent, Model, ProviderFacet } from '@yaks/model'
import type { Harness } from './store.ts'

/** What this machine lends its providers: `fetch`, the configured person's
 * sign-ins, the graph's artifact store and `env`. */
export let lending = (
  h: Pick<Harness, 'person' | 'artifacts'>,
  signin: Pick<SignIns, 'key' | 'refresh'>,
  fetch: typeof globalThis.fetch,
  env: (name: string) => string | undefined,
): Lent => ({
  fetch,
  key: async (integration) =>
    h.person ? await signin.key(h.person, integration) : undefined,
  refresh: async (integration, stale) =>
    h.person ? await signin.refresh(h.person, integration, stale) : undefined,
  store: artifactStore(h.artifacts),
  env,
})

/** Every configured provider, keyed by `provider.name`. Two plugins serving
 * one name are refused: which of them answers would be an accident of order. */
export let configured = async (
  plugins: readonly Plug[] = [],
  lent: Lent,
): Promise<Record<string, Model>> => {
  let facets = await subpaths(
    plugins.map((plug) => [used(plug), 'provider'] as const),
  ) as (ProviderFacet | null)[]
  let served: Record<string, Model> = {}
  let by: Record<string, string> = {}
  facets.forEach((facet, i) => {
    let plugin = used(plugins[i])
    let models = facet?.providers?.(lent, given(plugins[i])) ?? {}
    for (let [name, model] of Object.entries(models)) {
      if (by[name]) {
        throw new Error(`${by[name]} and ${plugin} both serve ${name}`)
      }
      by[name] = plugin
      served[name] = model
    }
  })
  return served
}
