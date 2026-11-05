// Deepgram: Nova-3 hears a recording, Flux hears a call and knows when a
// speaker's turn ends, Aura-2 speaks. It has no model that talks, so a call
// runs on it as hearing and speaking around another model. Prices are its
// pay-as-you-go list, 2026-11-05.
// https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
// https://developers.deepgram.com/reference/text-to-speech/speak-request
// https://developers.deepgram.com/docs/flux/quickstart
import type { Format, Provider, Turn } from './mod.ts'
import { query } from './query.ts'

let encoded = (format: Format) =>
  format.encoding == 'mp3'
    ? { encoding: 'mp3' }
    : { encoding: format.encoding, sample_rate: format.rate }

type Listened = {
  metadata?: { duration?: number }
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
}

type Info = {
  type?: string
  event?: string
  transcript?: string
  description?: string
}

/**
 * What one message from Flux means: a turn starting, a turn ended with its
 * words, or nothing to act on.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { DEEPGRAM } from '@yaks/speech'
 * let read = DEEPGRAM.turns.read
 * equal(read('{"type":"TurnInfo","event":"EndOfTurn","transcript":"Hi"}'), {
 *   end: 'Hi',
 * })
 * equal(read('{"type":"TurnInfo","event":"StartOfTurn"}'), { start: true })
 * equal(read('{"type":"TurnInfo","event":"Update"}'), {})
 * ```
 */
let turnOf = (data: unknown): Turn => {
  let info: Info
  try {
    info = JSON.parse(String(data))
  } catch {
    return {}
  }
  if (info.type == 'Error') return { error: String(info.description) }
  if (info.type != 'TurnInfo') return {}
  if (info.event == 'StartOfTurn') return { start: true }
  if (info.event == 'EndOfTurn') return { end: info.transcript?.trim() ?? '' }
  return {}
}

