// Speech to text, text to speech, and speech to speech. A provider is data:
// where it answers, which models hear and speak, what each costs, and how its
// requests and streams are worded, all in its own entry (deepgram.ts,
// openai.ts). One implementation here calls any provider described so; the
// key is an argument, and nothing here reads the environment.

export { DEEPGRAM } from './deepgram.ts'
export { OPENAI } from './openai.ts'
export { base64, mulawed, mulawOf, sounds, trimmed, unbase64 } from './audio.ts'
export { query } from './query.ts'
import { sounds, trimmed } from './audio.ts'

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
  /** the caller started talking */
  start?: true
  /** the caller stopped talking, and the model is about to answer */
  stopped?: true
  /** what the caller said, once heard: nothing, when no words were */
  heard?: string
  /** the next of the caller's words, heard as they talk */
  hearing?: string
  /** audio the model speaks, in the stream's format */
  audio?: Uint8Array
  /** what the model said, once said */
  said?: string
  /** the next of the model's words, said as it speaks */
  saying?: string
  /** the stream takes what is sent after its opening from now on, held
   * until then */
  ready?: true
  /** the model hands work to whoever runs the call, by this id: what the
   * caller asked is in their words so far */
  delegated?: string
  /** the model asks for a tool */
  call?: { id: string; name: string; args: string }
  /** what the turn just finished cost, in dollars */
  spent?: number
  /** the model's audio began playing to the caller, on a call its own line
   * carries */
  plays?: true
  /** the model began a response: no other may be asked for until it is done */
  begun?: true
  /** the model's response ended */
  done?: true
  /** the response last asked for was refused, one being under way: ask
   * again once it is done */
  busy?: true
  error?: string
}

/** What a talk stream is set up with. */
export type Setup = {
  model: string
  voice: string
  /** none on a call the provider's own line carries, which says its own */
  format?: Raw
  /** how fast it speaks, within the talking model's `speeds` */
  speed: number
  instructions: string
  tools: { name: string; description: string; parameters: object }[]
  /** a larger model a duplex model hands its work to on the provider's
   * side, one of its `backends`, told `instructions` and calling `tools`
   * through `told.call`; without one, the work goes to whoever runs the
   * call (`told.delegate`) */
  backend?: Backend
}

/** A larger model a duplex model hands its work to on the provider's side. */
export type Backend = {
  model: string
  instructions: string
  tools: Setup['tools']
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
  /** the models that hear and speak in one stream, answering as they go */
  talk?: Talker[]
  /** the account's credit left, in dollars, where the provider says */
  balance?: (ask: Ask) => Promise<number>
}

/** Models that hear and speak in one stream, as their provider words it. */
export type Talker = {
  /** the models it offers, the fastest first */
  models: string[]
  voice: string
  voices: Voice[]
  speeds: Speeds
  path: (model: string) => string
  opening: (setup: Setup) => string[]
  audio: (bytes: Uint8Array) => string
  /** what one message means, on a stream talking with `model`, handing its
   * work to `backend` where it has one */
  read: (data: unknown, model: string, backend?: string) => Said[]
  /** a tool's answer given back, or a delegation's */
  answer: (call: string, output: string) => string[]
  /** something the model is told mid-stream, for what it says next,
   * answered by nothing */
  tell: (text: string) => string[]
  /** calls its own line carries, such as one sent to it over SIP: their
   * audio never passes here, and a stream joins one to hear and steer it */
  calls?: {
    /** a webhook's event that a call rang: its id and the headers it came
     * with, their names lower case; undefined for any other event */
    rang: (
      event: unknown,
    ) => { id: string; headers: Record<string, string> } | undefined
    /** pick a call up, talking as `setup` says */
    accept: (call: string, setup: Setup) => Asked
    reject: (call: string) => Asked
    hangup: (call: string) => Asked
    /** the path of the stream that joins a call */
    join: (call: string) => string
    /** what stops the audio playing to the caller */
    hush: string
  }
} & (Turned | Duplex)

