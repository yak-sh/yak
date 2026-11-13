// Speech: yaks.app's one door for hearing and speaking, onto @yaks/speech's
// providers, each given as data (Deepgram, OpenAI). The Operator's calls
// (operator-calls.ts) and every app's ./api/speech/ door hear and speak
// through it, and what each costs is charged to the space that asked, from
// its budget shared with models (meter.ts `models`).
//
// Each provider's key is a Worker secret of its own (SECRETS); one unset is
// off. While speech is a pilot, SPEECH_FLOOR is the credit left on an account
// that says its balance below which every request to it is refused: its
// balance at the start less what the pilot may spend. OpenAI's says none; its
// project holds it to $10 a month instead.
import type { Scheme } from '@yaks/hook'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import {
  balance,
  DEEPGRAM,
  type Format,
  hear,
  heard,
  type Keyed,
  type Open,
  OPENAI,
  type Provider,
  type Socket,
  speak,
  spoken,
  talkerOf,
  type Voice,
} from '@yaks/speech'
import type { Answer } from './apps.ts'
import { bound, caught } from './defects.ts'
import type { Space } from './directory.ts'
import type { Namespace } from './door.ts'
import type { Env } from './env.ts'
import { onHold } from './model-spend.ts'
import { size } from './meter.ts'
import { modelAccess } from './models.ts'

/** The providers yaks.app hears and speaks through, and the secret each
 * one's key is in. */
export let SECRETS = new Map<Provider, keyof Env>([
  [DEEPGRAM, 'DEEPGRAM_API_KEY'],
  [OPENAI, 'OPENAI_VOICE_KEY'],
])

/** The providers whose own line carries calls sent to them over SIP
 * (operator-carried.ts), the secret their webhook is signed with, and how. */
export let LINES = new Map<Provider, { secret: keyof Env; scheme: Scheme }>([
  [OPENAI, { secret: 'OPENAI_CALLS_SECRET', scheme: 'standard' }],
])

/** The provider every app's ./api/speech/ door speaks through. */
export let PROVIDER = DEEPGRAM

/** A voice an Operator may speak in, with the provider it is one of. */
export type Voiced = Voice & { provider: Provider }

/** Every voice an Operator may speak in, provider by provider. */
export let VOICES: Voiced[] = [...SECRETS.keys()].flatMap((provider) =>
  provider.speak.voices.map((v) => ({ ...v, provider }))
)

/** The voices like a butler's: British, cool and professional. The picker
 * lists them first, and an Operator nobody has picked a voice for speaks in
 * the first when the way it answers is not a talking model, which speaks in
 * its provider's own voice. */
export let BUTLERS = ['aura-2-draco-en', 'aura-2-pandora-en']

/** The models that answer an Operator's calls besides a provider's own
 * talking ones: the Operator's own models, the fastest first, which the
 * platform's speech hears and speaks around. */
export let CALL_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5']

/** How a call may be answered, in the words the settings page says it to
 * someone who isn't technical: the model, and what choosing it means. */
export type Way = { model: string; name: string; about: string }

// The ways the settings page offers, the quickest first. A model a provider
// talks with is offered only where that provider is on. The quickest on here
// is what nobody picked (`setupOf`).
let WAYS: Way[] = [
  {
    model: 'gpt-realtime-2.1-mini',
    name: 'Quickest',
    about:
      'Replies almost at once, like talking with a person. Speaks only in some of the voices.',
  },
  {
    model: 'gpt-live-1',
    name: 'Conversational',
    about:
      'Listens while it talks, so you can cut in or stop to think, like talking with a person. Speaks only in some of the voices, at its own pace.',
  },
  {
    model: CALL_MODELS[0],
    name: 'Quick',
    about: 'Replies after a short pause.',
  },
  {
    model: CALL_MODELS[1],
    name: 'Thorough',
    about:
      'Pauses a few seconds before each reply, and handles harder requests better.',
  },
]

