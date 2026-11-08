// @yaks/openai as a provider a config names (@yaks/model `ProviderFacet`):
// `openai`, signed in with an API key from the host's settings or the ChatGPT
// grant in the person's OpenAI connection, generating images into the host's
// artifact store and searching the web. A config may aim it at another
// OpenAI-compatible endpoint instead (`base`), or reach OpenAI through a
// Cloudflare AI Gateway (`gateway`), and pay with a key of its own (`key`).
// Its transport loads on the first ask.

import { Refused } from '@yaks/graph/errors'
import {
  deferredModel,
  type Lent,
  type Model,
  prefixCacheMark,
} from '@yaks/model'
import {
  CODEX,
  type Credential,
  fromChatGPT,
  fromEnv,
  OPENAI,
} from './credential.ts'
import type { ImageGeneration, Images } from './images.ts'
import { generations, image, imageListed, imageQuote } from './generations.ts'
import type { TransportCredential } from './transport.ts'
import { openaiDoc } from './vocab.ts'
import { reads } from './reads.ts'

/** How the harness signs in to OpenAI over what it was lent. */
export type SignedIn = {
  credential: () => Promise<Credential>
  refresh: (stale: TransportCredential) => Promise<Credential>
}

/** OpenAI's credential: `OPENAI_API_KEY`, else the person's ChatGPT grant,
 * refreshed through their connection when the Codex backend refuses it. */
export let signedIn = (
  lent: Pick<Lent, 'env' | 'key' | 'refresh'>,
  own?: string,
): SignedIn => {
  let keyed = (): Credential | undefined =>
    own ? { token: own, base: OPENAI } : fromEnv(lent.env)
  let credential = async (): Promise<Credential> => {
    let key = keyed()
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
      let key = keyed()
      if (key || stale.base != CODEX) return key ?? await credential()
      let token = await lent.refresh('openai', stale.token)
      if (!token) {
        throw new Refused('OpenAI is not connected. Authorize OpenAI again.')
      }
      return fromChatGPT(token)
    },
  }
}

// How a configured endpoint is opened (Options `base`, `gateway`).
let opened = (
  lent: Pick<Lent, 'env' | 'key'>,
  base: string,
  own?: string,
): Pick<SignedIn, 'credential'> => ({
  credential: async () => ({
    token: own ?? fromEnv(lent.env)?.token ?? await lent.key('openai') ?? '',
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
  /** headers every request carries */
  headers?: Record<string, string>
  /** a Cloudflare AI Gateway to reach OpenAI through, where no `base` is
   * given: its account and its id, and the token of a gateway that keeps
   * OpenAI's key itself (sent as `cf-aig-authorization`) */
  gateway?: { account?: string; id?: string; token?: string }
  /** the API key to call with, before `OPENAI_API_KEY` and the lent key */
  key?: string
}

// The endpoint options aim at, or none for OpenAI's own.
let aimed = (options: Options): string | undefined => {
  let { account, id } = options.gateway ?? {}
  return options.base ||
    (account && id
      ? `https://gateway.ai.cloudflare.com/v1/${account}/${id}/openai`
      : undefined)
}

/** Where the models `providers` makes with `options` call, so a host may
 * send a credential it lends them there and nowhere else. */
export let hosts = (options: Options = {}): string[] => [
  new URL(aimed(options) ?? OPENAI).host,
]

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

/** `openai`, served over what the host lends: a GPT Image model's name
 * answers with an image kept in the lent store (generations.ts), any other
 * with the Responses API. */
export let providers = (
  lent: Lent,
  options: Options = {},
): Record<string, Model> => {
  let images = configuredImages(
    lent.store,
    options.images,
    lent.env('HARNESS_IMAGES'),
  )
  let base = aimed(options), token = options.gateway?.token
  let signing = base
    ? {
      ...opened(lent, base, options.key),
      authentication: 'optional' as const,
    }
    : signedIn(lent, options.key)
  let headers = {
    ...options.headers,
    ...token ? { 'cf-aig-authorization': `Bearer ${token}` } : {},
  }
  let text = deferredModel(
    () =>
      import('./responses.ts').then(({ responses }) =>
        responses({
          ...signing,
          headers,
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
      info: true,
      reads,
    },
  )
  let pictures = generations({
    credential: signing.credential,
    headers,
    fetch: lent.fetch,
    media: { store: lent.store, maxBytes: images?.maxBytes },
    receipts: lent.receipts,
  })
  return {
    openai: Object.assign(
      (req: Parameters<Model>[0]) =>
        image(req.model) ? pictures(req) : text(req),
      text,
      {
        quote: (req: Parameters<Model>[0], remaining: number) =>
          image(req.model) ? imageQuote(req, remaining) : undefined,
        info: (name: string) =>
          image(name) ? Promise.resolve(imageListed(name)) : text.info!(name),
        recover: async (call: string) =>
          image(String((await lent.receipts?.read(call))?.model))
            ? pictures.recover(call)
            : text.recover!(call),
      },
    ),
  }
}