/** A model that takes a turn when asked: here is said when the caller's
 * turn ended, and when to stop. */
export type Turned = {
  duplex?: undefined
  /** the model asked for a response: to say `text`, or without it to go
   * on, asking for `tools` alone when they are given */
  respond: (text?: string, tools?: Setup['tools']) => string
  /** what stops the response under way */
  cancel: string
  /** what ends the caller's turn now, before the model hears it end */
  commit: string
}

/** A model that hears and speaks at once, as a person on the phone does,
 * and takes its own turns: it hears when the caller is done and yields when
 * they talk over it, sending its audio as it is said, quiet and all. Its
 * tools are whoever runs the call, which it hands work to (`delegated`). */
export type Duplex = {
  duplex: true
  /** what a minute of the stream costs */
  perMinute: number
  /** the model asked to say `text` now */
  say: (text: string) => string[]
  /** the larger models it hands its work to on the provider's side
   * (`Setup.backend`), the quickest first */
  backends: string[]
  /** a backend's tool call answered, and its work let go on */
  result: (call: string, output: string) => string[]
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
  /** the seconds heard so far, and what they cost */
  spent: () => { seconds: number; dollars: number }
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
  let body = audio ? response.body.pipeThrough(audio) : response.body
  return {
    // A call's sentences are each a clip: none pauses for the provider's
    // padding around it (`trimmed`).
    body: format.encoding == 'mulaw'
      ? body.pipeThrough(trimmed(format.rate))
      : body,
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
    listener: (event: { data?: unknown; code?: number }) => void,
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
  lost: (reason: string, clean?: boolean) => void,
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
  let dropped = (reason: string) => (event?: { code?: number }) => {
    if (!closing) lost(reason, event?.code == 1000 || event?.code == 1001)
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
  let spent = () => {
    let seconds = bytes / perSecond(o.format)!
    return { seconds, dollars: heard(o.provider, seconds, 'turns') }
  }
  return {
    send: (audio) => {
      if (s.closed()) return
      bytes += audio.length
      s.send(t.audio(audio))
    },
    spent,
    close: () => {
      s.close(t.closing)
      return spent()
    },
  }
}

/** What a talk stream tells as the caller and the model speak. */
export type Talked = {
  /** the caller talked over the model: whatever is playing should stop */
  over?: () => void
  /** the caller stopped talking, `ago` seconds before now (none: now); the
   * model's answer is on its way */
  stopped?: (ago?: number) => void
  /** what the caller said, once heard */
  heard?: (text: string) => void
  /** audio to play to the caller */
  audio: (bytes: Uint8Array) => void
  /** what the model said, once said */
  said?: (text: string) => void
  /** a tool the model asked for, answered with its output */
  call: (name: string, args: string) => Promise<string>
  /** work a duplex model handed over: what the caller asked, in their
   * words, answered with what to tell them */
  delegate?: (request: string) => Promise<string>
  /** the model's response ended, whatever it said or asked in it */
  done?: () => void
  /** the model's audio began playing, on a call its own line carries */
  plays?: () => void
  /** the call a joined stream steers ended: its stream closed cleanly */
  ended?: () => void
  /** the stream failed or closed before `close` was asked */
  lost?: (reason: string) => void
  /** a duplex model refused something it was sent, its stream still open */
  refused?: (reason: string) => void
}

/** A talk stream: audio in, the model's audio and words out. */
export type Talk = {
  send: (audio: Uint8Array) => void
  /** ask the model to say `text` */
  say: (text: string) => void
  /** tell the model something it knows from now on, saying nothing of it */
  tell: (text: string) => void
  /** the seconds heard so far, and what the stream cost */
  spent: () => { seconds: number; dollars: number }
  /** end the stream; what it cost */
  close: () => { seconds: number; dollars: number }
}

// What a caller says to show they are listening, not to be heard: a sound
// of these alone, while the model speaks, lets it go on.
let FILLERS = new Set(
  'ah aha alright cool fine good gotcha great ha haha hm hmm huh mhm mm mmhm nice oh ok okay right sure uh uhhuh um wow yeah yep yes yup'
    .split(' '),
)

// The words a sentence goes on after: articles, prepositions, conjunctions,
// possessives, "is", and the fillers of a caller thinking.
let ON = new Set(
  'a an the to of for with from into at by and or but because if my your our their is ah er hm hmm mm uh um'
    .split(' '),
)

let words = (text: string) =>
  text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, ''))
    .filter(Boolean)