/** Who a talking model hands a hard request to on a call, in the settings
 * page's words: the Operator itself, through `ask`, or a larger model run on
 * the voice's own provider's side, offered the Operator's tools
 * (operator-calls.ts). The Operator is what nobody picked. */
export type Backend = { id: string; name: string; about: string }

export let BACKENDS: Backend[] = [
  {
    id: 'operator',
    name: 'Your Operator',
    about:
      'Hands it to your Operator, with everything it knows of you and every tool it has.',
  },
  {
    id: 'gpt-6-luna',
    name: 'OpenAI’s quick model',
    about:
      'Answers on OpenAI’s side with your Operator’s tools, and hands bigger work to your Operator.',
  },
  {
    id: 'gpt-6-sol',
    name: 'OpenAI’s larger model',
    about:
      'Like the quick one, a little slower, and better at harder requests.',
  },
]

/** The backend named `id`, refused when there is none by that id. */
export let backendOf = (id: string) => {
  let backend = BACKENDS.find((b) => b.id == id)
  if (!backend) {
    throw new CallError('arguments', 'Pick one of the ways listed.')
  }
  return backend
}

/** How fast an Operator speaks on a call, in the settings page's words: a
 * multiple of each provider's own pace, which each holds within the speeds
 * it has (@yaks/speech `paced`). Normal is what nobody picked. */
export type Pace = { id: string; name: string; about: string; speed: number }

export let PACES: Pace[] = [
  {
    id: 'relaxed',
    name: 'Relaxed',
    about: 'Unhurried, at the voice’s own pace.',
    speed: 1,
  },
  { id: 'normal', name: 'Normal', about: 'A little quicker.', speed: 1.15 },
  {
    id: 'brisk',
    name: 'Brisk',
    about: 'Quick and to the point, like an assistant on the move.',
    speed: 1.3,
  },
]

/** The pace named `id`, refused when there is none by that id. */
export let paceOf = (id: string) => {
  let pace = PACES.find((p) => p.id == id)
  if (!pace) throw new CallError('arguments', 'Pick one of the speeds listed.')
  return pace
}

// The voices the settings page offers, the butler-like ones first.
let OFFERED = [...BUTLERS, 'cedar', 'marin', 'ash', 'coral']

/** Whether `model` can speak in the voice `id`: the Operator's own models
 * speak every voice, a talking model only its provider's own. */
export let speaks = (model: string, id: string) =>
  CALL_MODELS.includes(model) ||
  VOICES.some((v) =>
    v.id == id &&
    !!talkerOf(v.provider, model)?.voices.some((t) => t.id == id)
  )

/** What the settings page offers for `space`'s calls on the providers on
 * here: a few voices and the ways to answer, each with the one picked now
 * even where it is not among them, so a save never changes it unasked. */
export let offered = (
  env: Speaking,
  space: Pick<Space, 'voice' | 'voice_model' | 'voice_speed' | 'voice_backend'>,
) => {
  let setup = setupOf(env, space)
  let on = (v: Voiced) => speechOf(env, v.provider)
  let voices = VOICES.filter((v) =>
    on(v) && (OFFERED.includes(v.id) || v.id == setup.voice)
  ).toSorted((a, b) =>
    (OFFERED.indexOf(a.id) + 1 || 99) - (OFFERED.indexOf(b.id) + 1 || 99)
  )
  let ways = WAYS.filter((w) => answers(env, w.model))
  if (!ways.some((w) => w.model == setup.model)) {
    ways.push({
      model: setup.model,
      name: 'As set before',
      about: 'Kept until you pick one of the others.',
    })
  }
  // A larger model on OpenAI's side only where OpenAI is on.
  let backends = BACKENDS.filter((b) =>
    b.id == 'operator' || !!speechOf(env, OPENAI)
  )
  return { setup, voices, ways, paces: PACES, backends }
}

