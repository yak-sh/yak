// @yaks/anthropic as a provider a config names (@yaks/model `ProviderFacet`):
// `anthropic`, on the key the person pasted with `yak auth anthropic`. The SDK
// loads on the first ask; a reply is marked without it (./mark.ts).

import { deferredModel, type Lent, type Model } from '@yaks/model'
import { mark } from './mark.ts'
import { anthropicDoc } from './vocab.ts'

/** `anthropic`, over the host's connections and the person's key. */
export let providers = (lent: Lent): Record<string, Model> => ({
  anthropic: deferredModel(
    () =>
      import('./mod.ts').then(({ messages }) =>
        messages({
          fetch: lent.fetch,
          key: async () => {
            let key = await lent.key('anthropic')
            if (!key) {
              throw new Error(
                'Anthropic is not connected. Run yak auth anthropic.',
              )
            }
            return key
          },
        })
      ),
    { vocab: anthropicDoc, info: true, mark },
  ),
})
