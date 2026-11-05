// Speech to text and text to speech. A provider is data: where it answers,
// which models hear and speak, and what each costs. One implementation calls
// any provider described so; the key is an argument, and nothing here reads
// the environment.
// https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
// https://developers.deepgram.com/reference/text-to-speech/speak-request
// https://developers.deepgram.com/docs/flux/quickstart

/** A speech provider as data. */
export type Provider = {
  name: string
  /** the HTTP API's base */
  api: string
  /** the streaming API's base */
  live: string
  /** what a request names before its key: `Authorization: <scheme> <key>`,
   * and the WebSocket subprotocol a stream offers its key under */
  scheme: string
  /** a recording heard whole, priced by the minute of audio */
  hear: { path: string; model: string; perMinute: number }
  /** audio heard as it streams, told back a turn at a time */
  turns: { path: string; model: string; perMinute: number }
  /** text spoken, priced by the thousand characters */
  speak: { path: string; voice: string; perThousand: number }
  /** where the account's projects and their balances are read */
  projects: string
}

/** Deepgram: Nova-3 hears a recording, Flux hears a call and knows when a
 * speaker's turn ends, Aura-2 speaks. Prices are its pay-as-you-go list,
 * 2026-11-05. */
export let DEEPGRAM: Provider = {
  name: 'deepgram',
  api: 'https://api.deepgram.com',
  live: 'wss://api.deepgram.com',
  scheme: 'token',
  hear: { path: '/v1/listen', model: 'nova-3', perMinute: 0.0043 },
  turns: { path: '/v2/listen', model: 'flux-general-en', perMinute: 0.0077 },
  speak: { path: '/v1/speak', voice: 'aura-2-thalia-en', perThousand: 0.030 },
  projects: '/v1/projects',
}

/** How audio is encoded: an MP3, or raw samples at a rate (`mulaw` is the
 * telephone's 8 kHz μ-law; `linear16` is 16-bit PCM). */
export type Format =
  | { encoding: 'mp3' }
  | { encoding: 'mulaw' | 'linear16'; rate: number }

let MEDIA: Record<Format['encoding'], string> = {
  mp3: 'audio/mpeg',
  mulaw: 'audio/basic',
  linear16: 'audio/L16',
}

/** The bytes a second of raw audio takes, or undefined for a compressed one. */
export let perSecond = (format: Format): number | undefined =>
  format.encoding == 'mulaw'
    ? format.rate
    : format.encoding == 'linear16'
    ? format.rate * 2
    : undefined

/** What speaking `text` costs, in dollars. */
export let spoken = (provider: Provider, text: string): number =>
  text.length / 1000 * provider.speak.perThousand

/** What hearing `seconds` of audio costs, in dollars, whole or streamed. */
export let heard = (
  provider: Provider,
  seconds: number,
  as: 'hear' | 'turns' = 'hear',
): number => seconds / 60 * provider[as].perMinute

/** A provider's refusal: `status` is its HTTP status, and `retry` says a
 * later try may go through (a 429 or 5xx, or no answer at all). */
export class SpeechError extends Error {
  readonly status: number
  readonly retry: boolean
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'SpeechError'
    this.status = status
    this.retry = status == 0 || status == 429 || status >= 500
  }
}

/** Text spoken: the audio as it streams, its media type, and its cost. */
export type Spoken = {
  body: ReadableStream<Uint8Array>
  type: string
  dollars: number
}

/** A recording heard: its words, its length, and its cost. */
export type Heard = { text: string; seconds: number; dollars: number }

/** A stream being heard. */
export type Turns = {
  send: (audio: Uint8Array) => void
  close: () => { seconds: number; dollars: number }
}

/** What a call to the provider needs. */
export type Calling = {
  provider: Provider
  key: string
  fetch?: typeof fetch
  signal?: AbortSignal
}

