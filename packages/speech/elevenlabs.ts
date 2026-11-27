// ElevenLabs: Multilingual v2 speaks, Scribe v2 hears a recording and tells
// its speakers apart, and an account keeps voices of its own: the premade
// ones, voices designed from a description, and voices cloned from
// recordings. It has no model here that hears a stream or talks. The key goes
// in its own header, `xi-api-key`. Prices are its API pay-as-you-go list,
// 2026-11-22: $0.08 per thousand characters spoken by Multilingual v2, and
// $0.20 an hour heard by Scribe v2.
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// https://elevenlabs.io/docs/api-reference/speech-to-text/convert
// https://elevenlabs.io/docs/api-reference/voices/search
// https://elevenlabs.io/docs/api-reference/text-to-voice/design
// https://elevenlabs.io/docs/api-reference/text-to-voice/create
// https://elevenlabs.io/docs/api-reference/voices/ivc/create
// https://elevenlabs.io/pricing/api
import type { Format, Provider, Turn, Voice } from './mod.ts'
import { unbase64 } from './audio.ts'
import { query } from './query.ts'

// The output format a request names: an MP3, μ-law at 8 kHz, or raw 16-bit
// PCM at a rate it speaks.
let output = (format: Format) =>
  format.encoding == 'mp3'
    ? 'mp3_44100_128'
    : format.encoding == 'mulaw'
    ? `ulaw_${format.rate}`
    : `pcm_${format.rate}`

type Listed = {
  voice_id: string
  name?: string
  category?: string | null
  description?: string | null
  labels?: Record<string, string> | null
  preview_url?: string | null
}

/**
 * A voice as the account lists it: its id, its name, how it sounds (its
 * description, else its labels), and the sample it plays.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { ELEVENLABS } from '@yaks/speech'
 * equal(
 *   ELEVENLABS.voices!.read({
 *     voices: [{
 *       voice_id: 'v1',
 *       name: 'Ada',
 *       category: 'cloned',
 *       labels: { accent: 'british', gender: 'female' },
 *       preview_url: 'https://x/ada.mp3',
 *     }],
 *     has_more: true,
 *     next_page_token: 'p2',
 *   }),
 *   {
 *     voices: [{
 *       id: 'v1',
 *       name: 'Ada',
 *       about: 'british, female',
 *       sample: 'https://x/ada.mp3',
 *       custom: true,
 *     }],
 *     next: 'p2',
 *   },
 * )
 * ```
 */
let voiceOf = (v: Listed): Voice => ({
  id: v.voice_id,
  name: v.name ?? v.voice_id,
  about: v.description?.trim() ||
    Object.values(v.labels ?? {}).join(', '),
  ...v.preview_url ? { sample: v.preview_url } : {},
  ...v.category && v.category != 'premade' ? { custom: true } : {},
})

type Word = {
  text: string
  type?: string
  start?: number
  end?: number
  speaker_id?: string
}

// Scribe's words in a row, a turn each time the speaker changes; spacing
// joins words, and sounds such as (laughter) are left out.
let turnsOf = (words: Word[]): Turn[] =>
  words.reduce((turns: Turn[], w) => {
    if (w.type == 'audio_event') return turns
    let speaker = Number(w.speaker_id?.match(/\d+$/)?.[0] ?? 0)
    let last = turns.at(-1)
    if (w.type == 'spacing') {
      if (last) last.text += w.text
      return turns
    }
    if (last?.speaker == speaker) {
      last.text += w.text
      if (w.end != null) last.to = w.end
    } else {
      turns.push({
        speaker,
        text: w.text,
        ...w.start == null ? {} : { from: w.start },
        ...w.end == null ? {} : { to: w.end },
      })
    }
    return turns
  }, []).map((t) => ({ ...t, text: t.text.trim() }))

