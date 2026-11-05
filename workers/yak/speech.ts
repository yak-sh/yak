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
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import {
  balance,
  DEEPGRAM,
  type Format,
  hear,
  heard,
  OPENAI,
  type Provider,
  speak,
  spoken,
  type Voice,
} from '@yaks/speech'
import type { Answer } from './apps.ts'
import { caught } from './defects.ts'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { countedSpend, refusedSpend } from './meter.ts'
import { modelAccess } from './models.ts'

/** The providers yaks.app hears and speaks through, and the secret each
 * one's key is in. */
export let SECRETS = new Map<Provider, keyof Env>([
  [DEEPGRAM, 'DEEPGRAM_API_KEY'],
  [OPENAI, 'OPENAI_VOICE_KEY'],
])

/** The provider every app's ./api/speech/ door speaks through, and an
 * Operator speaks in when nobody picked its voice. */
export let PROVIDER = DEEPGRAM

/** A voice an Operator may speak in, with the provider it is one of. */
export type Voiced = Voice & { provider: Provider }

/** Every voice an Operator may speak in, provider by provider. */
export let VOICES: Voiced[] = [...SECRETS.keys()].flatMap((provider) =>
  provider.speak.voices.map((v) => ({ ...v, provider }))
)

/** The voices like a butler's: British, cool and professional. The picker
 * lists them first, and an Operator nobody has picked a voice for speaks in
 * the first. */
export let BUTLERS = ['aura-2-draco-en', 'aura-2-pandora-en']

/** The models that answer an Operator's calls besides a provider's own
 * talking ones: the Operator's own models, the fastest first, which the
 * platform's speech hears and speaks around. */
export let CALL_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5']

/** Every model that may answer `space`'s calls on the providers that are on
 * here, as the picker names them: the Operator's own, then each provider's
 * talking ones. */
export let callModels = (env: Speaking) => [
  { id: CALL_MODELS[0], name: 'Claude Haiku, the quickest to answer' },
  { id: CALL_MODELS[1], name: 'Claude Sonnet, the Operator’s own' },
  ...[...SECRETS.keys()].filter((p) => speechOf(env, p)).flatMap((p) =>
    (p.talk?.models ?? []).map((id) => ({
      id,
      name: `${p.title} ${id}, which hears and speaks itself`,
    }))
  ),
]

/** The voices of the providers that are on here. */
export let voicesOn = (env: Speaking) =>
  VOICES.filter((v) => speechOf(env, v.provider))

/** The voice `space`'s Operator speaks in on a call. */
export let operatorVoice = (space: Pick<Space, 'voice'>) =>
  space.voice ?? BUTLERS[0]

/** The voice named `id`, refused when no provider has one by that id. */
export let voiceOf = (id: string) => {
  let voice = VOICES.find((v) => v.id == id)
  if (!voice) throw new CallError('arguments', 'Pick one of the voices listed.')
  return voice
}

/** Whether `model` is one `provider` hears and speaks with itself. */
export let talks = (provider: Provider, model: string) =>
  provider.talk?.models.includes(model) ?? false

/** The model named `id` for a call in `voice`, refused when it neither
 * answers calls here nor talks in that voice: a provider may speak voices
 * its talking model does not (OpenAI's Fable, Nova and Onyx). */
export let modelOf = (id: string, voice: string) => {
  let { provider } = voiceOf(voice)
  if (CALL_MODELS.includes(id)) return id
  if (
    talks(provider, id) && provider.talk!.voices.some((v) => v.id == voice)
  ) return id
  throw new CallError(
    'arguments',
    VOICES.some((v) => talks(v.provider, id))
      ? 'That model speaks only in its own voices: pick one of them first.'
      : 'Pick one of the models listed.',
  )
}

/** How `space`'s Operator is on a call: the provider it speaks through, its
 * voice, and the model that answers, which hears and speaks itself when it
 * is one of the provider's own (`talks`). */
