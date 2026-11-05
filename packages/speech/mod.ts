// Speech to text, text to speech, and speech to speech. A provider is data:
// where it answers, which models hear and speak, what each costs, and how its
// requests and streams are worded, all in its own entry (deepgram.ts,
// openai.ts). One implementation here calls any provider described so; the
// key is an argument, and nothing here reads the environment.

export { DEEPGRAM } from './deepgram.ts'
export { OPENAI } from './openai.ts'
export { base64, mulawed, mulawOf, unbase64 } from './audio.ts'
export { query } from './query.ts'

/** How audio is encoded: an MP3, or raw samples at a rate (`mulaw` is the
 * telephone's 8 kHz μ-law; `linear16` is 16-bit PCM). */
export type Format =
  | { encoding: 'mp3' }
  | { encoding: 'mulaw' | 'linear16'; rate: number }

/** Raw samples at a rate, as a call streams them. */
export type Raw = Extract<Format, { rate: number }>

/** A voice a provider speaks in: the `id` a request names, what a person
 * calls it, and how it sounds. */
export type Voice = { id: string; name: string; about: string }

/** The speeds a provider speaks at, as multiples of its own pace. */
export type Speeds = { min: number; max: number }

/** `speed` as near as `speeds` allows.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(paced({ min: 0.7, max: 1.5 }, 1.3), 1.3)
 * equal(paced({ min: 0.25, max: 1.5 }, 2), 1.5)
 * ```
 */
export let paced = ({ min, max }: Speeds, speed = 1): number =>
  Math.min(max, Math.max(min, speed))

/** A request as a provider words it: the path under its API, and the rest. */
export type Asked = { path: string; init: RequestInit }

/** A provider's HTTP API, its base and key already given. */
export type Ask = (path: string, init?: RequestInit) => Promise<Response>

/** What one message on a turns stream means: the speaker started a turn, or
 * ended one saying `end`, or the stream failed. */
export type Turn = { start?: true; end?: string; error?: string }

/** What one message on a talk stream means. */
export type Said = {
  /** the caller started talking: whatever is playing should stop */
  start?: true
  /** the caller stopped talking, and the model is about to answer */
  stopped?: true
  /** what the caller said, once heard */
  heard?: string
  /** audio the model speaks, in the stream's format */
  audio?: Uint8Array
  /** what the model said, once said */
  said?: string
  /** the model asks for a tool */
  call?: { id: string; name: string; args: string }
  /** what the turn just finished cost, in dollars */
  spent?: number
  /** the model's response ended */
  done?: true
  error?: string
}

/** What a talk stream is set up with. */
export type Setup = {
  model: string
  voice: string
  format: Raw
  /** how fast it speaks, within the talking model's `speeds` */
  speed: number
  instructions: string
  tools: { name: string; description: string; parameters: object }[]
}

/** A speech provider as data. */
export type Provider = {
  name: string
  /** what a person calls it */
  title: string
  /** the HTTP API's base */
  api: string
  /** the streaming API's base */
  live: string
  /** the Authorization header's value for a key */
  authorization: (key: string) => string
  /** the WebSocket subprotocols a browser offers a key under */
  protocols: (key: string) => string[]
  /** a recording heard whole, priced by the minute of audio */
  hear: {
    model: string
    perMinute: number
    request: (audio: BodyInit, type: string, model: string) => Asked
    /** the words in its answer, and the seconds heard if it says */
    read: (said: unknown) => { text: string; seconds?: number }
  }
  /** audio heard as it streams, told back a turn at a time */
  turns: {
    model: string
    perMinute: number
    path: (format: Raw, model: string) => string
    /** what is sent once the stream opens, before any audio */
    opening: (format: Raw, model: string) => string[]
    /** raw samples as the stream carries them */
    audio: (bytes: Uint8Array) => string | Uint8Array
    read: (data: unknown) => Turn
    /** what ends the stream before it closes */
    closing?: string
  }
  /** text spoken, priced by the thousand characters, in `voice` unless
   * another of `voices` is asked for */
  speak: {
    voice: string
    voices: Voice[]
    speeds: Speeds
    perThousand: number
    /** `speed` is within `speeds` */
    request: (
      text: string,
      voice: string,
      format: Format,
      speed: number,
    ) => Asked
    /** what turns its audio into `format`, when it does not speak it */
    audio?: (
      format: Format,
    ) => TransformStream<Uint8Array, Uint8Array> | undefined
  }
  /** a model that hears and speaks in one stream, answering as it goes */
  talk?: {
    /** the models it offers, the fastest first */
    models: string[]
    voice: string
    voices: Voice[]
    speeds: Speeds
    path: (model: string) => string
    opening: (setup: Setup) => string[]
    audio: (bytes: Uint8Array) => string
    /** what one message means, on a stream talking with `model` */
    read: (data: unknown, model: string) => Said[]
    /** a tool's answer given back, and the model asked to go on */
    answer: (call: string, output: string) => string[]
    /** the model asked to say `text` */
    say: (text: string) => string[]
  }
  /** the account's credit left, in dollars, where the provider says */
  balance?: (ask: Ask) => Promise<number>
}

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

