/** Chat Completions media output; text-only asks stay on Responses. */
import { type Item, ModelError, type Reply, type Request } from '@yaks/model'
import { generatedMedia, jsonFrames, type MediaStore } from '@yaks/openai'

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

let base64 = (bytes: Uint8Array) => {
  let parts: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }
  return btoa(parts.join(''))
}

let message = (item: Item): Data => {
  if (item.kind == 'image') {
    return {
      role: 'user',
      content: [
        { type: 'text', text: item.label },
        {
          type: 'image_url',
          image_url: {
            url: 'data:' + item.mediaType + ';base64,' + base64(item.bytes),
          },
        },
      ],
    }
  }
  if (item.kind == 'call') {
    return {
      role: 'assistant',
      tool_calls: [{
        id: item.id,
        type: 'function',
        function: { name: item.name, arguments: item.args },
      }],
    }
  }
  if (item.kind == 'result') {
    return { role: 'tool', tool_call_id: item.id, content: item.output }
  }
  return {
    role: item.kind == 'instruction' ? 'developer' : item.kind,
    content: item.text,
  }
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
    typeof v == 'number' && Number.isFinite(v)
  )
  return entries.length ? { usage: Object.fromEntries(entries) } : {}
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

/** A media ask uses OpenRouter's chat door and returns neutral blob artifacts. */
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
  if (!options.media) {
    throw new ModelError(
      'media_storage',
      'Media output requires artifact storage',
    )
  }
  let audio = req.modalities?.includes('audio') ?? false
  let format = options.media.audio?.format ?? 'mp3'
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
        },
        body: JSON.stringify({
          model: req.model,
          messages: [
            ...req.instructions
              ? [{ role: 'developer', content: req.instructions }]
              : [],
            ...req.items.map(message),
          ],
          modalities: req.modalities,
          ...audio ? { audio: { format, ...options.media.audio } } : {},
          stream: audio,
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
    throw new ModelError('transport', 'OpenRouter media connection failed')
  }
  if (!response.ok) {
    let fault = obj(await response.json().catch(() => undefined))
    let error = obj(fault.error)
    throw new ModelError(
      str(error.code) || 'http_' + response.status,
      str(error.message).slice(0, 512) || 'OpenRouter media request failed',
    )
  }
  let id = '', model = req.model, text = '', chunks: string[] = []
  let images: unknown[] = [], reported: unknown
  let receive = (value: Data) => {
    id = str(value.id) || id
    model = str(value.model) || model
    reported = value.usage ?? reported
    let choice = obj(list(value.choices)[0])
    let delta = obj(choice.delta ?? choice.message)
    let audioPart = obj(delta.audio)
    let said = str(delta.content) || str(audioPart.transcript)
    if (said) {
      req.onText?.({ index: 0, id: 'text', text: said })
      text += said
    }
    if (audioPart.data) chunks.push(str(audioPart.data))
    images.push(...list(delta.images))
  }
  if (audio) {
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
        options.media,
      ),
    )
  }
  for (let [index, value] of images.entries()) {
    artifacts.push(await image(value, id + ':image:' + index, options.media))
  }
  return {
    id,
    model,
    items: [{ kind: 'assistant', text }],
    ...artifacts.length ? { artifacts } : {},
    ...usage(reported),
  }
}
