/** OpenRouter's stateless OpenResponses adapter. */
import type { Model, Reply } from '@yaks/model'
import {
  type Options as ResponsesOptions,
  responses as openResponses,
} from '@yaks/openai'
import { chat, type MediaOptions } from './chat.ts'
import { openrouterDoc } from './vocab.ts'

export { openrouterDoc }
export type Options = Pick<ResponsesOptions, 'fetch' | 'signal'> & {
  /** Obtain an OpenRouter API key. Never supply another provider's credentials. */
  key: () => string | Promise<string>
  media?: MediaOptions
}

/** Always sends complete context. OpenRouter rejects stored continuations. */
export const responses = (options: Options): Model => {
  const call = openResponses({
    ...options,
    credential: async () => ({
      token: await options.key(),
      base: 'https://openrouter.ai/api/v1',
    }),
    store: false,
    web: false,
  })
  let model: Model = (request) =>
    request.modalities?.some((m) => m == 'audio' || m == 'image')
      ? chat(request, options)
      : call({ ...request, anchor: undefined })
  return Object.assign(
    model,
    {
      vocab: openrouterDoc,
      mark: (reply: Reply) => ({ openrouter: { response_id: reply.id } }),
    },
  )
}
