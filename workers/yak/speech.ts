// Speech: yaks.app's one door for hearing and speaking, onto @yaks/speech's
// provider (Deepgram, given as data). The Operator's calls (operator-calls.ts)
// and every app's ./api/speech/ door hear and speak through it, and what each
// costs is charged to the space that asked, from its budget shared with
// models (meter.ts `models`).
//
// The key is the Worker secret DEEPGRAM_API_KEY; unset, speech is off. While
// speech is a pilot, SPEECH_FLOOR is the credit left on the provider's
// account below which every request is refused: its balance at the start
// less what the pilot may spend.
import { ModelError } from '@yaks/model'
import {
  balance,
  DEEPGRAM,
  type Format,
  hear,
  heard,
  speak,
  spoken,
} from '@yaks/speech'
import type { Answer } from './apps.ts'
import { caught } from './defects.ts'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { countedSpend, refusedSpend } from './meter.ts'
import { modelAccess } from './models.ts'

/** The provider yaks.app speaks through. */
export let PROVIDER = DEEPGRAM

type Speaking = Pick<Env, 'DEEPGRAM_API_KEY' | 'SPEECH_FLOOR' | 'SPEECH_API'>

/** The provider and its key, or null where speech is off. */
export let speechOf = (env: Partial<Speaking>) =>
  env.DEEPGRAM_API_KEY
    ? {
      provider: env.SPEECH_API
        ? { ...PROVIDER, api: env.SPEECH_API }
        : PROVIDER,
      key: env.DEEPGRAM_API_KEY,
    }
    : null

// The provider's balance, read at most once a minute per isolate.
let read: { at: number; dollars: Promise<number> } | null = null
let MINUTE = 60_000

/** Why speech is refused here, or null to go ahead: switched off, or the
 * pilot's spending reached (`SPEECH_FLOOR`). A balance that can't be read is
 * reported and lets speech go ahead. */
export let paused = async (
  env: Partial<Speaking>,
  now = Date.now(),
): Promise<string | null> => {
  let on = speechOf(env)
  if (!on) return 'Speech is not switched on here.'
  let floor = Number(env.SPEECH_FLOOR)
  if (!env.SPEECH_FLOOR || !Number.isFinite(floor)) return null
  if (!read || now - read.at > MINUTE) {
    read = { at: now, dollars: balance(on) }
  }
  try {
    return await read.dollars < floor
      ? 'Speech has spent what its pilot may, so it is paused for now.'
      : null
  } catch (error) {
    read = null
    caught(error, { request: 'speech balance' })
    return null
  }
}

/** Forget the balance read, for a test. */
export let unread = () => void (read = null)

// What stops this much speech in this space, as a refusal: the pilot, or the
// space's budget.
let refused = async (env: Env, space: Space, dollars: number) => {
  let why = await paused(env)
  if (why) throw new ModelError('speech_off', why)
  let fresh = await directoryOf(env.STORE).space(space.slug) ?? space
  let over = refusedSpend(fresh, 'models', env, dollars)
  if (over) throw new ModelError('limit', over)
}

/** `text` spoken for `space`: the audio as it streams, charged to the
 * space before it is asked for. */
export let speaking = async (
  env: Env,
  space: Space,
  text: string,
  o: { voice?: string; format?: Format; signal?: AbortSignal } = {},
) => {
  let on = speechOf(env)!
  await refused(env, space, spoken(on.provider, text))
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
      let said = await speaking(env, space, text, { voice })
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
