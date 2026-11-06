// @yaks/openai as a provider a config names (@yaks/model `ProviderFacet`):
// `openai`, signed in with an API key from the host's settings or the ChatGPT
// grant in the person's OpenAI connection, generating images into the host's
// artifact store and searching the web. A config may aim it at another
// OpenAI-compatible endpoint instead (`base`, such as an AI Gateway's). Its
// transport loads on the first ask.

import { Refused } from '@yaks/graph/errors'
import {
  deferredModel,
  type Lent,
  type Model,
  prefixCacheMark,
} from '@yaks/model'
import { CODEX, type Credential, fromChatGPT, fromEnv } from './credential.ts'
import type { ImageGeneration, Images } from './images.ts'
import type { TransportCredential } from './transport.ts'
import { openaiDoc } from './vocab.ts'

/** How the harness signs in to OpenAI over what it was lent. */
export type SignedIn = {
  credential: () => Promise<Credential>
  refresh: (stale: TransportCredential) => Promise<Credential>
}

/** OpenAI's credential: `OPENAI_API_KEY`, else the person's ChatGPT grant,
 * refreshed through their connection when the Codex backend refuses it. */
export let signedIn = (
  lent: Pick<Lent, 'env' | 'key' | 'refresh'>,
): SignedIn => {
  let credential = async (): Promise<Credential> => {
    let key = fromEnv(lent.env)
    if (key) return key
    let token = await lent.key('openai')
    if (!token) {
      throw new Refused(
        'OpenAI is not connected. Authorize OpenAI or set OPENAI_API_KEY.',
      )
    }
    return fromChatGPT(token)
  }
  return {
    credential,
    refresh: async (stale) => {
      let key = fromEnv(lent.env)
      if (key || stale.base != CODEX) return key ?? await credential()
      let token = await lent.refresh('openai', stale.token)
      if (!token) {
        throw new Refused('OpenAI is not connected. Authorize OpenAI again.')
      }
      return fromChatGPT(token)
    },
  }
}

// How a configured endpoint is opened (Options `base`).
let opened = (
  lent: Pick<Lent, 'env' | 'key'>,
  base: string,
): Pick<SignedIn, 'credential'> => ({
  credential: async () => ({
    token: fromEnv(lent.env)?.token ?? await lent.key('openai') ?? '',
    base: base.replace(/\/+$/, ''),
  }),
})

/** The image tool's settings, or `false` for none. */
export type ImageOptions = { tool?: ImageGeneration; maxBytes?: number }

/** The plugin's options in a config. */
export type Options = {
  /** generate images (default on, unless `HARNESS_IMAGES=0`) */
  images?: ImageOptions | false
  /** offer hosted web search (default on, unless `HARNESS_WEB=0`) */
  web?: boolean
  /** an OpenAI-compatible endpoint to call instead of OpenAI's own, opened
   * by `OPENAI_API_KEY`, else the lent `openai` key, else by nothing, which
   * leaves the endpoint to authenticate the call (an AI Gateway's own key) */
  base?: string
  /** headers every request carries (an AI Gateway's `cf-aig-authorization`) */
  headers?: Record<string, string>
}

/** Explicit options override the setting; otherwise images are on. */
export let configuredImages = (
  store: Lent['store'],
  options: ImageOptions | false | undefined,
  setting: string | undefined,
): Images | undefined => {
  if (options === false) return undefined
  if (options) return { ...options, store }
  if (setting == '0') return undefined
  if (setting != null && setting != '' && setting != '1') {
    throw new Error('HARNESS_IMAGES must be 0 (disabled) or 1 (enabled)')
  }
  return { store }
}

/** `openai`, served over what the host lends. */
export let providers = (
  lent: Lent,
  options: Options = {},
): Record<string, Model> => {
  let images = configuredImages(
    lent.store,
    options.images,
    lent.env('HARNESS_IMAGES'),
  )
  return {
    openai: deferredModel(
      () =>
        import('./responses.ts').then(({ responses }) =>
          responses({
            ...options.base
              ? { ...opened(lent, options.base), authentication: 'optional' }
              : signedIn(lent),
            headers: options.headers,
            fetch: lent.fetch,
            redact: true,
            images,
            web: options.web ?? lent.env('HARNESS_WEB') != '0',
            receipts: lent.receipts,
          })
        ),
      {
        vocab: openaiDoc,
        mark: (reply, cache) => ({
          openai: { response_id: reply.id, ...prefixCacheMark(reply, cache) },
        }),
        anchor: () => undefined,
        lateResults: true,
        recover: true,
      },
    ),
  }
}
