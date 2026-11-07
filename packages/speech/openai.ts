// OpenAI: gpt-transcribe hears a recording and a call's turns,
// gpt-4o-mini-tts speaks, and gpt-realtime-2.1 hears and speaks in one
// stream, answering as it goes. Its TTS speaks 24 kHz PCM, made μ-law for a
// call here; the realtime model takes and speaks a telephone's μ-law itself.
// Prices are its list, 2026-11-05.
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/realtime-conversations
// https://developers.openai.com/api/reference/resources/realtime/server-events
import type { Provider, Raw, Said, Turn, Voice } from './mod.ts'
import { base64, mulawed, unbase64 } from './audio.ts'

// The realtime model's voices; its TTS model speaks in the same ones.
let VOICES: Voice[] = [
  { id: 'cedar', name: 'Cedar', about: 'masculine, natural, calm, composed' },
  { id: 'marin', name: 'Marin', about: 'feminine, natural, clear, warm' },
  { id: 'alloy', name: 'Alloy', about: 'neutral, even, clear' },
  { id: 'ash', name: 'Ash', about: 'masculine, soft, measured' },
  { id: 'ballad', name: 'Ballad', about: 'masculine, warm, lyrical' },
  { id: 'coral', name: 'Coral', about: 'feminine, warm, friendly' },
  { id: 'echo', name: 'Echo', about: 'masculine, resonant, steady' },
  { id: 'sage', name: 'Sage', about: 'feminine, calm, thoughtful' },
  { id: 'shimmer', name: 'Shimmer', about: 'feminine, bright, energetic' },
  { id: 'verse', name: 'Verse', about: 'masculine, expressive, dynamic' },
]

// Audio on the realtime stream: a call's μ-law, or 24 kHz PCM.
let wire = (format: Raw) =>
  format.encoding == 'mulaw'
    ? { type: 'audio/pcmu' }
    : { type: 'audio/pcm', rate: format.rate }

// What a turn cost, from the usage `response.done` reports, at the model's
// list prices in dollars a million tokens (cached input read at the audio
// price, a little over).
type Usage = {
  input_token_details?: {
    audio_tokens?: number
    text_tokens?: number
    cached_tokens?: number
  }
  output_token_details?: { audio_tokens?: number; text_tokens?: number }
}
let PRICES: Record<
  string,
  { audioIn: number; audioOut: number; textIn: number; textOut: number }
> = {
  'gpt-realtime-2.1-mini': {
    audioIn: 10,
    audioOut: 20,
    textIn: 0.6,
    textOut: 2.4,
  },
  'gpt-realtime-2.1': { audioIn: 32, audioOut: 64, textIn: 4, textOut: 24 },
}
let costOf = (model: string, usage: Usage = {}) => {
  let p = PRICES[model] ?? PRICES['gpt-realtime-2.1']
  let i = usage.input_token_details ?? {}, o = usage.output_token_details ?? {}
  return ((i.audio_tokens ?? 0) * p.audioIn +
    (i.text_tokens ?? 0) * p.textIn +
    (o.audio_tokens ?? 0) * p.audioOut +
    (o.text_tokens ?? 0) * p.textOut) / 1e6
}

type Event = {
  type?: string
  delta?: string
  transcript?: string
  call_id?: string
  name?: string
  arguments?: string
  response?: { usage?: Usage }
  error?: { message?: string; code?: string }
}

let parsed = (data: unknown): Event => {
  try {
    return JSON.parse(String(data))
  } catch {
    return {}
  }
}

/**
 * What one message from a realtime transcription stream means.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { OPENAI } from '@yaks/speech'
 * let read = OPENAI.turns.read
 * equal(read('{"type":"input_audio_buffer.speech_started"}'), { start: true })
 * equal(
 *   read(JSON.stringify({
 *     type: 'conversation.item.input_audio_transcription.completed',
 *     transcript: ' Book it ',
 *   })),
 *   { end: 'Book it' },
 * )
 * ```
 */
let turnOf = (data: unknown): Turn => {
  let e = parsed(data)
  if (e.type == 'input_audio_buffer.speech_started') return { start: true }
  if (e.type == 'conversation.item.input_audio_transcription.completed') {
    return { end: e.transcript?.trim() ?? '' }
  }
  if (e.type == 'error') return { error: String(e.error?.message) }
  return {}
}

// The quickest turns: a speaker's turn ends after this much silence.
let TURN = {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 300,
}

