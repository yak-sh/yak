// Deepgram: Nova-3 hears a recording or a stream and tells its speakers
// apart, Flux hears a call and knows when a speaker's turn ends, Aura-2
// speaks. It has no model that talks, so a call runs on it as hearing and
// speaking around another model. Flux tells no speakers apart. Prices are its
// pay-as-you-go list, 2026-11-05; telling a recording's speakers apart is in
// its price, a stream's is $0.0020 a minute more (2026-11-13).
// https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
// https://developers.deepgram.com/docs/diarization
// https://developers.deepgram.com/docs/utterances
// https://developers.deepgram.com/reference/text-to-speech/speak-request
// https://developers.deepgram.com/docs/flux/quickstart
// https://developers.deepgram.com/reference/speech-to-text/listen-flux
// https://developers.deepgram.com/reference/speech-to-text/listen-streaming
// https://deepgram.com/pricing
import type { Cue, Format, Provider, Turn } from './mod.ts'
import { query } from './query.ts'

let encoded = (format: Format) =>
  format.encoding == 'mp3'
    ? { encoding: 'mp3' }
    : { encoding: format.encoding, sample_rate: format.rate }

type Listened = {
  metadata?: { duration?: number }
  results?: {
    channels?: { alternatives?: { transcript?: string }[] }[]
    utterances?: {
      speaker?: number
      transcript?: string
      start: number
      end: number
    }[]
  }
}

type Info = {
  type?: string
  event?: string
  transcript?: string
  description?: string
  audio_window_start?: number | string
  audio_window_end?: number | string
}

/**
 * What one message from Flux means: a turn starting, a turn ended with its
 * words and the stretch of the stream it took, or nothing to act on.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { DEEPGRAM } from '@yaks/speech'
 * let read = DEEPGRAM.turns[0].reader()
 * equal(
 *   read(JSON.stringify({
 *     type: 'TurnInfo',
 *     event: 'EndOfTurn',
 *     transcript: 'Hi',
 *     audio_window_start: '1.5',
 *     audio_window_end: '2.25',
 *   })),
 *   { ended: [{ speaker: 0, text: 'Hi', from: 1.5, to: 2.25 }] },
 * )
 * equal(read('{"type":"TurnInfo","event":"StartOfTurn"}'), { start: true })
 * equal(read('{"type":"TurnInfo","event":"Update"}'), {})
 * ```
 */
let cueOf = (data: unknown): Cue => {
  let info: Info
  try {
    info = JSON.parse(String(data))
  } catch {
    return {}
  }
  if (info.type == 'Error') return { error: String(info.description) }
  if (info.type != 'TurnInfo') return {}
  if (info.event == 'StartOfTurn') return { start: true }
  if (info.event != 'EndOfTurn') return {}
  // Flux words the seconds of the stream a turn took as strings.
  let from = Number(info.audio_window_start), to = Number(info.audio_window_end)
  let end = { speaker: 0, text: info.transcript?.trim() ?? '' }
  return { ended: [isNaN(from + to) ? end : { ...end, from, to }] }
}

type Word = {
  word: string
  punctuated_word?: string
  start: number
  end: number
  speaker?: number
}

type Results = {
  type?: string
  description?: string
  is_final?: boolean
  speech_final?: boolean
  from_finalize?: boolean
  channel?: { alternatives?: { words?: Word[] }[] }
}

// Words in a row, a turn each time the speaker changes.
let spoken = (words: Word[]): Turn[] =>
  words.reduce((turns: Turn[], w) => {
    let speaker = w.speaker ?? 0, text = w.punctuated_word ?? w.word
    let last = turns.at(-1)
    if (last?.speaker == speaker) {
      last.text += ' ' + text
      last.to = w.end
    } else turns.push({ speaker, text, from: w.start, to: w.end })
    return turns
  }, [])