// Premade voices every account has, as it lists them (GET /v1/voices).
let PREMADE: Voice[] = [
  ['JBFqnCBsd6RMkjVDRZzb', 'George', 'warm, captivating storyteller; British'],
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel', 'steady broadcaster; British'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice', 'clear, engaging educator; British'],
  ['pFZP5JQG7iQjIQuC4Bku', 'Lily', 'velvety actress; British'],
  ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'mature, reassuring, confident; American'],
  ['CwhRBWXzGAHq8TQ4Fs17', 'Roger', 'laid-back, casual, resonant; American'],
  ['nPczCjzI2devNBz1zQrb', 'Brian', 'deep, resonant, comforting; American'],
  ['XrExE9yKIg1WjnnlVkGX', 'Matilda', 'knowledgeable, professional; American'],
  ['cjVigY5qzO86Huf0OWal', 'Eric', 'smooth, trustworthy; American'],
  ['SAz9YHcvj6GT2YYXdXww', 'River', 'relaxed, neutral, informative; American'],
  ['N2lVS1w4EtoT3dr4eOWO', 'Callum', 'husky trickster; American'],
  ['IKne3meq5aSn9XLyUdCD', 'Charlie', 'deep, confident, energetic; Australian'],
  ['pqHfZKP75CvOlQylNhV4', 'Bill', 'wise, mature, balanced; American'],
].map(([id, name, about]) => ({ id, name, about }))

export let ELEVENLABS: Provider = {
  name: 'elevenlabs',
  title: 'ElevenLabs',
  api: 'https://api.elevenlabs.io',
  live: 'wss://api.elevenlabs.io',
  header: 'xi-api-key',
  authorization: (key) => key,
  protocols: () => [],
  hear: {
    model: 'scribe_v2',
    perMinute: 0.20 / 60,
    speakers: true,
    // Its limit is 5 GB, sent whole in a form.
    bytes: 5 * 1024 ** 3,
    request: (audio, type, model) => {
      let form = new FormData()
      form.set('model_id', model)
      form.set('diarize', 'true')
      form.set('tag_audio_events', 'false')
      form.set('file', new Blob([audio as BlobPart], { type }), 'audio')
      return {
        path: '/v1/speech-to-text',
        init: { method: 'POST', body: form },
      }
    },
    read: (said) => {
      let { text, words, audio_duration_secs } = said as {
        text?: string
        words?: Word[]
        audio_duration_secs?: number
      }
      return {
        text: text ?? '',
        seconds: audio_duration_secs,
        ...words?.length ? { turns: turnsOf(words) } : {},
      }
    },
  },
  turns: [],
  speak: {
    voice: PREMADE[0].id,
    voices: PREMADE,
    // https://elevenlabs.io/docs/api-reference/text-to-speech/convert
    // (voice_settings.speed)
    speeds: { min: 0.7, max: 1.2 },
    perThousand: 0.08,
    request: (text, voice, format, speed) => ({
      path: `/v1/text-to-speech/${encodeURIComponent(voice)}?${
        query({ output_format: output(format) })
      }`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          ...speed == 1 ? {} : { voice_settings: { speed } },
        }),
      },
    }),
  },
  voices: {
    request: (page) => ({
      path: `/v2/voices?${
        query({
          page_size: 100,
          include_total_count: 'false',
          next_page_token: page,
        })
      }`,
      init: {},
    }),
    read: (said) => {
      let { voices, has_more, next_page_token } = said as {
        voices?: Listed[]
        has_more?: boolean
        next_page_token?: string | null
      }
      return {
        voices: (voices ?? []).map(voiceOf),
        ...has_more && next_page_token ? { next: next_page_token } : {},
      }
    },
  },
  make: {
    design: (description, text) => ({
      path: '/v1/text-to-voice/design?output_format=mp3_44100_128',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voice_description: description,
          ...text ? { text } : { auto_generate_text: true },
        }),
      },
    }),
    designs: (said) =>
      ((said as {
        previews?: {
          generated_voice_id: string
          audio_base_64: string
          media_type?: string
          duration_secs?: number
        }[]
      }).previews ?? []).map((p) => ({
        id: p.generated_voice_id,
        audio: unbase64(p.audio_base_64),
        type: p.media_type ?? 'audio/mpeg',
        seconds: p.duration_secs ?? 0,
      })),
    keep: (design, name, description) => ({
      path: '/v1/text-to-voice',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voice_name: name,
          voice_description: description,
          generated_voice_id: design,
        }),
      },
    }),
    clone: (name, samples, description) => {
      let form = new FormData()
      form.set('name', name)
      if (description) form.set('description', description)
      samples.forEach((s, n) => form.append('files', s, `sample-${n + 1}`))
      return { path: '/v1/voices/add', init: { method: 'POST', body: form } }
    },
    made: (said) => String((said as { voice_id?: string }).voice_id ?? ''),
  },
}