/** What an Operator may set its call settings to, one line a property of
 * its persona's `speech{}` (@yaks/speech), in the ids it holds: the choices
 * its settings page offers. */
export let choices = (
  env: Speaking,
  space: Pick<Space, 'voice' | 'voice_model' | 'voice_speed' | 'voice_backend'>,
) => {
  let { voices, ways, paces, backends } = offered(env, space)
  let list = (xs: { id: string; name: string }[]) =>
    xs.map((x) => `${x.id} (${x.name})`).join(', ')
  return [
    `voice: ${list(voices)}`,
    `pace: ${list(paces)}`,
    `model: ${list(ways.map((w) => ({ id: w.model, name: w.name })))}`,
    `backend: ${list(backends)}`,
  ].join('\n')
}

/** The voice named `id`, refused when no provider has one by that id. */
export let voiceOf = (id: string) => {
  let voice = VOICES.find((v) => v.id == id)
  if (!voice) throw new CallError('arguments', 'Pick one of the voices listed.')
  return voice
}

/** Whether `model` answers calls on here: the Operator's own always, a
 * talking model where its provider is on. */
let answers = (env: Speaking, model: string) =>
  CALL_MODELS.includes(model) ||
  VOICES.some((v) => !!speechOf(env, v.provider) && talks(v.provider, model))

/** Whether `model` is one `provider` hears and speaks with itself. */
export let talks = (provider: Provider, model: string) =>
  !!talkerOf(provider, model)

/** The model named `id` for a call in `voice`, refused when it neither
 * answers calls here nor talks in that voice: a provider may speak voices
 * its talking model does not (OpenAI's Fable, Nova and Onyx). */
export let modelOf = (id: string, voice: string) => {
  voiceOf(voice)
  if (speaks(id, voice)) return id
  throw new CallError(
    'arguments',
    VOICES.some((v) => talks(v.provider, id))
      ? 'That way of answering can’t speak in this voice: pick another voice, or another way.'
      : 'Pick one of the ways listed.',
  )
}

/** How `space`'s Operator is on a call on here: the provider it speaks
 * through, its voice, how fast it speaks, and the model that answers, which
 * hears and speaks itself when it is one of the provider's own (`talks`).
 * Nothing picked is Normal, answered the quickest way on here that speaks
 * the voice picked, in its own voice when none was. */
export let setupOf = (
  env: Speaking,
  space: Pick<Space, 'voice' | 'voice_model' | 'voice_speed' | 'voice_backend'>,
) => {
  let pace = PACES.find((p) => p.id == space.voice_speed) ?? paceOf('normal')
  let model = space.voice_model ??
    WAYS.find((w) =>
      answers(env, w.model) && (!space.voice || speaks(w.model, space.voice))
    )!.model
  let own = VOICES.map((v) => talkerOf(v.provider, model)).find(Boolean)?.voice
  let voice = VOICES.find((v) => v.id == (space.voice ?? own ?? BUTLERS[0])) ??
    voiceOf(BUTLERS[0])
  let talk = talkerOf(voice.provider, model)
  return {
    provider: voice.provider,
    // A voice its talking model does not speak in gives way to its own.
    voice: !talk || talk.voices.some((v) => v.id == voice.id)
      ? voice.id
      : talk.voice,
    pace: pace.id,
    speed: pace.speed,
    model,
    talks: !!talk,
    /** it hears and speaks at once, taking its own turns */
    duplex: !!talk?.duplex,
    // Who its talking model hands a hard request to, where it can hand one
    // to a larger model on its provider's side (operator-calls.ts).
    backend: BACKENDS.find((b) => b.id == space.voice_backend)?.id ??
      'operator',
  }
}

// What every voice's sample says, kept by voice and pace. A new line needs a
// new SAMPLES prefix, so no voice keeps playing the old one.
let SAMPLE =
  'Hello, I’m your Operator. Tell me what you’d like changed, and I’ll get it done.'
