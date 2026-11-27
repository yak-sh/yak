// The providers a config names, by the names each serves under, and the
// provider rows an app's store stands up for them (`planting`). Naming one
// makes a model that calls nothing, so nothing here reads a connection or
// lends a transport: that is providers.ts, which loads where a call first
// asks.
import {
  type Config,
  given,
  holding,
  type Options,
  revealed,
  used,
} from '@yaks/host/config'
import type { Lent } from '@yaks/model'
import { serving } from './config.ts'
import { providerFacets } from './load.ts'
import type { Bundle, Comp } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { after } from '@yaks/fp'
import type { Stored } from './graph.ts'

/** The setting `name` in `env`, where the Worker holds one. */
export let setting = (env: object, name: string): string | undefined => {
  let value = (env as Record<string, unknown>)[name]
  return typeof value == 'string' && value ? value : undefined
}

// A Lent for asking a plugin which names it serves: making a model calls
// nothing it lends.
let idle: Lent = {
  fetch: () => Promise.reject(new Error('idle')),
  key: () => Promise.resolve(undefined),
  refresh: () => Promise.resolve(undefined),
  store: () => Promise.reject(new Error('idle')),
  env: () => undefined,
}

/** Each plugin `config` names, with its options read from `env` and the
 * provider names it serves. */
export let plugged = (env: object, config: Config) =>
  (config.plugins ?? []).map((plug) => {
    let options = revealed(given(plug), holding(env)) as Options
    let facet = providerFacets[used(plug)]
    return {
      plug,
      options,
      facet,
      names: Object.keys(facet?.providers?.(idle, options) ?? {}),
    }
  })

/** The provider names `config`'s plugins serve, in its order: the first is
 * the one a model no row names a provider for is asked of. */
export let names = (env: object, config: Config): string[] =>
  plugged(env, config).flatMap((p) => p.names)

// Only providers are installed. Model rows stay as history and are never retired
// because a newer release or a code list stopped naming them. A store that
// reads synchronously is answered synchronously, so a seed applied while a
// release is selected can stand them up first (graph.ts `#providing`).
export let planting = (
  read: Stored['graph']['read'],
  at: Pick<Stored, 'meta' | 'app' | 'env'>,
): Bundle[] | Promise<Bundle[]> => {
  if (at.meta || !at.app) return []
  return after(
    read('.provider&*'),
    (held) =>
      names(at.env, serving).flatMap((name): Bundle[] =>
        held.some((b) => (b.provider as Comp).name == name) ? [] : [{
          entity: { eid: identityEid('provider', [name]) },
          provider: { name, transport: 'http', offered: true },
        }]
      ),
  )
}