/** How many of `text`'s words say something, the `FILLERS` aside.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { meant } from '@yaks/speech'
 * equal(meant(' Okay. Ha. Cool, uh'), 0)
 * equal(meant('Okay, hold on'), 2)
 * ```
 */
export let meant = (text: string): number =>
  words(text).filter((w) => !FILLERS.has(w)).length

/** Whether `text` stops where a sentence goes on: on a comma or a dash, or
 * on a word a sentence goes on after (`ON`: "the", "to", "is", "um"). A caller
 * heard to stop there has more to say.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { open } from '@yaks/speech'
 * let lines = ['My address is', 'So what I need is, um', 'Okay,', 'Okay.',
 *   'Forty-two Elm Street.', 'Can you come out tomorrow?', '']
 * equal(lines.map(open), [true, true, true, false, false, false, false])
 * ```
 */
export let open = (text: string): boolean => {
  let w = words(text)
  return !!w.length && (/[,\-–—…]\s*$/.test(text) || ON.has(w.at(-1)!))
}

// The words a caller says over the model before it stops: fewer, or only
// fillers, and it goes on. Two say "wait, stop" or "hold on".
let OVER = 2

// The seconds a caller is quiet before their turn ends, when the model has
// not heard it end: it waits on some whole sentences, and on a lone "Okay.".
// One going on ("Okay, so…") is mostly talking again by then.
let QUIET = 0.7

// The seconds a turn left unanswered waits for more before it is answered,
// longer than a caller's pause to think.
let LONG = 5

// The stream's own tool: the model asks for it to say nothing while the
// caller has more to say.
let LISTEN = {
  name: 'listen',
  description:
    'Say nothing and keep listening: the caller stopped partway through what they are saying, cut off mid-sentence, trailing off to think, or with only an um or uh. They have more to say.',
  parameters: { type: 'object', properties: {} },
}

/** How a talking model is set up: its model, voice, pace, instructions and
 * tools, each its provider's own where none is given. */
export type Talking = {
  model?: string
  voice?: string
  /** a multiple of the provider's pace (`paced`) */
  speed?: number
  instructions: string
  tools?: Setup['tools']
  /** a duplex model's larger model on the provider's side (`Setup.backend`) */
  backend?: Backend
}

type Calls = NonNullable<Talker['calls']>

/** The entry of `provider`'s that talks with `model`, or with its first
 * model when none is given, if any. */
export let talkerOf = (
  provider: Provider,
  model?: string,
): Talker | undefined =>
  model == undefined
    ? provider.talk?.[0]
    : provider.talk?.find((t) => t.models.includes(model))

let talker = (provider: Provider, model?: string): Talker => {
  let t = talkerOf(provider, model)
  if (!t) {
    throw new Error(`${provider.name} has no model ${model ?? ''} that talks`)
  }
  return t
}

// The stream's own `LISTEN` comes first among a turned model's tools; a
// duplex model's tools are whoever runs the call.
let setup = (
  t: Talker,
  o: Talking,
  format?: Raw,
): Setup => ({
  model: o.model ?? t.models[0],
  voice: o.voice ?? t.voice,
  format,
  speed: paced(t.speeds, o.speed),
  instructions: o.instructions,
  tools: t.duplex ? [] : [LISTEN, ...o.tools ?? []],
  ...t.duplex && o.backend ? { backend: o.backend } : {},
})

let carrier = (provider: Provider, model?: string): Calls => {
  let calls = talker(provider, model).calls
  if (!calls) throw new Error(`${provider.name}'s line carries no calls`)
  return calls
}

