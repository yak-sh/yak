// @yaks/anthropic as a provider a config names (@yaks/model `ProviderFacet`):
// `anthropic`, on the key the person pasted with `yak auth anthropic`, or the
// one its options name (`key`), read at each call, searching and fetching the
// web with the API's own tools unless its options or `HARNESS_WEB=0` turn them
// off. The model (./mod.ts) loads on the first ask; a reply is marked without
// it (./mark.ts).

import { deferredModel, type Lent, type Model } from '@yaks/model'
import { mark } from './mark.ts'
import { READS } from './reads.ts'
import { anthropicDoc } from './vocab.ts'
import { HOSTED } from './web.ts'

/** The plugin's options in a config. */
export type Options = {
  /** the API key to call with, instead of the person's */
  key?: string
  /** offer the API's web search and page fetch (default on, unless
   * `HARNESS_WEB=0`) */
  web?: boolean
}

/** `anthropic`, over the host's connections and its key. */
export let providers = (
  lent: Lent,
  options: Options = {},
): Record<string, Model> => {
  let web = options.web ?? lent.env('HARNESS_WEB') != '0'
  return {
    anthropic: deferredModel(
      () =>
        import('./mod.ts').then(({ messages }) =>
          messages({
            fetch: lent.fetch,
            key: async () => {
              let key = options.key ?? await lent.key('anthropic')
              if (!key) {
                throw new Error(
                  'Anthropic is not connected. Run yak auth anthropic.',
                )
              }
              return key
            },
            web,
          })
        ),
      {
        vocab: anthropicDoc,
        info: true,
        mark,
        reads: READS,
        ...web ? { hosted: HOSTED } : {},
      },
    ),
  }
}
