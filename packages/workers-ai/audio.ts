// Workers AI music uses a prompt instead of chat and returns a temporary URL.
// Prices are Cloudflare's output-second/track tariffs, never text token guesses.
// https://developers.cloudflare.com/ai/models/elevenlabs/music-v2/
// https://developers.cloudflare.com/ai/models/minimax/music-2.6/
import { ModelError, type Request } from '@yaks/model'
import { matchesMediaType } from '@yaks/blob'

export let music = (model: string) =>
  model == 'elevenlabs/music-v2' || model == 'minimax/music-2.6'

let obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {}

/** Music models read the conversation's words as their prompt, not tools. */
export let musicInput = (req: Request): Record<string, unknown> => {
  if (req.questions || req.items.some((i) => i.kind == 'image')) {
    throw new ModelError(
      'music_input',
      'Music takes text, not questions/images',
    )
  }
  let prompt = [
    req.instructions,
    ...req.items.flatMap((i) =>
      i.kind == 'user' || i.kind == 'assistant' || i.kind == 'instruction'
        ? [i.text]
        : []
    ),
  ].filter(Boolean).join('\n\n')
  if (!prompt.trim()) {
    throw new ModelError('music_input', 'Music needs a prompt')
  }
  if (req.model == 'minimax/music-2.6' && prompt.length > 2000) {
    throw new ModelError(
      'music_input',
      'MiniMax music prompts allow 2000 chars',
    )
  }
  return req.model == 'elevenlabs/music-v2'
    ? { prompt, music_length_ms: 30000, output_format: 'mp3_48000_192' }
    : { prompt, lyrics_optimizer: false, is_instrumental: true, format: 'mp3' }
}

// An ID3v2 tag's size is four syncsafe bytes; it is not an audio frame.
let tag = (b: Uint8Array) =>
  String.fromCharCode(...b.subarray(0, 3)) == 'ID3'
    ? 10 + ((b[6] & 127) * 2097152 + (b[7] & 127) * 16384 +
      (b[8] & 127) * 128 + (b[9] & 127)) +
      (b[5] & 16 ? 10 : 0)
    : 0

/** MPEG layer III output seconds, summed per frame, including VBR streams. */
export let audioSeconds = (b: Uint8Array): number => {
  let seconds = 0
  for (let p = tag(b); p + 4 <= b.length;) {
    let version = (b[p + 1] >> 3) & 3
    let rate = (b[p + 2] >> 2) & 3
    let index = b[p + 2] >> 4
    if (
      b[p] != 255 || (b[p + 1] & 224) != 224 ||
      ((b[p + 1] >> 1) & 3) != 1 || version == 1 || rate == 3 ||
      index == 0 || index == 15
    ) {
      p++
      continue
    }
    let hz = [44100, 48000, 32000][rate] /
      (version == 3 ? 1 : version == 2 ? 2 : 4)
    let kbps = (version == 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index]
    let samples = version == 3 ? 1152 : 576
    let size = Math.floor(samples / 8 * kbps * 1000 / hz) +
      ((b[p + 2] >> 1) & 1)
    if (p + size > b.length) {
      throw new ModelError('media_payload', 'Truncated music frame')
    }
    seconds += samples / hz
    p += size
  }
  if (!seconds) {
    throw new ModelError('media_format', 'Music has no MP3 frames to price')
  }
  return seconds
}

/** Dollars per generated second (ElevenLabs) or track/lyrics (MiniMax). */
export let audioPrice = (
  model: string,
  input: unknown,
  seconds: number,
): number => {
  if (model == 'minimax/music-2.6') {
    return 0.15 + (obj(input).lyrics_optimizer == true ? 0.01 : 0)
  }
  if (
    model != 'elevenlabs/music-v2' || !Number.isFinite(seconds) || seconds <= 0
  ) {
    throw new ModelError('media_cost', 'Music has no output duration to price')
  }
  return seconds * 0.0025
}

/** Fetch the provider URL once, with no credential and a bounded body. */
export let pricedAudio = async (
  model: string,
  input: unknown,
  answer: unknown,
  options: { fetch?: typeof fetch; signal?: AbortSignal; maxBytes?: number } =
    {},
): Promise<{ bytes: Uint8Array; mediaType: string; cost: number }> => {
  let url: URL
  try {
    url = new URL(String(obj(answer).audio ?? ''))
  } catch {
    throw new ModelError('media_response', 'Music returned no audio URL')
  }
  if (url.protocol != 'https:' || url.username || url.password) {
    throw new ModelError('media_response', 'Music needs an HTTPS audio URL')
  }
  let max = options.maxBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new ModelError('media_limit', 'Invalid music size limit')
  }
  let res = await (options.fetch ?? fetch)(url, {
    signal: options.signal,
    redirect: 'error',
  })
  if (!res.ok || !res.body) {
    throw new ModelError(
      'media_response',
      `Music download failed (${res.status})`,
    )
  }
  let chunks: Uint8Array[] = [], size = 0
  for await (let chunk of res.body) {
    size += chunk.length
    if (size > max) {
      throw new ModelError(
        'media_payload',
        'Music exceeds configured size limit',
      )
    }
    chunks.push(chunk)
  }
  let bytes = new Uint8Array(size), offset = 0
  for (let chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  let mediaType = matchesMediaType(bytes, 'audio/mpeg')
    ? 'audio/mpeg'
    : matchesMediaType(bytes, 'audio/wav')
    ? 'audio/wav'
    : ''
  if (!mediaType) {
    throw new ModelError('media_format', 'Unsupported music format')
  }
  let seconds = model == 'elevenlabs/music-v2' ? audioSeconds(bytes) : 0
  return { bytes, mediaType, cost: audioPrice(model, input, seconds) }
}