let calling = async (o: Calling, { path, init }: Asked): Promise<void> => {
  await asking(o)(path, init)
}

/** A call the provider's own line carries picked up, its model set up as
 * `talk` sets one up; `talk` with the `call` then joins it. */
export let accept = (
  o: Calling & Talking & { call: string },
): Promise<void> =>
  calling(
    o,
    carrier(o.provider, o.model).accept(
      o.call,
      setup(talker(o.provider, o.model), o),
    ),
  )

/** A call the provider's own line carries, refused before it is picked up. */
export let reject = (o: Calling & { call: string }): Promise<void> =>
  calling(o, carrier(o.provider).reject(o.call))

/** A call the provider's own line carries, ended. */
export let hangup = (o: Calling & { call: string }): Promise<void> =>
  calling(o, carrier(o.provider).hangup(o.call))

/**
 * A model that hears and speaks in one stream: `send` takes the caller's raw
 * samples in `format`, and `told` hears what the model says back and the
 * tools it asks for, each answered with its output before it goes on. The
 * provider's `talk` entry for `model` says how (its first model by default);
 * one without it refuses.
 *
 * A `Duplex` model takes its own turns and hands its work to
 * `told.delegate`: everything below is for a `Turned` one, which takes a
 * turn as it is told here.
 *
 * A caller who talks over the model stops it (`over`) once their words say
 * something (`meant`): an "okay", a laugh, or a noise, lets it go on. The
 * model writes its audio faster than it is said, so what it says is mostly
 * still playing, its response long done, when the caller talks.
 *
 * The caller's turn ends when the model hears it end, or once they are
 * `QUIET`, and is answered. What the model says to it waits for the caller's
 * words, and is never said when they stopped where a sentence goes on
 * (`open`), when the model asks to `LISTEN`, or when the caller talks again
 * before it plays. A turn left unanswered is answered once they have been
 * quiet `LONG`.
 *
 * Given a `call` its own line carries, picked up with `accept`, the stream
 * joins that call instead: the caller's audio and the model's go over the
 * line, never through `send` or `told.audio`, and what plays is stopped on
 * the line; `told.plays` says when the model's audio begins, and
 * `told.ended` when the call ends. Its audio never heard here, a turn ends
 * only when the model hears it end, and what the model says plays before
 * the turn's words are heard.
 */
export let talk = (
  o: Talking & {
    provider: Provider
    key: string
    /** the caller's audio, on a stream that carries it */
    format?: Raw
    /** the call a stream joins, one the provider's own line carries */
    call?: string
    told: Talked
    open?: Open
  },
): Talk => {
  let t = talker(o.provider, o.model)
  return t.duplex ? duplexed(o, t) : turned(o, t)
}

/** What a talk stream is opened with. */
type Talks = Parameters<typeof talk>[0]