export let setupOf = (space: Pick<Space, 'voice' | 'voice_model'>) => {
  let voice = VOICES.find((v) => v.id == operatorVoice(space)) ??
    voiceOf(BUTLERS[0])
  let model = space.voice_model ?? CALL_MODELS[0]
  let talk = talks(voice.provider, model) ? voice.provider.talk : undefined
  return {
    provider: voice.provider,
    // A voice its talking model does not speak in gives way to its own.
    voice: !talk || talk.voices.some((v) => v.id == voice.id)
      ? voice.id
      : talk.voice,
    model,
    talks: !!talk,
  }
}

// What every voice's sample says. A new line needs a new SAMPLES prefix, so
// no voice keeps playing the old one.
let SAMPLE =
  'Hello, I’m your Operator. Tell me what you’d like changed, and I’ll get it done.'
let SAMPLES = 'speech/samples/1/'

/** `voice` saying the sample line, as an MP3: spoken once, charged to the
 * space that first asked, and kept in the bucket for every space after. */
export let sampled = async (env: Env, space: Space, voice: string) => {
  let { id, provider } = voiceOf(voice)
  let key = SAMPLES + id + '.mp3'
  let kept = await env.BLOBS.get(key)
  if (kept) return new Uint8Array(await kept.arrayBuffer())
  let said = await speaking(env, space, SAMPLE, { voice, provider })
  let bytes = new Uint8Array(await new Response(said.body).arrayBuffer())
  await env.BLOBS.put(key, bytes)
  return bytes
}

type Speaking =
  & Pick<Env, 'SPEECH_FLOOR' | 'SPEECH_API'>
  & Partial<Record<keyof Env, unknown>>

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

// What stops this much speech in this space, as a refusal: the pilot, or the
// space's budget.
let refused = async (
  env: Env,
  space: Space,
  dollars: number,
  provider: Provider = PROVIDER,
) => {
  let why = await paused(env, provider)
  if (why) throw new ModelError('speech_off', why)
  let fresh = await directoryOf(env.STORE).space(space.slug) ?? space
  let over = refusedSpend(fresh, 'models', env, dollars)
  if (over) throw new ModelError('limit', over)
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
    signal?: AbortSignal
  } = {},
) => {
  let on = speechOf(env, provider)
  if (!on) throw new ModelError('speech_off', 'Speech is not switched on here.')
  await refused(env, space, spoken(on.provider, text), provider)
  let said = await speak({ ...on, ...o, text })
  await countedSpend(env, space, said.dollars, 0)
  return said
}

/** A recording heard for `space`, its minutes charged once heard. */
export let hearing = async (
  env: Env,
  space: Space,
  audio: Uint8Array<ArrayBuffer>,
  type: string,
) => {
  let on = speechOf(env)!
  // Ten seconds' worth before the provider says how long it was.
  await refused(env, space, heard(on.provider, 10))
  let got = await hear({ ...on, audio, type })
  await countedSpend(env, space, got.dollars, 0)
  return got
}

let MAX_TEXT = 2000
let MAX_AUDIO = 25 * 1024 * 1024

/**
 * `./api/speech/speak` and `./api/speech/hear`: an app's page or worker turns
 * text into an MP3 (`{"text", "voice"?}` answered `audio/mpeg`) or a
 * recording into words (the audio posted as it is, answered `{"text",
 * "seconds"}`). Asked by whoever may ask the app's models, and charged to
 * its space.
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
    let audio = new Uint8Array(await req.arrayBuffer())
    if (!type.startsWith('audio/') && !type.startsWith('video/')) {
      return json(400, 'bad_request', 'post the recording with its audio type')
    }
    if (!audio.length || audio.length > MAX_AUDIO) {
      return json(400, 'bad_request', 'post a recording of up to 25 MB')
    }
    let got = await hearing(env, space, audio, type)
    return Response.json({ text: got.text, seconds: got.seconds })
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
