import { listing, speechModels } from './list.ts'
export { listed, listing } from './list.ts'
/** OpenRouter's stateless OpenResponses adapter. */
import {
  type CacheContext,
  type Model,
  prefixCacheMark,
  type Reply,
  type Request,
} from '@yaks/model'
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
  let speechNames: Promise<string[]> | undefined
  let models: ReturnType<typeof listing> | undefined
  let model: Model = async (request) => {
    await options.key()
    let audio = request.modalities?.includes('audio')
    let names = options.speech ??
      (audio ? await (speechNames ??= speechModels(options.fetch)) : [])
    return names.includes(request.model)
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
  }
  return Object.assign(
    model,
    {
      list: () => models ??= listing(options.fetch),
      info: async (name: string) => {
        await options.key()
        return (await (models ??= listing(options.fetch))).find((m) =>
          m.name == name
        )
      },
      vocab: openrouterDoc,
      mark: (reply: Reply, cache?: CacheContext) => ({
        openrouter: { response_id: reply.id, ...prefixCacheMark(reply, cache) },
      }),
    },
  )
}