// A model that takes a turn when asked: the caller's turn is ended, each
// response asked for, and the response stopped when they talk over it, here.
let turned = (o: Talks, t: Talker & Turned): Talk => {
  let set = setup(t, o, o.format)
  let model = set.model
  let joined = o.call == undefined ? undefined : carrier(o.provider, model)
  let seconds = (bytes: number) => o.format ? bytes / perSecond(o.format)! : 0
  let bytes = 0, dollars = 0
  // The model answers one response at a time: one asked for while another is
  // under way waits for it to be done. `last` is the one asked for last, asked
  // again if it was refused; waiting asks to go on are one.
  let busy = false, last: string | undefined
  let waiting: string[] = [], goOn = t.respond()
  // What the caller has said since they started talking, whether it stopped
  // the model, and whether the response it stopped is still sending audio.
  let hearing = '', over = false, hushed = false
  // Whether the caller's turn ended, whether they spoke since it last did,
  // and for how many seconds their audio has been quiet. `heard` is their
  // words last heard; `unheard`, that the turn's are still to come.
  let ended = true, spoke = false, quiet = 0, heard = '', unheard = false
  // The ask for the turn's answer while it is not yet played or asked of a
  // tool, and whether the turn was left unanswered. What the model says while
  // the turn's words are `unheard` is `held`: each thing to do once they are,
  // and to do instead if it is never said.
  let pending: string | undefined, unanswered = false
  let held: { run: () => void; drop?: () => void }[] | undefined
  let out = (run: () => void, drop?: () => void) =>
    held ? held.push({ run, drop }) : run()
  let end = () => {
    if (ended) return
    ended = true
    if (spoke) spoke = false, unheard = true
    if (unheard) held = []
    o.told.stopped?.()
    if (!unheard && open(heard)) return void (unanswered = true)
    ask(pending = goOn)
  }
  let soon = () => {
    if (!ended && quiet >= QUIET) s.send(t.commit), end()
    if (unanswered && quiet >= LONG) {
      unanswered = false
      ask(pending = t.respond(undefined, o.tools ?? []))
    }
  }
  // The turn's answer is not said: what is held is dropped, the ask still
  // waiting is not sent, and the response under way is stopped.
  let withdraw = () => {
    for (let h of held ?? []) h.drop?.()
    let m = pending!
    held = pending = undefined
    if (waiting.includes(m)) waiting.splice(waiting.indexOf(m), 1)
    else if (busy && last == m) s.send(t.cancel), hushed = true
    if (joined) s.send(joined.hush)
  }
  let ask = (m: string) => {
    if (m != goOn || !waiting.includes(m)) waiting.push(m)
    next()
  }
  let next = () => {
    if (busy || !waiting.length) return
    busy = true
    s.send(last = waiting.shift()!)
  }
  let s = stream(
    o,
    o.provider.live + (joined ? joined.join(o.call!) : t.path(model)),
    joined ? [] : t.opening(set),
    (data) => {
      for (let said of t.read(data, model)) {
        if (said.start) {
          if (pending) withdraw()
          hearing = '', over = ended = unanswered = false, spoke = true
        }
        // Their words still heard once their turn ended are its own.
        if (said.hearing) hearing += said.hearing
        if (said.hearing && !ended && !over && meant(hearing) >= OVER) {
          over = true
          if (busy) s.send(t.cancel), hushed = true
          if (joined) s.send(joined.hush)
          o.told.over?.()
        }
        if (said.stopped) end()
        if (said.heard != undefined) {
          if (said.heard) o.told.heard?.(said.heard)
          heard = said.heard, unheard = false
          if (pending && open(heard)) withdraw(), unanswered = true
          let h = held ?? []
          held = undefined
          for (let { run } of h) run()
        }
        let audio = said.audio
        if (audio && !hushed) {
          out(() => (pending = undefined, o.told.audio(audio)))
        }
        let text = said.said
        if (text) out(() => o.told.said?.(text))
        if (said.plays) o.told.plays?.()
        if (said.spent) dollars += said.spent
        if (said.begun) {
          busy = true
          if (hushed) s.send(t.cancel)
        }
        if (said.busy && last) waiting.unshift(last), busy = true
        if (said.done) {
          out(() => o.told.done?.(), () => o.told.done?.())
          busy = hushed = false
          next()
        }
        if (said.error) o.told.lost?.(said.error)
        let call = said.call
        if (call?.name == LISTEN.name) {
          if (pending) withdraw(), unanswered = true
          for (let m of t.answer(call.id, 'Listening.')) s.send(m)
        } else if (call) {
          let answer = (output: string, more = true) => {
            for (let m of t.answer(call.id, output)) s.send(m)
            if (more) ask(goOn)
          }
          out(() => {
            pending = undefined
            o.told.call(call.name, call.args)
              .catch((error) => `That did not work: ${error?.message ?? error}`)
              .then(answer)
          }, () => answer('Not asked: they went on talking.', false))
        }
      }
    },
    (reason, clean) =>
      joined && clean ? o.told.ended?.() : o.told.lost?.(reason),
  )
  return {
    send: (audio) => {
      if (s.closed() || !o.format) return
      bytes += audio.length
      s.send(t.audio(audio))
      if (!sounds(audio, o.format)) {
        quiet += seconds(audio.length)
        return soon()
      }
      // Talking again before the answer plays, the caller is not done.
      quiet = 0
      if (pending) withdraw(), ended = false
    },
    say: (text) => ask(t.respond(text)),
    tell: (text) => {
      for (let m of t.tell(text)) s.send(m)
    },
    spent: () => ({ seconds: seconds(bytes), dollars }),
    close: () => {
      s.close()
      return { seconds: seconds(bytes), dollars }
    },
  }
}