/**
 * What reads one Nova-3 stream: its final words are kept until a pause ends
 * them (`speech_final`), or the stream is flushed or ends, and a speaker's
 * turn ends sooner when another starts.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { DEEPGRAM, streamOf } from '@yaks/speech'
 * let read = streamOf(DEEPGRAM, 'nova-3').reader()
 * let said = (words: [string, number, number, number][], end = false) =>
 *   JSON.stringify({
 *     type: 'Results',
 *     is_final: true,
 *     speech_final: end,
 *     channel: {
 *       alternatives: [{
 *         words: words.map(([w, speaker, start, end]) => ({
 *           word: w.toLowerCase(),
 *           punctuated_word: w,
 *           speaker,
 *           start,
 *           end,
 *         })),
 *       }],
 *     },
 *   })
 * equal(read(said([['I', 0, 0, 0.2], ['move', 0, 0.2, 0.5]])), { ended: [] })
 * equal(read(said([['approval.', 0, 0.5, 1], ['Second.', 1, 1.5, 2]])), {
 *   ended: [{ speaker: 0, text: 'I move approval.', from: 0, to: 1 }],
 * })
 * equal(read(said([], true)), {
 *   ended: [{ speaker: 1, text: 'Second.', from: 1.5, to: 2 }],
 * })
 * ```
 */
let listening = () => {
  let held: Word[] = []
  return (data: unknown): Cue => {
    let r: Results
    try {
      r = JSON.parse(String(data))
    } catch {
      return {}
    }
    if (r.type == 'Error') return { error: String(r.description) }
    if (r.type == 'Metadata') return { ended: spoken(held.splice(0)) }
    if (r.type != 'Results' || !r.is_final) return {}
    held.push(...r.channel?.alternatives?.[0]?.words ?? [])
    if (r.speech_final || r.from_finalize) {
      return { ended: spoken(held.splice(0)) }
    }
    // Every speaker before the one still talking has finished.
    let talking = held.at(-1)?.speaker
    let since = held.findLastIndex((w) => w.speaker != talking) + 1
    return { ended: spoken(held.splice(0, since)) }
  }
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
    speakers: true,
    // Each of its utterances is one speaker's words up to a pause.
    request: (audio, type, model) => ({
      path: `/v1/listen?${
        query({
          model,
          smart_format: 'true',
          diarize_model: 'latest',
          utterances: 'true',
        })
      }`,
      init: { method: 'POST', headers: { 'content-type': type }, body: audio },
    }),
    read: (said) => {
      let { metadata, results } = said as Listened
      return {
        text: results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '',
        seconds: metadata?.duration ?? 0,
        turns: results?.utterances?.map((u) => ({
          speaker: u.speaker ?? 0,
          text: u.transcript?.trim() ?? '',
          from: u.start,
          to: u.end,
        })).filter((turn) => turn.text),
      }
    },
  },
  turns: [{
    model: 'flux-general-en',
    perMinute: 0.0077,
    speakers: false,
    // Flux's lowest end-of-turn confidence, 0.5 against its default 0.7:
    // measured on spoken questions in a call's μ-law, the turn ended a median
    // 0.22 s after the last word instead of 1.0 s, none of 12 cut short.
    path: (format, model) =>
      `/v2/listen?${query({ model, ...encoded(format), eot_threshold: 0.5 })}`,
    opening: () => [],
    audio: (bytes) => bytes,
    reader: () => cueOf,
    closing: JSON.stringify({ type: 'CloseStream' }),
  }, {
    // A meeting's: Nova-3 tells its speakers apart, at its listed $0.0077 a
    // minute (a promotion has it at $0.0048 for now) and $0.0020 for the
    // speakers, and a turn ends at a second's pause or another's voice.
    model: 'nova-3',
    perMinute: 0.0097,
    speakers: true,
    path: (format, model) =>
      `/v1/listen?${
        query({
          model,
          ...encoded(format),
          smart_format: 'true',
          diarize_model: 'latest',
          endpointing: 1000,
        })
      }`,
    opening: () => [],
    audio: (bytes) => bytes,
    reader: listening,
    closing: JSON.stringify({ type: 'CloseStream' }),
  }],
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
    // https://developers.deepgram.com/docs/tts-voice-controls
    speeds: { min: 0.7, max: 1.5 },
    perThousand: 0.030,
    request: (text, voice, format, speed) => ({
      path: `/v1/speak?${
        query({
          model: voice,
          ...encoded(format),
          ...speed == 1 ? {} : { speed: String(speed) },
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
