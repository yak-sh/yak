/** Chat Completions for generated media and Alibaba explicit-cache models. */
import { ModelError, type Reply, type Request } from '@yaks/model'
import { generatedMedia, jsonFrames, type MediaStore } from '@yaks/openai'
import { chatTools, messages } from './prompt.ts'

export type MediaOptions = MediaStore & {
  /** Audio settings vary by model; Lyria uses MP3 without a voice. */
  audio?: {
    format: 'mp3' | 'wav' | 'flac' | 'opus' | 'pcm16'
    voice?: string
  }
}

type Data = Record<string, unknown>
let isData = (v: unknown): v is Data =>
  v != null && typeof v == 'object' && !Array.isArray(v)
let obj = (v: unknown): Data => isData(v) ? v : {}
let str = (v: unknown) => typeof v == 'string' ? v : ''
let list = (v: unknown): unknown[] => Array.isArray(v) ? v : []

let retryAfter = (value: string | null) => {
  if (!value) return 0
  let ms = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now()
  return Number.isFinite(ms) ? Math.min(60_000, Math.max(0, ms)) : 0
}

let usage = (raw: unknown) => {
  let u = obj(raw)
  let counts = {
    input_tokens: u.prompt_tokens,
    output_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    cached_tokens: obj(u.prompt_tokens_details).cached_tokens,
    reasoning_tokens: obj(u.completion_tokens_details).reasoning_tokens,
  }
  let entries = Object.entries(counts).filter(([, v]) =>
    typeof v == 'number' && Number.isSafeInteger(v) && v >= 0
  )
  // OpenRouter reports what every request cost, in dollars.
  let cost = u.cost
  return {
    ...entries.length ? { usage: Object.fromEntries(entries) } : {},
    ...typeof cost == 'number' && Number.isFinite(cost) && cost >= 0
      ? { cost }
      : {},
  }
}

let image = (v: unknown, call: string, options: MediaOptions) => {
  let url = str(obj(obj(v).image_url).url)
  let match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    url,
  )
  if (!match) {
    throw new ModelError('media_format', 'Unsupported generated image URL')
  }
  return generatedMedia(match[2], match[1], call, options)
}

/** The chat door streams text/tools, or decodes generated media to artifacts. */
export let chat = async (
  req: Request,
  options: {
    key: () => string | Promise<string>
    fetch?: typeof fetch
    signal?: AbortSignal
    media?: MediaOptions
  },
): Promise<Reply> => {
  if (req.questions) {
    throw new ModelError(
      'questions',
      'Chat Completions answers no typed questions',
    )
  }
  let media = req.modalities?.some((m) => m == 'audio' || m == 'image')
  if (media && !options.media) {
    throw new ModelError(
      'media_storage',
      'Media output requires artifact storage',
    )
  }
  let audio = req.modalities?.includes('audio') ?? false
  let format = options.media?.audio?.format ?? 'mp3'
  let mediaType = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    opus: 'audio/opus',
    pcm16: 'audio/pcm',
  }[format]
  let key = await options.key()
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + key,
          'content-type': 'application/json',
          ...req.conversation ? { 'x-session-id': req.conversation } : {},
        },
        body: JSON.stringify({
          model: req.model,
          messages: messages(req),
          ...req.conversation ? { session_id: req.conversation } : {},
          ...!media ? { tools: chatTools(req) } : {},
          ...req.effort ? { reasoning: { effort: req.effort } } : {},
          modalities: req.modalities,
          ...audio ? { audio: { format, ...options.media?.audio } } : {},
          stream: !media || audio,
          ...!media || audio ? { stream_options: { include_usage: true } } : {},
          ...req.tokens ? { max_tokens: req.tokens } : {},
        }),
        signal: req.signal && options.signal
          ? AbortSignal.any([req.signal, options.signal])
          : req.signal ?? options.signal,
      },
    )
  } catch (error) {
    if (
      req.signal?.aborted || options.signal?.aborted ||
      (error instanceof Error && error.name == 'AbortError')
    ) throw error
    throw new ModelError(
      'transport',
      'OpenRouter media connection failed',
      { after: 0 },
    )
  }
  if (!response.ok) {
    let fault = obj(await response.json().catch(() => undefined))
    let error = obj(fault.error)
    throw new ModelError(
      str(error.code) || 'http_' + response.status,
      str(error.message).slice(0, 512) || 'OpenRouter media request failed',
      response.status == 429 || response.status >= 500
        ? { after: retryAfter(response.headers.get('retry-after')) }
        : undefined,
    )
  }
  let id = '', model = req.model, text = '', chunks: string[] = []
  let images: unknown[] = [], reported: unknown
  let calls = new Map<number, { id: string; name: string; args: string }>()
  let receive = (value: Data) => {
    if (value.error) {
      let error = obj(value.error)
      throw new ModelError(
        str(error.code) || 'stream',
        str(error.message).slice(0, 512) || 'OpenRouter stream failed',
      )
    }
    id = str(value.id) || id
    model = str(value.model) || model
    reported = value.usage ?? reported
    let choice = obj(list(value.choices)[0])
    let delta = obj(choice.delta ?? choice.message)
    let audioPart = obj(delta.audio)
    let said = str(delta.content) || str(audioPart.transcript)
    if (said) {
      req.onText?.({ index: 0, text: said })
      text += said
    }
    for (let raw of list(delta.tool_calls)) {
      let tool = obj(raw), fn = obj(tool.function)
      let index = typeof tool.index == 'number' ? tool.index : calls.size
      let call = calls.get(index) ?? { id: '', name: '', args: '' }
      call.id += str(tool.id)
      call.name += str(fn.name)
      call.args += str(fn.arguments)
      calls.set(index, call)
    }
    if (audioPart.data) chunks.push(str(audioPart.data))
    images.push(...list(delta.images))
  }
  if (!media || audio) {
    if (!response.body) {
      throw new ModelError(
        'media_stream',
        'OpenRouter returned no media stream',
      )
    }
    for await (
      let frame of jsonFrames(
        response.body,
        (kind, reason) => new ModelError(kind, reason),
      )
    ) receive(frame)
  } else receive(obj(await response.json()))
  if (!id) {
    throw new ModelError('media_response', 'OpenRouter returned no response ID')
  }
  let artifacts: NonNullable<Reply['artifacts']> = []
  if (chunks.length) {
    artifacts.push(
      await generatedMedia(
        chunks.join(''),
        mediaType,
        id + ':audio',
        options.media!,
      ),
    )
  }
  for (let [index, value] of images.entries()) {
    artifacts.push(await image(value, id + ':image:' + index, options.media!))
  }
  return {
    id,
    model,
    items: [
      ...text || !calls.size ? [{ kind: 'assistant' as const, text }] : [],
      ...[...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => ({
        kind: 'call' as const,
        ...c,
      })),
    ],
    ...artifacts.length ? { artifacts } : {},
    ...usage(reported),
  }
}