let SAMPLES = 'speech/samples/1/'

/** `voice` saying the sample line at `pace`, as an MP3: spoken once, charged
 * to the space that first asked, and kept in the bucket for every space
 * after. Relaxed is the voice's own pace, kept where samples always were. */
export let sampled = async (
  env: Env,
  space: Space,
  voice: string,
  pace = 'relaxed',
) => {
  let { id, provider } = voiceOf(voice)
  let { speed } = paceOf(pace)
  let key = SAMPLES + id + (speed == 1 ? '' : `-${pace}`) + '.mp3'
  let kept = await env.BLOBS.get(key)
  if (kept) return new Uint8Array(await kept.arrayBuffer())
  let said = await speaking(env, space, SAMPLE, { voice, provider, speed })
  let bytes = new Uint8Array(await new Response(said.body).arrayBuffer())
  await env.BLOBS.put(key, bytes)
  return bytes
}

export type Speaking =
  & Pick<Env, 'SPEECH_FLOOR' | 'SPEECH_API'>
  & Partial<Record<keyof Env, unknown>>

/** What speech is charged from: its keys, and the directory that holds the
 * space's budget. */
export type Charging = Speaking & { STORE: Namespace }

/** `provider` and its key, or null where it is off. */
export let speechOf = (env: Speaking, provider: Provider = PROVIDER) => {
  let key = env[SECRETS.get(provider)!]
  return typeof key == 'string' && key
    ? {
      provider: env.SPEECH_API
        ? { ...provider, api: env.SPEECH_API }
        : provider,
      key,
    }
    : null
}

// Each provider's balance, read at most once a minute per isolate, and what
// the newest reading that came back said: whether speech through it was under
// the floor. A reading older than a minute answers at once while the next is
// read, so only an isolate's first ask of a provider waits on it. A reading
// that failed is null, and one the provider gives none for undefined: both
// let speech go ahead.
let read = new Map<
  string,
  { at: number; dollars: Promise<number | null | undefined> }
>()
let last = new Map<string, { at: number; under: boolean }>()
let PAUSED = 'Speech has spent what its pilot may, so it is paused for now.'
let MINUTE = 60_000

let reading = (
  on: NonNullable<ReturnType<typeof speechOf>>,
  provider: Provider,
  now: number,
) => {
  let r: { at: number; dollars: Promise<number | null | undefined> } = {
    at: now,
    dollars: balance(on).catch((error) => {
      if (read.get(provider.name) == r) read.delete(provider.name)
      caught(error, { request: 'speech balance', provider: provider.name })
      return null
    }),
  }
  read.set(provider.name, r)
  return r.dollars
}

/** Why speech through `provider` is refused here, or null to go ahead:
 * switched off, or the pilot's spending reached (`SPEECH_FLOOR`). A balance
 * that can't be read is reported and lets speech go ahead. */
export let paused = async (
  env: Speaking,
  provider: Provider = PROVIDER,
  now = Date.now(),
): Promise<string | null> => {
  let on = speechOf(env, provider)
  if (!on) return 'Speech is not switched on here.'
  let floor = Number(env.SPEECH_FLOOR)
  if (!provider.balance || !env.SPEECH_FLOOR || !Number.isFinite(floor)) {
    return null
  }
  let under = (dollars: number | null | undefined) =>
    (dollars ?? Infinity) < floor
  let had = read.get(provider.name)
  if (had && now - had.at <= MINUTE) {
    return under(await had.dollars) ? PAUSED : null
  }
  let held = last.get(provider.name)
  let asked = reading(on, provider, now)
  asked.then((dollars) => {
    let newest = last.get(provider.name)
    if (dollars !== null && (!newest || newest.at <= now)) {
      last.set(provider.name, { at: now, under: under(dollars) })
    }
  })
  if (held) return held.under ? PAUSED : null
  return under(await asked) ? PAUSED : null
}

