// @yaks/openrouter as a provider a config names (@yaks/model `ProviderFacet`):
// `openrouter`, on the key the person's OpenRouter sign-in keeps, with the
// media its models generate kept in the host's artifact store.

import {
  deferredModel,
  type Lent,
  type Model,
  prefixCacheMark,
} from '@yaks/model'
import { openrouterDoc } from './vocab.ts'

/** `openrouter`, over the host's connections and the person's key. */
export let providers = (lent: Lent): Record<string, Model> => ({
  openrouter: deferredModel(
    () =>
      import('./mod.ts').then(({ responses }) =>
        responses({
          fetch: lent.fetch,
          media: { store: lent.store },
          key: async () => {
            let key = await lent.key('openrouter')
            if (!key) {
              throw new Error(
                'OpenRouter is not connected. Run yak auth openrouter.',
              )
            }
            return key
          },
        })
      ),
    {
      vocab: openrouterDoc,
      info: true,
      mark: (reply, cache) => ({
        openrouter: {
          response_id: reply.id,
          ...prefixCacheMark(reply, cache),
        },
      }),
      recover: true,
    },
  ),
})