export let OPENAI: Provider = {
  name: 'openai',
  title: 'OpenAI',
  api: 'https://api.openai.com',
  live: 'wss://api.openai.com',
  authorization: (key) => `Bearer ${key}`,
  protocols: (key) => ['realtime', `openai-insecure-api-key.${key}`],
  hear: {
    model: 'gpt-transcribe',
    perMinute: 0.0045,
    request: (audio, type, model) => {
      let form = new FormData()
      form.set('model', model)
      form.set('file', new Blob([audio as BlobPart], { type }), 'audio')
      return {
        path: '/v1/audio/transcriptions',
        init: { method: 'POST', body: form },
      }
    },
    read: (said) => {
      let { text, usage } = said as {
        text?: string
        usage?: { seconds?: number }
      }
      return { text: text ?? '', seconds: usage?.seconds }
    },
  },
  turns: {
    // gpt-live-transcribe takes no turn detection, refusing the session, so
    // it cannot say when a caller's turn ends.
    model: 'gpt-transcribe',
    perMinute: 0.0045,
    path: () => '/v1/realtime?intent=transcription',
    opening: (format, model) => [JSON.stringify({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: wire(format),
            transcription: { model, language: 'en' },
            turn_detection: TURN,
          },
        },
      },
    })],
    audio: (bytes) =>
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64(bytes),
      }),
    read: turnOf,
  },
  speak: {
    voice: 'cedar',
    voices: [
      ...VOICES,
      { id: 'fable', name: 'Fable', about: 'masculine, British, expressive' },
      { id: 'nova', name: 'Nova', about: 'feminine, bright, friendly' },
      { id: 'onyx', name: 'Onyx', about: 'masculine, deep, authoritative' },
    ],
    // $12 a million audio tokens, 1,200 a minute, and about a thousand
    // characters said a minute.
    speeds: { min: 0.25, max: 4 },
    perThousand: 0.015,
    request: (text, voice, format, speed) => ({
      path: '/v1/audio/speech',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice,
          input: text,
          response_format: format.encoding == 'mp3' ? 'mp3' : 'pcm',
          stream_format: 'audio',
          ...speed == 1 ? {} : { speed },
        }),
      },
    }),
    // Its raw samples are 24 kHz PCM: a call's μ-law is made from them.
    audio: (format) =>
      format.encoding == 'mulaw' ? mulawed(24000, format.rate) : undefined,
  },
  talk: {
    models: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
    voice: 'cedar',
    voices: VOICES,
    speeds: { min: 0.25, max: 1.5 },
    path: (model) => `/v1/realtime?model=${encodeURIComponent(model)}`,
    opening: (setup) => [JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: setup.model,
        instructions: setup.instructions,
        output_modalities: ['audio'],
        // The least thought before the first word.
        reasoning: { effort: 'minimal' },
        audio: {
          input: {
            format: wire(setup.format),
            transcription: { model: 'gpt-live-transcribe', language: 'en' },
            // A phone held to the ear. The model, not silence, says when
            // the caller is done, letting an "um" or a half sentence run on
            // instead of answering it as a turn of its own; mod.ts `talk`
            // answers it. Unsure, it waits up to 4 s at medium eagerness, 8 s
            // at low, and 2 s at high, which ends a turn at a thinking pause.
            noise_reduction: { type: 'near_field' },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'medium',
              create_response: false,
              // The caller talking stops the model only once their words
              // say something (mod.ts `talk`), not at the first sound.
              interrupt_response: false,
            },
          },
          output: {
            format: wire(setup.format),
            voice: setup.voice,
            ...setup.speed == 1 ? {} : { speed: setup.speed },
          },
        },
        tools: setup.tools.map((t) => ({ type: 'function', ...t })),
        tool_choice: 'auto',
      },
    })],
    audio: (bytes) =>
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64(bytes),
      }),
    read: (data, model) => {
      let e = parsed(data)
      let said: Said[] = []
      switch (e.type) {
        case 'input_audio_buffer.speech_started':
          said.push({ start: true })
          break
        case 'input_audio_buffer.speech_stopped':
          said.push({ stopped: true })
          break
        case 'conversation.item.input_audio_transcription.completed':
          if (e.transcript?.trim()) said.push({ heard: e.transcript.trim() })
          break
        case 'conversation.item.input_audio_transcription.delta':
          if (e.delta) said.push({ hearing: e.delta })
          break
        case 'response.output_audio.delta':
          if (e.delta) said.push({ audio: unbase64(e.delta) })
          break
        case 'response.output_audio_transcript.done':
          if (e.transcript?.trim()) said.push({ said: e.transcript.trim() })
          break
        case 'response.function_call_arguments.done':
          said.push({
            call: {
              id: e.call_id ?? '',
              name: e.name ?? '',
              args: e.arguments ?? '{}',
            },
          })
          break
        case 'response.created':
          said.push({ begun: true })
          break
        case 'response.done': {
          let usage = e.response?.usage
          if (usage) said.push({ spent: costOf(modelOf(e) || model, usage) })
          said.push({ done: true })
          break
        }
        case 'error':
          // A stop that came as the response finished has nothing to stop,
          // and a turn ended as the model heard it end has nothing to end.
          if (
            e.error?.code == 'response_cancel_not_active' ||
            e.error?.code == 'input_audio_buffer_commit_empty'
          ) break
          said.push(
            e.error?.code == 'conversation_already_has_active_response'
              ? { busy: true }
              : { error: String(e.error?.message) },
          )
      }
      return said
    },
    answer: (call, output) => [
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: call, output },
      }),
    ],
    respond: (text) =>
      JSON.stringify({
        type: 'response.create',
        ...text == undefined ? {} : {
          response: {
            instructions: `Say exactly this, and nothing else: ${text}`,
          },
        },
      }),
    cancel: JSON.stringify({ type: 'response.cancel' }),
    tell: (text) =>
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text }],
        },
      }),
    commit: JSON.stringify({ type: 'input_audio_buffer.commit' }),
  },
}

// The model a `response.done` was answered by, where it says: it reports
// none, so the session's own model prices it.
let modelOf = (e: Event) =>
  String((e.response as { model?: string } | undefined)?.model ?? '')
