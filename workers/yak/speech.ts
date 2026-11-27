// Speech: yaks.app's one door for hearing and speaking, onto @yaks/speech's
// providers, each given as data (Deepgram, OpenAI, ElevenLabs). The Operator's calls
// (operator-calls.ts) and every app's ./api/speech/ door hear and speak
// through it, and what each costs is charged to the space that asked, from
// its budget shared with models (meter.ts `models`).
//
// Each provider's key is yaks.app's own, read by the name in SECRETS: a
// connection of the platform's (platform-keys.ts), else a Worker secret of
// that name while it moves over; one with neither is off. While speech is a pilot, SPEECH_FLOOR is the credit left on an account
// that says its balance below which every request to it is refused: its
// balance at the start less what the pilot may spend. OpenAI's says none; its
// project holds it to $10 a month instead.
//
// A provider in OWN is also spoken through with a space's own credential,
// whose account pays, so nothing is charged here: the connection through the
// integration of the same name (@yaks/connections' `elevenlabs`, a pasted
// key), else the sign-in of the service's own MCP server the person
// connected (@yaks/connections/mcp `hostKey`), sent to the provider's API as
// a bearer token. Designing, keeping and cloning voices go through such a
// credential only: their price is not said before they are made, and a voice
// made is kept on the account that made it, which is never the platform's,
// as the account's own voices are listed beside the premade ones.
import type { Scheme } from '@yaks/hook'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import {
  balance,
  base64,
  clone,
  DEEPGRAM,
  design,
  ELEVENLABS,
  type Format,
  hear,
  heard,
  keep,
  type Keyed,
  type Open,
  OPENAI,
  type Provider,
  type Socket,
  speak,
  SpeechError,
  spoken,
  talkerOf,
  type Voice,
  voices,
} from '@yaks/speech'
import type { Offer } from '@yaks/speech/ui'
import type { Ctx as Connecting } from '@yaks/connections'
import type { Bundle } from '@yaks/graph'
import type { Answer } from './apps.ts'
import { bound, caught } from './defects.ts'
import type { Space } from './directory.ts'
import type { Ctx } from './tool.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import { onHold } from './model-spend.ts'
import { size } from '@yaks/fp'
import { modelAccess } from './models.ts'
import { keyed } from './platform-keys.ts'

/** The providers yaks.app hears and speaks through, and the name its own
 * key for each is read by (platform-keys.ts). */
export let SECRETS = new Map<Provider, keyof Env>([
  [DEEPGRAM, 'DEEPGRAM_API_KEY'],
  [OPENAI, 'OPENAI_VOICE_KEY'],
  [ELEVENLABS, 'ELEVENLABS_API_KEY'],
])

/** The providers a space may speak through with a key of its own, by the
 * name of the integration its connection is through. */
