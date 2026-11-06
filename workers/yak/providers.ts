// The model providers yaks.app's config names (config.ts `providing`), each a
// `./provider` facet (@yaks/model `ProviderFacet`) that gen.ts brings into
// load.ts, lent what the platform has: its model transport and its settings.
// Their options name the env they are read from as they are accessed, as the
// mail and phone providers' do (`{"secret": NAME}`, `{"binding": NAME}`), so
// a key such as `ANTHROPIC_API_KEY` is read at each call and never handed to
// an app. A layer asks for a model by the provider name it serves under and
// imports none.
import { configured, holding, used } from '@yaks/host/config'
import { type Lent, type Model, ModelError } from '@yaks/model'
import { providing } from './config.ts'
import type { VocabDoc } from '@yaks/vocab'
import { providerFacets, vocabFacets } from './load.ts'
import type { Env } from './env.ts'

let setting = (env: Env, name: string): string | undefined => {
  let value = (env as Record<string, unknown>)[name]
  return typeof value == 'string' && value ? value : undefined
}

/** The words the configured providers record a reply with (their
 * `./vocab`), for a store that keeps their replies. */
export let providerDocs: VocabDoc[] = (providing.plugins ?? []).flatMap(
  (plug) => vocabFacets[used(plug)]?.docs ?? [],
)

/** What the platform lends a provider for its own agents (the Operator, the
 * builder): the transport it holds as it lends and its settings. Nobody is
 * signed in, and it keeps no generated media for them. */
export let platform = (env: Env): Lent => {
  let send = env.MODEL_FETCH ?? ((input, init) => fetch(input, init))
  return {
    fetch: send,
    key: () => Promise.resolve(undefined),
    refresh: () => Promise.resolve(undefined),
    store: () =>
      Promise.reject(
        new ModelError('media_storage', 'The platform keeps no media here'),
      ),
    env: (name) => setting(env, name),
  }
}

/** Which provider serves a model name: Workers AI's are `@cf/…`,
 * Anthropic's `claude-…`, and any other is OpenAI's. */
export let providerOf = (name: string): string =>
  name.startsWith('@cf/')
    ? 'workers-ai'
    : name.startsWith('claude-')
    ? 'anthropic'
    : 'openai'

/** Every configured provider's models, by the name each serves under. Two
 * plugins serving one name are refused: which answered would be an accident
 * of order. */
export let served = (env: object, lent: Lent): Record<string, Model> => {
  let models: Record<string, Model> = {}
  for (let [plugin, options] of configured(providing, holding(env))) {
    let offered = providerFacets[plugin]?.providers?.(lent, options)
    for (let [name, model] of Object.entries(offered ?? {})) {
      if (models[name]) throw new Error(`two providers serve ${name}`)
      models[name] = model
    }
  }
  return models
}

/** The model `provider` serves on the platform's own lending, or, where no
 * configured plugin serves it, one that refuses every call. */
export let provided = (env: Env, provider: string): Model =>
  served(env, platform(env))[provider] ??
    Object.assign(
      () =>
        Promise.reject(
          new ModelError('provider', `yaks.app serves no ${provider} models`),
        ),
      { info: () => Promise.resolve(undefined) },
    )
