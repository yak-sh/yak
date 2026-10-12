// OpenRouter's speech door answers audio bytes rather than a chat message.
// The adapter keeps those bytes in the caller's artifact store before the
// session records their address.
import {
  acknowledged,
  type MediaReceipt,
  type MediaReceipts,
  ModelError,
  receivedMedia,
  type Reply,
  type Request,
  submitted,
} from '@yaks/model'
import type { MediaStore } from '@yaks/openai'
import { deliver, type Output } from './media.ts'
import { encoded } from './bytes.ts'

let joined = (parts: Uint8Array[], size: number) => {
  let bytes = new Uint8Array(size), at = 0
  for (let part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  return bytes
}

let audio = async (
  res: Response,
  max: number,
  checkpoint: (data: string) => Promise<void>,
) => {
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
    await checkpoint(encoded(joined(parts, size)))
  }
  return encoded(joined(parts, size))
}

export let speech = async (
  req: Request,
  options: {
    key: () => string | Promise<string>
    fetch?: typeof fetch
    signal?: AbortSignal
    media?: MediaStore
    receipts?: MediaReceipts
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
  let body = {
    model: req.model,
    input: input.text,
    response_format: 'mp3',
  }
  let init: RequestInit = {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
      ...req.conversation ? { 'x-session-id': req.conversation } : {},
    },
    body: JSON.stringify(body),
    signal: req.signal && options.signal
      ? AbortSignal.any([req.signal, options.signal])
      : req.signal ?? options.signal,
  }
  let res: Response
  await submitted(req)
  try {
    res = await (options.fetch ?? fetch)(
      'https://openrouter.ai/api/v1/audio/speech',
      init,
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
  await acknowledged(req, { openrouter: { response_id: id } })
  let receipt = (data: string, complete: boolean): MediaReceipt => {
    let output: Output = {
      kind: 'speech',
      reply: { id, model: req.model, items: [] },
      audio: data,
      mediaType: 'audio/mpeg',
      images: [],
      lookupCost: true,
    }
    return {
      provider: 'openrouter',
      call: req.call ?? id,
      id,
      model: req.model,
      input: body,
      response: output,
      complete,
    }
  }
  let data = await audio(
    res,
    options.media.maxBytes ?? 64 * 1024 * 1024,
    (data) => receivedMedia(req, receipt(data, false), options.receipts),
  )
  let complete = receipt(data, true)
  await receivedMedia(req, complete, options.receipts)
  let reply = await deliver(complete, {
    ...options,
    signal: req.signal && options.signal
      ? AbortSignal.any([req.signal, options.signal])
      : req.signal ?? options.signal,
  })
  await options.receipts?.save({ ...complete, cost: reply.cost, reply })
  return reply
}