export let OWN = new Map<string, Provider>([[ELEVENLABS.name, ELEVENLABS]])

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
 * here (@yaks/speech's `VoiceCard`): a few voices, each with the ways of
 * answering that speak in it, and the ways to answer, each with the one
 * picked now even where it is not among them, so a save never changes it
 * unasked. */
export let offered = (
  env: Speaking,
  space: Pick<Space, 'voice' | 'voice_model' | 'voice_speed' | 'voice_backend'>,
): Offer & { setup: ReturnType<typeof setupOf> } => {
  let setup = setupOf(env, space)
  let ways = WAYS.filter((w) => answers(env, w.model))
  if (!ways.some((w) => w.model == setup.model)) {
    ways.push({
      model: setup.model,
      name: 'As set before',
      about: 'Kept until you pick one of the others.',
    })
  }
  let on = (v: Voiced) => speechOf(env, v.provider)
  let voices = VOICES.filter((v) =>
    on(v) && (OFFERED.includes(v.id) || v.id == setup.voice)
  ).toSorted((a, b) =>
    (OFFERED.indexOf(a.id) + 1 || 99) - (OFFERED.indexOf(b.id) + 1 || 99)
  ).map((v) => ({
    ...v,
    ways: ways.filter((w) => speaks(w.model, v.id)).map((w) => w.model),
    ...BUTLERS.includes(v.id) ? { like: 'a butler' } : {},
  }))
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

/** A provider and the key it is asked with: a space's own connection's
 * (`own`), whose account pays, or the platform's, charged to the space. */
export type Voicing = { provider: Provider; key: string; own: boolean }

/** A space's own credential for a provider: a pasted key, sent as the
 * provider sends one (no `header`), or what the service's MCP server took,
 * sent in the header it names or as a bearer token (null). */
export type Own = { key: string; header?: string | null }

// `provider` asked with `own` the way it is sent.
let sending = (provider: Provider, own: Own): Provider =>
  own.header === undefined ? provider : own.header == null
    ? {
      ...provider,
      header: 'authorization',
      authorization: (key) => `Bearer ${key}`,
    }
    : { ...provider, header: own.header, authorization: (key) => key }

/** `provider` asked with `own`, a space's own credential, else with the
 * platform's key, or null where neither is. */
export let voicing = (
  env: Speaking,
  provider: Provider = PROVIDER,
  own?: Own,
): Voicing | null => {
  if (own) {
    let sent = sending(provider, own)
    return {
      provider: env.SPEECH_API ? { ...sent, api: env.SPEECH_API } : sent,
      key: own.key,
      own: true,
    }
  }
  let on = speechOf(env, provider)
  return on && { ...on, own: false }
}

// The host a provider's API is at, which a credential for it goes to.
let hostOf = (provider: Provider) => new URL(provider.api).host

/** The credential `app` speaks through `provider` with: the key of the
 * connection through it that the app uses (@yaks/connections `used`), else
 * the sign-in of the service's MCP server that `person` granted the app,
 * else that of one connected in the app's `space` for everyone there by
 * someone who owns it, as the space's Operator uses one; undefined where it
 * has none. */
export let appKey = async (
  env: Env,
  app: { eid: string },
  provider: Provider,
  person?: string | null,
  space?: string,
): Promise<Own | undefined> => {
  let { vaulted } = await import('./vault.ts')
  if (!vaulted(env)) return undefined
  let { CONNECTION, credential, grantedTo, used } = await import(
    '@yaks/connections'
  )
  let { comp, ctxOf } = await import('./connections.ts')
  let c = ctxOf(env)
  let r = (await used(c, app.eid)).find((r) =>
    comp(r.connection, CONNECTION).integration == provider.name
  )
  let key = r && await credential(c, r.connection.entity.eid)
  if (key) return { key }
  let { hostKey } = await import('@yaks/connections/mcp')
  let granted = person
    ? await grantedTo(c.graph.read, { app: app.eid, person })
    : []
  return await hostKey(c, granted, hostOf(provider)) ??
    (space
      ? await hostKey(c, await everyones(c, space), hostOf(provider))
      : undefined)
}

// The MCP servers connected in `space` for everyone there by someone who
// owns it (@yaks/connections/mcp `sharing`).
let everyones = async (c: Pick<Connecting, 'graph'>, space: string) => {
  let { line } = await import('@yaks/query')
  let { comp } = await import('./connections.ts')
  let owner = (r: Bundle) => String(comp(r, 'mcp_server').owner)
  let shared = await c.graph.read(
    line`.mcp_server.space=${space}&.mcp_server.everyone=true&*`,
  )
  if (!shared.length) return []
  let owning = new Set(
    (await c.graph.read(
      line`.member.space=${space}&.member.person=${[
        ...new Set(shared.map(owner)),
      ]}&.member.role=owner&*`,
    )).map((m) => String(comp(m, 'member').person)),
  )
  return shared.filter((r) => owning.has(owner(r)))
}

/** The credential the Operator speaks through `provider` with for `person`:
 * the key of the connection through it they hold, or their space's when
 * they own it (connections.ts `ownConnection`), else the sign-in of the
 * service's MCP server they connected in that space. */
export let ownKey = async (
  env: Env,
  ctx: Pick<Ctx, 'person' | 'dir'>,
  space: Pick<Space, 'eid'>,
  provider: Provider,
): Promise<Own | undefined> => {
  let { vaulted } = await import('./vault.ts')
  if (!vaulted(env) || !ctx.person) return undefined
  let { credential } = await import('@yaks/connections')
  let { hostKey, reachedIn } = await import('@yaks/connections/mcp')
  let { ctxOf, ownConnection } = await import('./connections.ts')
  let c = ctxOf(env)
  let b = await ownConnection(env, ctx, space, provider.name)
  let key = b && await credential(c, b.entity.eid)
  if (key) return { key }
  let { line } = await import('@yaks/query')
  let servers = await c.graph.read(
    line`.mcp_server.owner=${ctx.person}&*`,
  )
  return await hostKey(
    c,
    servers.filter((r) => reachedIn(r, space.eid)),
    hostOf(provider),
  )
}

let OWN_ONLY =
  'Designing, keeping and cloning voices needs your own ElevenLabs account: sign in to it, or paste its key, at your space’s connections, and the voices are kept there.'

/** `on`, where it is a space's own key: refused otherwise, since making a
 * voice is priced by nobody before it is made, and kept on the account. */
export let making = (on: Voicing | null): Voicing => {
  if (!on?.own) throw new ModelError('speech_own', OWN_ONLY)
  return on
}

/** `provider` and its key, or null where it is off. */
export let speechOf = (env: Speaking, provider: Provider = PROVIDER) => {
  // By name: a copy of a provider aimed elsewhere (SPEECH_API) is the same.
  let secret = [...SECRETS].find(([p]) => p.name == provider.name)?.[1]
  let key = secret && env[secret]
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
  env = await keyed(env)
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
// (model-spend.ts `onHold`), and it is charged what it cost, kept under
// `person`, whose work it is, if anybody's.
let charged = async <T extends { dollars: number }>(
  env: Charging,
  space: Space,
  most: number,
  provider: Provider | undefined,
  work: () => Promise<T>,
  person?: string,
) => {
  let why = await paused(env, provider)
  if (why) throw new ModelError('speech_off', why)
  return await onHold(env, space, most, 'models', async (spent) => {
    let done = await work()
    spent(done.dollars)
    return done
  }, { source: 'voice', person })
}

/** `text` spoken for `space` through `provider` (the platform's by
 * default): the audio as it streams, charged to the space before it is asked
 * for, the work of `person`, if anybody's. */
export let speaking = async (
  env: Env,
  space: Space,
  text: string,
  { provider, key, person, ...o }: {
    provider?: Provider
    /** a space's own key for `provider`, whose account pays, sent as
     * `provider` sends it (a `Voicing`'s) */
    key?: string
    /** the person whose work it is (model-spend.ts `Paying`) */
    person?: string
    voice?: string
    format?: Format
    speed?: number
    signal?: AbortSignal
  } = {},
) => {
  env = await keyed(env)
  let on = voicing(env, provider, key ? { key } : undefined)
  if (!on) throw new ModelError('speech_off', 'Speech is not switched on here.')
  if (on.own) return await speak({ ...on, ...o, text })
  return await charged(
    env,
    space,
    spoken(on.provider, text),
    provider,
    () => speak({ ...on, ...o, text }),
    person,
  )
}

/** A recording heard for `space`, its minutes charged once heard, on a hold
 * of `seconds` of them (ten, unless the caller guesses longer) until the
 * provider says how long it was. `audio` may be a stream, sent as it is read.
 * Its dollars are kept under `person`, whose work it is, if anybody's. */
export let hearing = async (
  env: Charging,
  space: Space,
  audio: BodyInit,
  type: string,
  seconds = 10,
  person?: string,
) => {
  env = await keyed(env)
  let on = speechOf(env)
  if (!on) throw new ModelError('speech_off', 'Speech is not switched on here.')
  return await charged(
    env,
    space,
    heard(on.provider.hear, seconds),
    undefined,
    () => hear({ ...on, audio, type }),
    person,
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

// Each door under ./api/speech/: its method, and the provider it asks unless
// another is named (none: the platform's).
let DOORS = new Map<string, { method: string; provider?: string }>([
  ['/speech/speak', { method: 'POST' }],
  ['/speech/hear', { method: 'POST' }],
  ['/speech/voices', { method: 'GET' }],
  ['/speech/design', { method: 'POST', provider: ELEVENLABS.name }],
  ['/speech/voice', { method: 'POST', provider: ELEVENLABS.name }],
])

let OFF = 'speech is not switched on here'

// Why an app's ask has no provider, answered.
let refused = (json: Parameters<Answer>[0]['json'], why: string) =>
  why == OFF ? json(503, 'speech_off', why) : json(400, 'bad_request', why)

/** The provider an app asks, named or else the one `voice` is of, else the
 * platform's, with the key it asks it with: the app's own credential for it
 * (`appKey`, for `person` asking), else the platform's; or why there is
 * none. */
let appVoicing = async (
  env: Env,
  app: { eid: string },
  space: string,
  person: string | null,
  name?: string,
  voice?: string,
): Promise<Voicing | string> => {
  let provider = name == undefined
    ? VOICES.find((v) => v.id == voice)?.provider ?? PROVIDER
    : OWN.get(name) ?? [...SECRETS.keys()].find((p) => p.name == name)
  if (!provider) {
    return `no provider is called ${name}: name one of ${
      [...new Set([...SECRETS.keys()].map((p) => p.name))].join(', ')
    }`
  }
  let own = OWN.has(provider.name)
    ? await appKey(env, app, provider, person, space)
    : undefined
  let on = voicing(env, provider, own)
  if (on) return on
  return OWN.has(provider.name)
    ? `connect ${provider.title} at the space's connections and have this app use it, or sign in with your ${provider.title} account there for everyone in the space`
    : OFF
}
// The most of a recording posted to the door it reads whole, which a
// recording kept at ./api/blob is not (hearings.ts).
let MAX_AUDIO = 25 * 1024 * 1024

/**
 * `./api/speech/*` (and `./api/speech/listen`, listen.ts, beside it): an
 * app's page or worker speaks, hears and finds voices, asked by whoever may
 * ask the app's models.
 *
 * - `POST speak` turns `{"text", "voice"?, "provider"?}` into the audio,
 *   answered `audio/mpeg`; posting that to ./api/blob keeps it.
 * - `POST hear` turns a recording into words: the audio posted as it is,
 *   answered `{"text", "turns", "seconds"}`, or `{"blob"}` the address of
 *   one the app keeps, heard in its store (hearings.ts `asking`).
 * - `GET voices?provider=` lists the voices it may speak in.
 * - `POST design` with `{"description", "text"?}` answers
 *   `{"designs": [{id, audio, type, seconds}]}`, each sample's audio base64.
 * - `POST voice` keeps a design, `{"design", "name", "description"}`, or
 *   clones one from recordings posted as a form (`name`, `description`?,
 *   `files`), answering `{"voice"}`, its id.
 *
 * A provider is the platform's (Deepgram) unless `provider` names another;
 * design and voice are ElevenLabs'. A provider in OWN is asked with the key
 * of the connection through it that the app uses, charged to that account,
 * else with the platform's, charged to the space; design and voice take the
 * app's own key only.
 */
export let speechDoor: Answer = async (asked) => {
  let { req, path, space, app, json } = asked
  let env = await keyed(asked.env)
  let route = DOORS.get(path)
  if (!route) return null
  if (req.method != route.method) return json(405, 'method_not_allowed')
  let denied = await modelAccess(asked)
  if (denied) return denied
  // Asked with a space's own key: what its provider refuses is its account's
  // to answer, said back rather than reported here.
  let own = false
  let named = path == '/speech/speak'
    ? undefined
    : new URL(req.url).searchParams.get('provider') ?? route.provider
  try {
    if (path == '/speech/speak') {
      let body = await req.json().catch(() => null) as
        | { text?: unknown; voice?: unknown; provider?: unknown }
        | null
      let text = typeof body?.text == 'string' ? body.text.trim() : ''
      if (!text || text.length > MAX_TEXT) {
        return json(
          400,
          'bad_request',
          `post {"text": "<up to ${MAX_TEXT} characters>"}, and a "voice" ` +
            'and "provider" if not the default',
        )
      }
      let voice = typeof body?.voice == 'string' ? body.voice : undefined
      let on = await appVoicing(
        env,
        app,
        space.eid,
        asked.who.person ?? null,
        typeof body?.provider == 'string' ? body.provider : undefined,
        voice,
      )
      if (typeof on == 'string') return refused(json, on)
      own = on.own
      let spoke = await speaking(env, space, text, {
        voice,
        provider: on.provider,
        ...on.own ? { key: on.key } : {},
        person: asked.who.person ?? undefined,
      })
      return new Response(spoke.body, {
        headers: { 'content-type': spoke.type },
      })
    }
    let on = await appVoicing(
      env,
      app,
      space.eid,
      asked.who.person ?? null,
      named,
    )
    if (typeof on == 'string') return refused(json, on)
    own = on.own
    if (path == '/speech/voices') {
      return Response.json({
        provider: on.provider.name,
        voices: (await voices(on)).filter((v) => on.own || !v.custom),
      })
    }
    if (path == '/speech/design') {
      let body = await req.json().catch(() => null) as
        | { description?: unknown; text?: unknown }
        | null
      let description = typeof body?.description == 'string'
        ? body.description.trim()
        : ''
      if (!description) {
        return json(
          400,
          'bad_request',
          'post {"description": "<how the voice sounds>"}, and the "text" ' +
            'its samples say (100 to 1000 characters) if not words it picks',
        )
      }
      let designs = await design({
        ...making(on),
        description,
        ...typeof body?.text == 'string' ? { text: body.text } : {},
      })
      return Response.json({
        designs: designs.map((d) => ({ ...d, audio: base64(d.audio) })),
      })
    }
    if (path == '/speech/voice') {
      let mine = making(on)
      let type = req.headers.get('content-type') ?? ''
      if (type.startsWith('multipart/form-data')) {
        let form = await req.formData()
        let name = String(form.get('name') ?? '').trim()
        let samples = form.getAll('files').filter((f) => f instanceof Blob)
        if (!name || !samples.length) {
          return json(
            400,
            'bad_request',
            'post a form with the voice\'s "name" and its recordings as "files"',
          )
        }
        let description = String(form.get('description') ?? '') || undefined
        return Response.json({
          voice: await clone({ ...mine, name, samples, description }),
        })
      }
      let body = await req.json().catch(() => null) as
        | { design?: unknown; name?: unknown; description?: unknown }
        | null
      let [d, name, description] = [body?.design, body?.name, body?.description]
      if (
        typeof d != 'string' || typeof name != 'string' ||
        typeof description != 'string' || !d || !name.trim()
      ) {
        return json(
          400,
          'bad_request',
          'post {"design", "name", "description"} to keep a design, or a ' +
            'form with "name" and "files" to clone a voice',
        )
      }
      return Response.json({
        voice: await keep({
          ...mine,
          design: d,
          name: name.trim(),
          description,
        }),
      })
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
    let most = Math.min(MAX_AUDIO, on.provider.hear.bytes)
    if (Number(req.headers.get('content-length') ?? 0) > most) {
      return json(413, 'too_large', posted(most))
    }
    let audio = new Uint8Array(await req.arrayBuffer())
    if (audio.length > most) return json(413, 'too_large', posted(most))
    if (!audio.length) return json(400, 'bad_request', 'post a recording')
    let got = on.own ? await hear({ ...on, audio, type }) : await hearing(
      env,
      space,
      audio,
      type,
      undefined,
      asked.who.person ?? undefined,
    )
    return Response.json({
      text: got.text,
      turns: got.turns,
      seconds: got.seconds,
    })
  } catch (error) {
    if (error instanceof ModelError) {
      return json(
        error.code == 'limit' ? 402 : error.code == 'speech_own' ? 403 : 503,
        error.code,
        error.message,
      )
    }
    // The provider refusing what was asked of it: its reason, said back.
    if (own && error instanceof SpeechError && !error.retry) {
      return json(
        error.status == 401 ? 403 : 400,
        'speech_refused',
        error.message,
      )
    }
    caught(error, {
      request: 'POST /api' + path,
      space: space.slug,
      app: app.slug,
    })
    return json(502, 'speech_failed', 'speech did not answer; try again')
  }
}
