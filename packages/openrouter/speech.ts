// OpenRouter's speech door answers audio bytes rather than a chat message.
// The adapter keeps those bytes in the caller's artifact store before the
// session records their address.
import { ModelError, type Reply, type Request } from '@yaks/model'
import { generatedBytes, type MediaStore } from '@yaks/openai'

let audio = async (res: Response, max: number) => {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new ModelError('media_limit', 'Invalid media size limit')
  }
  if (!res.body) {
    throw new ModelError('media_response', 'OpenRouter returned no audio')
  }
  let parts: Uint8Array[] = [], size = 0
  for await (let part of res.body) {
    size += part.length
    if (size > max) {
      throw new ModelError(
        'media_payload',
        'Media exceeds configured size limit',
      )
    }
    parts.push(part)
  }
  let bytes = new Uint8Array(size), at = 0
  for (let part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  return bytes
}

export let speech = async (
  req: Request,
  options: {
    key: () => string | Promise<string>
    fetch?: typeof fetch
    signal?: AbortSignal
    media?: MediaStore
  },
): Promise<Reply> => {
  if (!options.media) {
    throw new ModelError(
      'media_storage',
      'Media output requires artifact storage',
    )
  }
  if (req.questions) {
    throw new ModelError('questions', 'Speech models answer no typed questions')
  }
  let input = req.items.findLast((item) => item.kind == 'user')
  if (!input || input.kind != 'user' || !input.text.trim()) {
    throw new ModelError('input', 'Speech models need a text prompt')
  }
  let key = await options.key()
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(
      'https://openrouter.ai/api/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + key,
          'content-type': 'application/json',
          ...req.conversation ? { 'x-session-id': req.conversation } : {},
        },
        body: JSON.stringify({
          model: req.model,
          input: input.text,
          response_format: 'mp3',
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
    throw new ModelError('transport', 'OpenRouter speech connection failed')
  }
  if (!res.ok) {
    throw new ModelError(
      'http_' + res.status,
      `OpenRouter speech request failed (${res.status})`,
      res.status == 429 || res.status >= 500 ? { after: 0 } : undefined,
    )
  }
  let id = res.headers.get('x-generation-id')
  if (!id) {
    throw new ModelError(
      'media_response',
      'OpenRouter returned no generation ID',
    )
  }
  let artifact = await generatedBytes(
    await audio(res, options.media.maxBytes ?? 64 * 1024 * 1024),
    'audio/mpeg',
    id,
    options.media,
  )
  return { id, model: req.model, items: [], artifacts: [artifact] }
}