/** That speech through `provider` went ahead at `at` elsewhere (a call the
 * Worker let ring through, operator-calls.ts `reached`): what this isolate
 * says until its own reading of the balance comes back. */
export let passed = (at: number, provider: Provider = PROVIDER) => {
  let newest = last.get(provider.name)
  if (!newest || newest.at < at) last.set(provider.name, { at, under: false })
}

/** Forget the balances read, for a test. */
export let unread = () => {
  read.clear()
  last.clear()
}

// Speech for `space` while the pilot lets it, on a hold of the most it can
// cost: the space's budget refuses it in the directory's own transaction
// (model-spend.ts `onHold`), and it is charged what it cost.
let charged = async <T extends { dollars: number }>(
  env: Charging,
  space: Space,
  most: number,
  provider: Provider | undefined,
  work: () => Promise<T>,
) => {
  let why = await paused(env, provider)
  if (why) throw new ModelError('speech_off', why)
  return await onHold(env, space, most, 'models', async (spent) => {
    let done = await work()
    spent(done.dollars)
    return done
  }, 'voice')
}

/** `text` spoken for `space` through `provider` (the platform's by
 * default): the audio as it streams, charged to the space before it is asked
 * for. */
export let speaking = async (
  env: Env,
  space: Space,
  text: string,
  { provider, ...o }: {
    provider?: Provider
    voice?: string
    format?: Format
    speed?: number
    signal?: AbortSignal
  } = {},
) => {
  let on = speechOf(env, provider)
  if (!on) throw new ModelError('speech_off', 'Speech is not switched on here.')
  return await charged(
    env,
    space,
    spoken(on.provider, text),
    provider,
    () => speak({ ...on, ...o, text }),
  )
}

/** A recording heard for `space`, its minutes charged once heard, on a hold
 * of `seconds` of them (ten, unless the caller guesses longer) until the
 * provider says how long it was. `audio` may be a stream, sent as it is read. */
export let hearing = async (
  env: Charging,
  space: Space,
  audio: BodyInit,
  type: string,
  seconds = 10,
) => {
  let on = speechOf(env)
  if (!on) throw new ModelError('speech_off', 'Speech is not switched on here.')
  return await charged(
    env,
    space,
    heard(on.provider.hear, seconds),
    undefined,
    () => hear({ ...on, audio, type }),
  )
}

// What a failure in a socket's listener is reported with.
type Tags = Record<string, string>

/** A socket the runtime hands a Worker, which carries frames once accepted. */
export type Upgraded = Socket & { accept: () => void }

/** `socket`, each of its listeners run, and reporting with `tags`, in the
 * invocation that opened it: its events come from the runtime after the
 * request was answered. */
export let tied = (socket: Socket, tags: Tags): Socket => ({
  send: (data) => socket.send(data),
  close: (code, reason) => socket.close(code, reason),
  addEventListener: (type, f) => socket.addEventListener(type, bound(f, tags)),
})

/**
 * A provider's stream as Workers open one: a fetch with `Upgrade`, which also
 * carries the key as the request's Authorization rather than subprotocols,
 * its events tied to the invocation with `tags`. What is sent before it opens
 * waits in @yaks/speech's stream.
 */
export let upgrading =
  (tags: Tags): Open => (url: string, { authorization }: Keyed) => {
    let on: Record<string, ((event: { data?: unknown }) => void)[]> = {}
    let fire = (type: string, event: { data?: unknown } = {}) =>
      on[type]?.forEach((f) => f(event))
    let ws: Upgraded | undefined
    // Closed before it opened: closed as it opens.
    let closed: [number?, string?] | undefined
    fetch(url.replace(/^wss:/, 'https:'), {
      headers: { upgrade: 'websocket', authorization },
    }).then((res) => {
      let socket = (res as Response & { webSocket?: Upgraded }).webSocket
      if (!socket) throw new Error(`the stream answered ${res.status}`)
      socket.accept()
      if (closed) return socket.close(...closed)
      ws = socket
      for (let type of ['message', 'close', 'error'] as const) {
        socket.addEventListener(
          type,
          (event) => fire(type, event as { data?: unknown }),
        )
      }
      fire('open')
    }).catch(() => fire('error'))
    return tied({
      send: (data) => ws?.send(data),
      close: (code, reason) =>
        ws ? ws.close(code, reason) : void (closed = [code, reason]),
      addEventListener: (type, f) => void (on[type] ??= []).push(f),
    }, tags)
  }