// A model that hears and speaks at once and takes its own turns, so nothing
// here ends a turn, asks for a response or stops one: what is left is
// keeping the words each side says as lines, timing each answer from the
// caller's last sound, and doing the work it hands over. Its audio comes as
// it is said, quiet included, and plays as it comes.
let duplexed = (o: Talks, t: Talker & Duplex): Talk => {
  let format = o.format
  if (!format || o.call != undefined) {
    throw new Error(`${o.provider.name}'s duplex model joins no call`)
  }
  let set = setup(t, o, format)
  if (set.backend && !t.backends.includes(set.backend.model)) {
    throw new Error(
      `${o.provider.name}'s ${set.model} hands no work to ${set.backend.model}`,
    )
  }
  // The stream's seconds and what its backend's work cost.
  let bytes = 0, backed = 0
  // Each side's words since the other last spoke, and the caller's since the
  // model last handed work over.
  let hearing = '', saying = '', asked = ''
  // Whether the caller made a sound since the model last began to, and for
  // how many seconds they have been quiet.
  let spoke = false, quiet = 0
  let heard = () => {
    let text = hearing.trim()
    hearing = ''
    if (text) o.told.heard?.(text), asked += ' ' + text
  }
  let said = () => {
    let text = saying.trim()
    saying = ''
    if (text) o.told.said?.(text), o.told.done?.()
  }
  // What is sent before the stream is ready, sent once it is.
  let held: string[] | undefined = []
  let send = (m: string) => held ? held.push(m) : s.send(m)
  let s = stream(
    o,
    o.provider.live + t.path(set.model),
    t.opening(set),
    (data) => {
      for (let x of t.read(data, set.model, set.backend?.model)) {
        if (x.ready && held) { for (let m of held.splice(0)) s.send(m) }
        if (x.ready) held = undefined
        if (x.hearing) said(), hearing += x.hearing
        if (x.saying) heard(), saying += x.saying
        if (x.audio) {
          if (spoke && sounds(x.audio, format)) {
            spoke = false
            o.told.stopped?.(quiet)
          }
          o.told.audio(x.audio)
        }
        // One refused event leaves the stream open: a stream that failed
        // closes, and is lost.
        if (x.error) o.told.refused?.(x.error)
        if (x.spent) backed += x.spent
        let call = x.call
        if (call) {
          Promise.resolve(o.told.call(call.name, call.args))
            .catch((error) => `That did not work: ${error?.message ?? error}`)
            .then((output) => t.result(call.id, output).forEach(send))
        }
        let id = x.delegated
        if (id) {
          heard(), said()
          let request = asked.trim()
          asked = ''
          Promise.resolve(o.told.delegate?.(request))
            .catch((error) => `That did not work: ${error?.message ?? error}`)
            .then((output) => {
              if (output) t.answer(id, output).forEach(send)
            })
        }
      }
    },
    (reason) => o.told.lost?.(reason),
  )
  let spent = () => {
    let seconds = bytes / perSecond(format)!
    return { seconds, dollars: seconds / 60 * t.perMinute + backed }
  }
  return {
    send: (audio) => {
      if (s.closed()) return
      bytes += audio.length
      send(t.audio(audio))
      if (sounds(audio, format)) spoke = true, quiet = 0
      else quiet += audio.length / perSecond(format)!
    },
    say: (text) => t.say(text).forEach(send),
    tell: (text) => t.tell(text).forEach(send),
    spent,
    close: () => {
      heard(), said()
      s.close()
      return spent()
    },
  }
}