let calling = async (
  { provider, key, fetch: given, signal }: Calling,
  path: string,
  init: RequestInit = {},
) => {
  let response
  try {
    response = await (given ?? globalThis.fetch)(provider.api + path, {
      ...init,
      signal,
      headers: {
        authorization: `${provider.scheme} ${key}`,
        ...init.headers as Record<string, string>,
      },
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new SpeechError(`${provider.name} could not be reached: ${error}`)
  }
  if (response.ok) return response
  let said = await response.text().catch(() => '')
  throw new SpeechError(
    `${provider.name} answered ${response.status} to ${path.split('?')[0]}: ${
      said.slice(0, 300) || 'no reason given'
    }`,
    response.status,
  )
}

let query = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(o).flatMap(([k, v]) => v == null ? [] : [[k, String(v)]]),
  )

let encoded = (format: Format) =>
  format.encoding == 'mp3'
    ? { encoding: 'mp3' }
    : { encoding: format.encoding, sample_rate: format.rate }

/**
 * `text` spoken: the audio as it streams from the provider, its media type,
 * and what it cost. Raw samples come without a container, ready for a call.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { DEEPGRAM, speak } from '@yaks/speech'
 * let asked: string[] = []
 * let fetch = (url: string | URL | Request) => {
 *   asked.push(String(url))
 *   return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
 * }
 * let said = await speak({
 *   provider: DEEPGRAM,
 *   key: 'k',
 *   text: 'Hello',
 *   format: { encoding: 'mulaw', rate: 8000 },
 *   fetch: fetch as typeof globalThis.fetch,
 * })
 * equal(said.type, 'audio/basic')
 * equal(asked[0].includes('container=none'), true)
 * ```
 */
export let speak = async (
  o: Calling & { text: string; voice?: string; format?: Format },
): Promise<Spoken> => {
  let format = o.format ?? { encoding: 'mp3' }
  let params = query({
    model: o.voice ?? o.provider.speak.voice,
    ...encoded(format),
    ...format.encoding == 'mp3' ? {} : { container: 'none' },
  })
  let response = await calling(o, `${o.provider.speak.path}?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: o.text }),
  })
  if (!response.body) {
    throw new SpeechError(`${o.provider.name} returned no audio`, 502)
  }
  return {
    body: response.body,
    type: MEDIA[format.encoding],
    dollars: spoken(o.provider, o.text),
  }
}

type Listened = {
  metadata?: { duration?: number }
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
}

/**
 * A recording heard whole: its words, how long it was, and what hearing it
 * cost.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { DEEPGRAM, hear } from '@yaks/speech'
 * let fetch = () =>
 *   Promise.resolve(Response.json({
 *     metadata: { duration: 30 },
 *     results: { channels: [{ alternatives: [{ transcript: 'Hi there' }] }] },
 *   }))
 * let got = await hear({
 *   provider: DEEPGRAM,
 *   key: 'k',
 *   audio: new Uint8Array([1]),
 *   type: 'audio/wav',
 *   fetch: fetch as typeof globalThis.fetch,
 * })
 * equal(got.text, 'Hi there')
 * equal(got.dollars, 0.00215)
 * ```
 */
export let hear = async (
  o: Calling & { audio: BodyInit; type: string },
): Promise<Heard> => {
  let params = query({ model: o.provider.hear.model, smart_format: 'true' })
  let response = await calling(o, `${o.provider.hear.path}?${params}`, {
    method: 'POST',
    headers: { 'content-type': o.type },
    body: o.audio,
  })
  let said = await response.json() as Listened
  let seconds = said.metadata?.duration ?? 0
  return {
    text: said.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '',
    seconds,
    dollars: heard(o.provider, seconds),
  }
}

/** The account's credit left, in dollars, across its projects. */
export let balance = async (o: Calling): Promise<number> => {
  let { projects } = await (await calling(o, o.provider.projects)).json() as {
    projects?: { project_id: string }[]
  }
  let total = 0
  for (let { project_id } of projects ?? []) {
    let { balances } = await (await calling(
      o,
      `${o.provider.projects}/${project_id}/balances`,
    )).json() as { balances?: { amount?: number }[] }
    for (let b of balances ?? []) total += b.amount ?? 0
  }
  return total
}

/** The socket a stream speaks over: the platform's WebSocket, or a stand-in. */
export type Socket = {
  send: (data: string | Uint8Array) => void
  close: (code?: number, reason?: string) => void
  addEventListener: (
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ) => void
}

/** What a stream tells as a speaker talks. */
export type Told = {
  /** they started talking: whatever is playing to them should stop */
  start?: () => void
  /** they finished a turn, saying `text` */
  end: (text: string) => void
  /** the stream failed or closed before `close` was asked */
  lost?: (reason: string) => void
}

type Info = { type?: string; event?: string; transcript?: string }

/**
 * What one message from the turns stream means: a turn starting, a turn
 * ended with its words, or nothing to act on.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { turnOf } from '@yaks/speech'
 * equal(
 *   turnOf('{"type":"TurnInfo","event":"EndOfTurn","transcript":"Hi"}'),
 *   { end: 'Hi' },
 * )
 * equal(turnOf('{"type":"TurnInfo","event":"StartOfTurn"}'), { start: true })
 * equal(turnOf('{"type":"TurnInfo","event":"Update"}'), {})
 * ```
 */
export let turnOf = (
  data: unknown,
): { start?: true; end?: string; error?: string } => {
  let info: Info
  try {
    info = JSON.parse(String(data))
  } catch {
    return {}
  }
  if (info.type == 'Error') {
    return { error: String((info as { description?: string }).description) }
  }
  if (info.type != 'TurnInfo') return {}
  if (info.event == 'StartOfTurn') return { start: true }
  if (info.event == 'EndOfTurn') return { end: info.transcript?.trim() ?? '' }
  return {}
}

/**
 * Audio heard as it streams, told back a turn at a time (`told`). `send`
 * takes raw samples in `format`; `close` ends the stream and answers how many
 * seconds were heard and what they cost. `open` makes the socket, the
 * platform's WebSocket by default, offering the key as its subprotocol.
 */
export let turns = (
  o: {
    provider: Provider
    key: string
    format: Extract<Format, { rate: number }>
    told: Told
    open?: (url: string, protocols: string[]) => Socket
  },
): Turns => {
  let url = `${o.provider.live}${o.provider.turns.path}?${
    query({ model: o.provider.turns.model, ...encoded(o.format) })
  }`
  let socket = (o.open ??
    ((url, protocols) => new WebSocket(url, protocols) as unknown as Socket))(
      url,
      [
        o.provider.scheme,
        o.key,
      ],
    )
  let ready = false, closing = false, bytes = 0
  let waiting: Uint8Array[] = []
  socket.addEventListener('open', () => {
    ready = true
    for (let part of waiting.splice(0)) socket.send(part)
  })
  socket.addEventListener('message', (event) => {
    let turn = turnOf(event.data)
    if (turn.start) o.told.start?.()
    if (turn.end) o.told.end(turn.end)
    if (turn.error) o.told.lost?.(turn.error)
  })
  let lost = (reason: string) => () => {
    if (!closing) o.told.lost?.(reason)
    closing = true
  }
  socket.addEventListener('close', lost('the stream closed'))
  socket.addEventListener('error', lost('the stream failed'))
  return {
    send: (audio: Uint8Array) => {
      if (closing) return
      bytes += audio.length
      if (ready) socket.send(audio)
      else waiting.push(audio)
    },
    close: () => {
      if (!closing) {
        closing = true
        try {
          if (ready) socket.send(JSON.stringify({ type: 'CloseStream' }))
          socket.close(1000)
        } catch {
          // A socket already gone has nothing more to close.
        }
      }
      let seconds = bytes / perSecond(o.format)!
      return { seconds, dollars: heard(o.provider, seconds, 'turns') }
    },
  }
}