// What a recording posted past `most` bytes is told.
let posted = (most: number) =>
  `post a recording of up to ${size(most)}, or keep a longer one at ` +
  './api/blob and post {"blob": "<its url>"}'

let MAX_TEXT = 2000
// The most of a recording posted to the door it reads whole, which a
// recording kept at ./api/blob is not (hearings.ts).
let MAX_AUDIO = 25 * 1024 * 1024

/**
 * `./api/speech/speak` and `./api/speech/hear` (and `./api/speech/listen`,
 * listen.ts, beside it): an app's page or worker turns
 * text into an MP3 (`{"text", "voice"?}` answered `audio/mpeg`) or a
 * recording into words: the audio posted as it is, answered `{"text",
 * "turns", "seconds"}`, or `{"blob"}` the address of one the app keeps, heard
 * in its store (hearings.ts `asking`). Asked by whoever may ask the app's
 * models, and charged to its space.
 */
export let speechDoor: Answer = async (asked) => {
  let { env, req, path, space, app, json } = asked
  if (path != '/speech/speak' && path != '/speech/hear') return null
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  let denied = await modelAccess(asked)
  if (denied) return denied
  if (!speechOf(env)) {
    return json(503, 'speech_off', 'speech is not switched on here')
  }
  try {
    if (path == '/speech/speak') {
      let body = await req.json().catch(() => null) as
        | { text?: unknown; voice?: unknown }
        | null
      let text = typeof body?.text == 'string' ? body.text.trim() : ''
      if (!text || text.length > MAX_TEXT) {
        return json(
          400,
          'bad_request',
          `post {"text": "<up to ${MAX_TEXT} characters>"}, and a "voice" ` +
            'if not the default',
        )
      }
      let voice = typeof body?.voice == 'string' ? body.voice : undefined
      // A voice names its provider; one no provider has is the default's.
      let provider = VOICES.find((v) => v.id == voice)?.provider
      let said = await speaking(env, space, text, { voice, provider })
      return new Response(said.body, { headers: { 'content-type': said.type } })
    }
    let type = req.headers.get('content-type') ?? ''
    if (type.startsWith('application/json')) {
      let { asking } = await import('./hearings.ts')
      let body = await req.json().catch(() => null) as { blob?: unknown }
      return await asking(asked, body?.blob)
    }
    if (!type.startsWith('audio/') && !type.startsWith('video/')) {
      return json(400, 'bad_request', 'post the recording with its audio type')
    }
    let most = Math.min(MAX_AUDIO, speechOf(env)!.provider.hear.bytes)
    if (Number(req.headers.get('content-length') ?? 0) > most) {
      return json(413, 'too_large', posted(most))
    }
    let audio = new Uint8Array(await req.arrayBuffer())
    if (audio.length > most) return json(413, 'too_large', posted(most))
    if (!audio.length) return json(400, 'bad_request', 'post a recording')
    let got = await hearing(env, space, audio, type)
    return Response.json({
      text: got.text,
      turns: got.turns,
      seconds: got.seconds,
    })
  } catch (error) {
    if (error instanceof ModelError) {
      return json(error.code == 'limit' ? 402 : 503, error.code, error.message)
    }
    caught(error, {
      request: 'POST /api' + path,
      space: space.slug,
      app: app.slug,
    })
    return json(502, 'speech_failed', 'speech did not answer; try again')
  }
}
