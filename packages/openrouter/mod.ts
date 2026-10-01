/** OpenRouter's stateless OpenResponses adapter. */
import type { Model, Reply, Request } from '@yaks/model'
import {
  type Options as ResponsesOptions,
  responses as openResponses,
} from '@yaks/openai'
import { chat, type MediaOptions } from './chat.ts'
import { speech } from './speech.ts'
import { openrouterDoc } from './vocab.ts'
import { alibabaCache, responseBody, tools } from './prompt.ts'

export { openrouterDoc }
export type Options = Pick<ResponsesOptions, 'fetch' | 'signal'> & {
  /** Obtain an OpenRouter API key. Never supply another provider's credentials. */
  key: () => string | Promise<string>
  media?: MediaOptions
  /** Models served by OpenRouter's byte-stream speech endpoint. */
  speech?: readonly string[]
}

/** Always sends complete context. OpenRouter rejects stored continuations. */
export let responses = (options: Options): Model => {
  let call = (req: Request) =>
    openResponses({
      ...options,
      credential: async () => ({
        token: await options.key(),
        base: 'https://openrouter.ai/api/v1',
      }),
      store: false,
      web: false,
      shape: (body) => responseBody(req, body),
    })
  let model: Model = (request) =>
    options.speech?.includes(request.model)
      ? speech(request, options)
      : request.modalities?.some((m) => m == 'audio' || m == 'image')
      ? chat(request, options)
      : alibabaCache(request.model)
      ? chat(request, options)
      : call(request)({
        ...request,
        tools: tools(request.tools),
        anchor: undefined,
      })
  return Object.assign(
    model,
    {
      vocab: openrouterDoc,
      mark: (reply: Reply) => ({ openrouter: { response_id: reply.id } }),
    },
  )
}