/** The provider's API, asked with the key; a refusal is a SpeechError. */
export let asking = (
  { provider, key, fetch: given, signal }: Calling,
): Ask =>
async (path, init = {}) => {
  let response
  try {
    response = await (given ?? globalThis.fetch)(provider.api + path, {
      ...init,
      signal,
      headers: {
        authorization: provider.authorization(key),
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
  o: Calling & {
    text: string
    voice?: string
    format?: Format
    /** a multiple of the provider's pace (`paced`) */
    speed?: number
  },
): Promise<Spoken> => {
  let format = o.format ?? { encoding: 'mp3' }
  let { speak } = o.provider
  let { path, init } = speak.request(
    o.text,
    o.voice ?? speak.voice,
    format,
    paced(speak.speeds, o.speed),
  )
  let response = await asking(o)(path, init)
  if (!response.body) {
    throw new SpeechError(`${o.provider.name} returned no audio`, 502)
  }
  let audio = speak.audio?.(format)
  return {
    body: audio ? response.body.pipeThrough(audio) : response.body,
    type: MEDIA[format.encoding],
    dollars: spoken(o.provider, o.text),
  }
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
  let { hear } = o.provider
  let { path, init } = hear.request(o.audio, o.type, hear.model)
  let said = hear.read(await (await asking(o)(path, init)).json())
  let seconds = said.seconds ?? 0
  return { text: said.text, seconds, dollars: heard(o.provider, seconds) }
}

/** The account's credit left, in dollars, or undefined where the provider
 * does not say. */
export let balance = (o: Calling): Promise<number | undefined> =>
  o.provider.balance?.(asking(o)) ?? Promise.resolve(undefined)

/** The socket a stream speaks over: the platform's WebSocket, or a stand-in. */
export type Socket = {
  send: (data: string | Uint8Array) => void
  close: (code?: number, reason?: string) => void
  addEventListener: (
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ) => void
}

/** How a stream's key is offered: as a header where the platform's sockets
 * take one, else as subprotocols. */
export type Keyed = { authorization: string; protocols: string[] }

/** What makes a stream's socket. */
export type Open = (url: string, key: Keyed) => Socket

let browser: Open = (url, { protocols }) =>
  new WebSocket(url, protocols) as unknown as Socket

// A socket to `url` that holds what is sent until it opens, sends `opening`
// first, and says once if it fails or closes before `close` is asked.
let stream = (
  o: { provider: Provider; key: string; open?: Open },
  url: string,
  opening: string[],
  heard: (data: unknown) => void,
  lost: (reason: string) => void,
) => {
  let socket = (o.open ?? browser)(url, {
    authorization: o.provider.authorization(o.key),
    protocols: o.provider.protocols(o.key),
  })
  let ready = false, closing = false
  let waiting: (string | Uint8Array)[] = [...opening]
  socket.addEventListener('open', () => {
    ready = true
    for (let part of waiting.splice(0)) socket.send(part)
  })
  socket.addEventListener('message', (event) => heard(event.data))
  let dropped = (reason: string) => () => {
    if (!closing) lost(reason)
    closing = true
  }
  socket.addEventListener('close', dropped('the stream closed'))
  socket.addEventListener('error', dropped('the stream failed'))
  return {
    closed: () => closing,
    send: (data: string | Uint8Array) => {
      if (closing) return
      if (ready) socket.send(data)
      else waiting.push(data)
    },
    close: (last?: string) => {
      if (closing) return
      closing = true
      try {
        if (ready && last) socket.send(last)
        socket.close(1000)
      } catch {
        // A socket already gone has nothing more to close.
      }
    },
  }
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

/**
 * Audio heard as it streams, told back a turn at a time (`told`). `send`
 * takes raw samples in `format`; `close` ends the stream and answers how many
 * seconds were heard and what they cost. `open` makes the socket, the
 * platform's WebSocket by default, offering the key as subprotocols.
 */
export let turns = (
  o: {
    provider: Provider
    key: string
    format: Raw
    told: Told
    open?: Open
  },
): Turns => {
  let { turns: t, live } = o.provider
  let bytes = 0
  let s = stream(
    o,
    live + t.path(o.format, t.model),
    t.opening(o.format, t.model),
    (data) => {
      let turn = t.read(data)
      if (turn.start) o.told.start?.()
      if (turn.end) o.told.end(turn.end)
      if (turn.error) o.told.lost?.(turn.error)
    },
    (reason) => o.told.lost?.(reason),
  )
  return {
    send: (audio) => {
      if (s.closed()) return
      bytes += audio.length
      s.send(t.audio(audio))
    },
    close: () => {
      s.close(t.closing)
      let seconds = bytes / perSecond(o.format)!
      return { seconds, dollars: heard(o.provider, seconds, 'turns') }
    },
  }
}

/** What a talk stream tells as the caller and the model speak. */
export type Talked = {
  /** the caller started talking: whatever is playing should stop */
  start?: () => void
  /** the caller stopped talking; the model's answer is on its way */
  stopped?: () => void
  /** what the caller said, once heard */
  heard?: (text: string) => void
  /** audio to play to the caller */
  audio: (bytes: Uint8Array) => void
  /** what the model said, once said */
  said?: (text: string) => void
  /** a tool the model asked for, answered with its output */
  call: (name: string, args: string) => Promise<string>
  /** the model's response ended, whatever it said or asked in it */
  done?: () => void
  /** the stream failed or closed before `close` was asked */
  lost?: (reason: string) => void
}

/** A talk stream: audio in, the model's audio and words out. */
export type Talk = {
  send: (audio: Uint8Array) => void
  /** ask the model to say `text` */
  say: (text: string) => void
  /** end the stream; what it cost */
  close: () => { seconds: number; dollars: number }
}

/**
 * A model that hears and speaks in one stream: `send` takes the caller's raw
 * samples in `format`, and `told` hears what the model says back and the
 * tools it asks for, each answered with its output before it goes on. The
 * provider's `talk` says how; one without it refuses.
 */
export let talk = (
  o: {
    provider: Provider
    key: string
    format: Raw
    model?: string
    voice?: string
    /** a multiple of the provider's pace (`paced`) */
    speed?: number
    instructions: string
    tools?: Setup['tools']
    told: Talked
    open?: Open
  },
): Talk => {
  let t = o.provider.talk
  if (!t) throw new Error(`${o.provider.name} has no model that talks`)
  let model = o.model ?? t.models[0]
  let bytes = 0, dollars = 0
  let s = stream(
    o,
    o.provider.live + t.path(model),
    t.opening({
      model,
      voice: o.voice ?? t.voice,
      format: o.format,
      speed: paced(t.speeds, o.speed),
      instructions: o.instructions,
      tools: o.tools ?? [],
    }),
    (data) => {
      for (let said of t.read(data, model)) {
        if (said.start) o.told.start?.()
        if (said.stopped) o.told.stopped?.()
        if (said.heard) o.told.heard?.(said.heard)
        if (said.audio) o.told.audio(said.audio)
        if (said.said) o.told.said?.(said.said)
        if (said.spent) dollars += said.spent
        if (said.done) o.told.done?.()
        if (said.error) o.told.lost?.(said.error)
        let call = said.call
        if (call) {
          o.told.call(call.name, call.args)
            .catch((error) => `That did not work: ${error?.message ?? error}`)
            .then((output) => {
              for (let m of t.answer(call.id, output)) s.send(m)
            })
        }
      }
    },
    (reason) => o.told.lost?.(reason),
  )
  return {
    send: (audio) => {
      if (s.closed()) return
      bytes += audio.length
      s.send(t.audio(audio))
    },
    say: (text) => {
      for (let m of t.say(text)) s.send(m)
    },
    close: () => {
      s.close()
      return { seconds: bytes / perSecond(o.format)!, dollars }
    },
  }
}