export let DEEPGRAM: Provider = {
  name: 'deepgram',
  title: 'Deepgram',
  api: 'https://api.deepgram.com',
  live: 'wss://api.deepgram.com',
  authorization: (key) => `token ${key}`,
  protocols: (key) => ['token', key],
  hear: {
    model: 'nova-3',
    perMinute: 0.0043,
    request: (audio, type, model) => ({
      path: `/v1/listen?${query({ model, smart_format: 'true' })}`,
      init: { method: 'POST', headers: { 'content-type': type }, body: audio },
    }),
    read: (said) => {
      let { metadata, results } = said as Listened
      return {
        text: results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '',
        seconds: metadata?.duration ?? 0,
      }
    },
  },
  turns: {
    model: 'flux-general-en',
    perMinute: 0.0077,
    path: (format, model) =>
      `/v2/listen?${query({ model, ...encoded(format) })}`,
    opening: () => [],
    audio: (bytes) => bytes,
    read: turnOf,
    closing: JSON.stringify({ type: 'CloseStream' }),
  },
  speak: {
    voice: 'aura-2-thalia-en',
    // Aura-2's English voices, as its voice list describes them.
    // https://developers.deepgram.com/docs/tts-models
    voices: [
      {
        id: 'aura-2-amalthea-en',
        name: 'Amalthea',
        about: 'feminine, Filipino, engaging, natural, cheerful',
      },
      {
        id: 'aura-2-andromeda-en',
        name: 'Andromeda',
        about: 'feminine, American, casual, expressive, comfortable',
      },
      {
        id: 'aura-2-apollo-en',
        name: 'Apollo',
        about: 'masculine, American, confident, comfortable, casual',
      },
      {
        id: 'aura-2-arcas-en',
        name: 'Arcas',
        about: 'masculine, American, natural, smooth, clear, comfortable',
      },
      {
        id: 'aura-2-aries-en',
        name: 'Aries',
        about: 'masculine, American, warm, energetic, caring',
      },
      {
        id: 'aura-2-asteria-en',
        name: 'Asteria',
        about: 'feminine, American, clear, confident, knowledgeable, energetic',
      },
      {
        id: 'aura-2-athena-en',
        name: 'Athena',
        about: 'feminine, American, calm, smooth, professional',
      },
      {
        id: 'aura-2-atlas-en',
        name: 'Atlas',
        about:
          'masculine, American, enthusiastic, confident, approachable, friendly',
      },
      {
        id: 'aura-2-aurora-en',
        name: 'Aurora',
        about: 'feminine, American, cheerful, expressive, energetic',
      },
      {
        id: 'aura-2-callista-en',
        name: 'Callista',
        about: 'feminine, American, clear, energetic, professional, smooth',
      },
      {
        id: 'aura-2-cora-en',
        name: 'Cora',
        about: 'feminine, American, smooth, melodic, caring',
      },
      {
        id: 'aura-2-cordelia-en',
        name: 'Cordelia',
        about: 'feminine, American, approachable, warm, polite',
      },
      {
        id: 'aura-2-delia-en',
        name: 'Delia',
        about: 'feminine, American, casual, friendly, cheerful, breathy',
      },
      {
        id: 'aura-2-draco-en',
        name: 'Draco',
        about: 'masculine, British, warm, approachable, trustworthy, baritone',
      },
      {
        id: 'aura-2-electra-en',
        name: 'Electra',
        about: 'feminine, American, professional, engaging, knowledgeable',
      },
      {
        id: 'aura-2-harmonia-en',
        name: 'Harmonia',
        about: 'feminine, American, empathetic, clear, calm, confident',
      },
      {
        id: 'aura-2-helena-en',
        name: 'Helena',
        about: 'feminine, American, caring, natural, positive, friendly, raspy',
      },
      {
        id: 'aura-2-hera-en',
        name: 'Hera',
        about: 'feminine, American, smooth, warm, professional',
      },
      {
        id: 'aura-2-hermes-en',
        name: 'Hermes',
        about: 'masculine, American, expressive, engaging, professional',
      },
      {
        id: 'aura-2-hyperion-en',
        name: 'Hyperion',
        about: 'masculine, Australian, caring, warm, empathetic',
      },
      {
        id: 'aura-2-iris-en',
        name: 'Iris',
        about: 'feminine, American, cheerful, positive, approachable',
      },
      {
        id: 'aura-2-janus-en',
        name: 'Janus',
        about: 'feminine, American, Southern, smooth, trustworthy',
      },
      {
        id: 'aura-2-juno-en',
        name: 'Juno',
        about: 'feminine, American, natural, engaging, melodic, breathy',
      },
      {
        id: 'aura-2-jupiter-en',
        name: 'Jupiter',
        about: 'masculine, American, expressive, knowledgeable, baritone',
      },
      {
        id: 'aura-2-luna-en',
        name: 'Luna',
        about: 'feminine, American, friendly, natural, engaging',
      },
      {
        id: 'aura-2-mars-en',
        name: 'Mars',
        about: 'masculine, American, smooth, patient, trustworthy, baritone',
      },
      {
        id: 'aura-2-minerva-en',
        name: 'Minerva',
        about: 'feminine, American, positive, friendly, natural',
      },
      {
        id: 'aura-2-neptune-en',
        name: 'Neptune',
        about: 'masculine, American, professional, patient, polite',
      },
      {
        id: 'aura-2-odysseus-en',
        name: 'Odysseus',
        about: 'masculine, American, calm, smooth, comfortable, professional',
      },
      {
        id: 'aura-2-ophelia-en',
        name: 'Ophelia',
        about: 'feminine, American, expressive, enthusiastic, cheerful',
      },
      {
        id: 'aura-2-orion-en',
        name: 'Orion',
        about: 'masculine, American, approachable, comfortable, calm, polite',
      },
      {
        id: 'aura-2-orpheus-en',
        name: 'Orpheus',
        about:
          'masculine, American, professional, clear, confident, trustworthy',
      },
      {
        id: 'aura-2-pandora-en',
        name: 'Pandora',
        about: 'feminine, British, smooth, calm, melodic, breathy',
      },
      {
        id: 'aura-2-phoebe-en',
        name: 'Phoebe',
        about: 'feminine, American, energetic, warm, casual',
      },
      {
        id: 'aura-2-pluto-en',
        name: 'Pluto',
        about: 'masculine, American, smooth, calm, empathetic, baritone',
      },
      {
        id: 'aura-2-saturn-en',
        name: 'Saturn',
        about: 'masculine, American, knowledgeable, confident, baritone',
      },
      {
        id: 'aura-2-selene-en',
        name: 'Selene',
        about: 'feminine, American, expressive, engaging, energetic',
      },
      {
        id: 'aura-2-thalia-en',
        name: 'Thalia',
        about: 'feminine, American, clear, confident, energetic, enthusiastic',
      },
      {
        id: 'aura-2-theia-en',
        name: 'Theia',
        about: 'feminine, Australian, expressive, polite, sincere',
      },
      {
        id: 'aura-2-vesta-en',
        name: 'Vesta',
        about: 'feminine, American, natural, expressive, patient, empathetic',
      },
      {
        id: 'aura-2-zeus-en',
        name: 'Zeus',
        about: 'masculine, American, deep, trustworthy, smooth',
      },
    ],
    perThousand: 0.030,
    request: (text, voice, format) => ({
      path: `/v1/speak?${
        query({
          model: voice,
          ...encoded(format),
          ...format.encoding == 'mp3' ? {} : { container: 'none' },
        })
      }`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    }),
  },
  balance: async (ask) => {
    let { projects } = await (await ask('/v1/projects')).json() as {
      projects?: { project_id: string }[]
    }
    let total = 0
    for (let { project_id } of projects ?? []) {
      let { balances } = await (await ask(
        `/v1/projects/${project_id}/balances`,
      )).json() as { balances?: { amount?: number }[] }
      for (let b of balances ?? []) total += b.amount ?? 0
    }
    return total
  },
}
