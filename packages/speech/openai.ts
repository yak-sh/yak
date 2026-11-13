// OpenAI: gpt-transcribe hears a recording and a call's turns,
// gpt-4o-mini-tts speaks, gpt-realtime-2.1 hears and speaks in one stream,
// answering as it goes, and gpt-live-1 hears and speaks at once, taking its
// own turns. Its TTS speaks 24 kHz PCM, made μ-law for a call here; the
// talking models take and speak a telephone's μ-law themselves. Prices are
// its list, 2026-11-05. Its transcription tells no speakers apart: only
// gpt-4o-transcribe-diarize does, deprecated and never on a stream.
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/speech-to-text
// https://developers.openai.com/api/docs/guides/realtime-conversations
// https://developers.openai.com/api/reference/resources/realtime/server-events
// https://developers.openai.com/api/reference/resources/live/primary-websocket
import type { Cue, Provider, Raw, Said, Setup, Voice } from './mod.ts'
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

// The larger models GPT-Live hands its work to on OpenAI's side, in dollars
// per million tokens: input, cached input, cache writes and output.
let BACKENDS: Record<string, [number, number, number, number]> = {
  'gpt-6-luna': [0.1, 0.01, 0.125, 0.5],
  'gpt-6-sol': [2, 0.2, 2.5, 10],
}
type Used = {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
  }
}
let backendCost = (model: string, u: Used = {}) => {
  let [input, cached, written, output] = BACKENDS[model] ??
    BACKENDS['gpt-6-sol']
  let reused = u.input_tokens_details?.cached_tokens ?? 0
  let wrote = u.input_tokens_details?.cache_write_tokens ?? 0
  return (((u.input_tokens ?? 0) - reused - wrote) * input + reused * cached +
    wrote * written + (u.output_tokens ?? 0) * output) / 1e6
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
  item_id?: string
  item?: { id?: string; phase?: string }
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
 * let read = OPENAI.turns[0].reader()
 * equal(read('{"type":"input_audio_buffer.speech_started"}'), { start: true })
 * equal(
 *   read(JSON.stringify({
 *     type: 'conversation.item.input_audio_transcription.completed',
 *     transcript: ' Book it ',
 *   })),
 *   { ended: [{ speaker: 0, text: 'Book it' }] },
 * )
 * ```
 */
let cueOf = (data: unknown): Cue => {
  let e = parsed(data)
  if (e.type == 'input_audio_buffer.speech_started') return { start: true }
  if (e.type == 'conversation.item.input_audio_transcription.completed') {
    return { ended: [{ speaker: 0, text: e.transcript?.trim() ?? '' }] }
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
    speakers: false,
    // Its transcriptions' limit, a file sent in a form.
    bytes: 25 * 1024 ** 2,
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
  turns: [{
    // gpt-live-transcribe takes no turn detection, refusing the session, so
    // it cannot say when a caller's turn ends.
    model: 'gpt-transcribe',
    perMinute: 0.0045,
    speakers: false,
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
    reader: () => cueOf,
  }],
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
  talk: [{
    models: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
    voice: 'cedar',
    voices: VOICES,
    speeds: { min: 0.25, max: 1.5 },
    path: (model) => `/v1/realtime?model=${encodeURIComponent(model)}`,
    opening: (setup) => [JSON.stringify({
      type: 'session.update',
      session: session(setup),
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
          said.push({ heard: e.transcript?.trim() ?? '' })
          break
        // Words not heard are none.
        case 'conversation.item.input_audio_transcription.failed':
          said.push({ heard: '' })
          break
        case 'conversation.item.input_audio_transcription.delta':
          if (e.delta) said.push({ hearing: e.delta })
          break
        // What a response says before its answer is an item of its own.
        case 'response.output_item.added':
          if (e.item?.phase == 'commentary' && e.item.id) {
            said.push({ aside: e.item.id })
          }
          break
        case 'response.output_audio.delta':
          if (e.delta) said.push({ audio: unbase64(e.delta), of: e.item_id })
          break
        case 'response.output_audio_transcript.done':
          if (e.transcript?.trim()) {
            said.push({ said: e.transcript.trim(), of: e.item_id })
          }
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
        case 'output_audio_buffer.started':
          said.push({ plays: true })
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
    // Asked to say a message with its tools at hand, it sometimes asked to
    // listen instead and said nothing.
    respond: (text, tools) =>
      JSON.stringify({
        type: 'response.create',
        ...text == undefined && !tools ? {} : {
          response: {
            ...text == undefined ? {} : {
              instructions:
                `Say only the message below, without reading its source label aloud:\n${text}`,
              tool_choice: 'none',
            },
            ...tools &&
              { tools: tools.map((t) => ({ type: 'function', ...t })) },
          },
        },
      }),
    cancel: JSON.stringify({ type: 'response.cancel' }),
    tell: (text) => [
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text }],
        },
      }),
    ],
    commit: JSON.stringify({ type: 'input_audio_buffer.commit' }),
    // A call sent to the project over SIP rings its webhook; once accepted
    // with the session, a stream joins it by its id. The line plays the
    // model's audio, and is told to stop.
    // https://developers.openai.com/api/docs/guides/voice-sip
    calls: {
      rang: (event) => {
        let e = event as {
          type?: string
          data?: {
            call_id?: string
            sip_headers?: { name?: string; value?: string }[]
          }
        }
        if (e?.type != 'realtime.call.incoming' || !e.data?.call_id) return
        return {
          id: e.data.call_id,
          headers: Object.fromEntries(
            (e.data.sip_headers ?? []).map((h) => [
              String(h.name).toLowerCase(),
              String(h.value ?? ''),
            ]),
          ),
        }
      },
      accept: (call, setup) =>
        posted(
          `/v1/realtime/calls/${encodeURIComponent(call)}/accept`,
          session(setup),
        ),
      reject: (call) =>
        posted(`/v1/realtime/calls/${encodeURIComponent(call)}/reject`, {
          status_code: 486,
        }),
      hangup: (call) =>
        posted(`/v1/realtime/calls/${encodeURIComponent(call)}/hangup`),
      join: (call) => `/v1/realtime?call_id=${encodeURIComponent(call)}`,
      hush: JSON.stringify({ type: 'output_audio_buffer.clear' }),
    },
  }, {
    // GPT-Live: hears and speaks at once and takes its own turns, and hands
    // what needs tools to the client, whoever runs the call (`delegated`),
    // whose answer it says in its own words. It has no speeds.
    models: ['gpt-live-1'],
    duplex: true,
    perMinute: 0.05,
    voice: 'cedar',
    voices: VOICES,
    speeds: { min: 1, max: 1 },
    path: () => '/v1/live/sessions',
    opening: (setup) => [JSON.stringify({
      type: 'session.start',
      session: {
        model: setup.model,
        instructions: setup.instructions,
        // Its first words are asked for from the start, and again once the
        // session started (`opens`), as OpenAI has a greeting asked for.
        // https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks
        ...setup.opens
          ? {
            input: [{
              type: 'message',
              role: 'developer',
              content: [{ type: 'input_text', text: greet(setup.opens) }],
            }],
          }
          : {},
        audio: {
          ...setup.format ? { format: wired(setup.format) } : {},
          output: { voice: setup.voice },
        },
        delegation: setup.backend
          ? {
            type: 'responses',
            responses: {
              model: setup.backend.model,
              instructions: setup.backend.instructions,
              tools: [
                ...setup.backend.tools.map((t) => ({
                  type: 'function',
                  ...t,
                  strict: false,
                })),
                { type: 'web_search' },
              ],
              tool_choice: 'auto',
              // One call at a time, each answered before the next.
              parallel_tool_calls: false,
              reasoning: { effort: 'low' },
            },
          }
          : { type: 'client' },
      },
    })],
    audio: (bytes) =>
      JSON.stringify({
        type: 'session.input_audio.append',
        audio: base64(bytes),
      }),
    read: (data, _, backend) => {
      let e = parsed(data) as Event & {
        delegation?: { id?: string; target?: string }
        event?: {
          type?: string
          item?: {
            type?: string
            call_id?: string
            name?: string
            arguments?: string
          }
          response?: { usage?: Used }
        }
      }
      switch (e.type) {
        case 'session.started':
          return [{ ready: true }]
        case 'session.input_transcript.delta':
          return e.delta ? [{ hearing: e.delta }] : []
        case 'session.output_transcript.delta':
          return e.delta ? [{ saying: e.delta }] : []
        case 'session.output_audio.delta':
          return e.delta ? [{ audio: unbase64(e.delta) }] : []
        // Work its backend does is no one's here but its tools'.
        case 'session.delegation.created':
          return e.delegation?.id && e.delegation.target != 'responses'
            ? [{ delegated: e.delegation.id }]
            : []
        // What the backend does, each of its events wrapped in one of these.
        case 'response.event': {
          let n = e.event ?? {}
          if (
            n.type == 'response.output_item.done' &&
            n.item?.type == 'function_call'
          ) {
            return [{
              call: {
                id: n.item.call_id ?? '',
                name: n.item.name ?? '',
                args: n.item.arguments ?? '{}',
              },
            }]
          }
          if (n.type == 'response.completed' && backend) {
            return [{ spent: backendCost(backend, n.response?.usage) }]
          }
          return []
        }
        case 'error':
          return [{ error: String(e.error?.message) }]
      }
      return []
    },
    // What it is asked to say, and a delegation's answer, it says in its
    // own words, as they come. Instructions appended stand for the rest of
    // the session, so asking it that way to say a line now has it say the
    // line again later, and only that.
    answer: (id, output) => appended('commentary', output, id),
    backends: Object.keys(BACKENDS),
    result: (call, output) => [
      JSON.stringify({
        type: 'response.item.create',
        item: { type: 'function_call_output', call_id: call, output },
      }),
      JSON.stringify({ type: 'response.create' }),
    ],
    say: (text) => appended('commentary', text),
    opens: (text) => appended('commentary', greet(text)),
    tell: (text) => appended('thinking', text),
  }],
}

// What GPT-Live is asked for as its stream opens.
let greet = (text: string) =>
  `Say exactly this to the caller now, word for word: "${text}" Then pause and listen.`

let posted = (path: string, body?: object) => ({
  path,
  init: {
    method: 'POST',
    ...body
      ? {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
      : {},
  },
})

// A realtime session as a stream is set up with, or a call accepted with,
// which says its own audio format.
let session = (setup: Setup) => ({
  type: 'realtime',
  model: setup.model,
  instructions: setup.instructions,
  output_modalities: ['audio'],
  // The least thought before the first word.
  reasoning: { effort: 'minimal' },
  audio: {
    input: {
      ...setup.format ? { format: wire(setup.format) } : {},
      transcription: { model: 'gpt-live-transcribe', language: 'en' },
      // A phone held to the ear. The model says when the caller is done, in
      // about a second when it is sure; unsure, it waits up to 4 s at medium
      // eagerness, and mod.ts `talk` ends the turn sooner and answers it.
      // High eagerness ends a turn at a thinking pause.
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'semantic_vad',
        eagerness: 'medium',
        create_response: false,
        // The caller talking stops the model only once their words say
        // something (mod.ts `talk`), not at the first sound.
        interrupt_response: false,
      },
    },
    output: {
      ...setup.format ? { format: wire(setup.format) } : {},
      voice: setup.voice,
      ...setup.speed == 1 ? {} : { speed: setup.speed },
    },
  },
  tools: setup.tools.map((t) => ({ type: 'function', ...t })),
  tool_choice: 'auto',
})

// GPT-Live's audio: a call's μ-law, or 16-bit PCM at 16 or 24 kHz.
let wired = (format: Raw) =>
  format.encoding == 'mulaw'
    ? { type: 'audio/pcmu', rate: 8000 }
    : { type: 'audio/pcm', rate: format.rate }

// The most GPT-Live takes in one append is 500 tokens, and a token is at
// least a byte, so a part of at most this many UTF-8 bytes always fits.
let APPENDED = 500

/**
 * `text` appended to what GPT-Live knows, as `kind` (`instructions` it
 * follows, `thinking` it knows without saying, `commentary` it says), about a
 * delegation or the whole session, in parts each of at most `APPENDED`
 * UTF-8 bytes, split between paragraphs, else lines, else words.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { OPENAI } from '@yaks/speech'
 * let live = OPENAI.talk!.find((t) => t.duplex)!
 * equal(live.tell('A.').map((m) => JSON.parse(m)), [{
 *   type: 'session.thinking.append',
 *   delegation_id: null,
 *   content: 'A.',
 * }])
 * let long = ['a'.repeat(400), 'b'.repeat(400)].join('\n\n')
 * equal(live.tell(long).map((m) => JSON.parse(m).content.length), [400, 400])
 * let wide = '界'.repeat(400)
 * equal(live.tell(wide).map((m) => JSON.parse(m).content.length), [166, 166, 68])
 * ```
 */
let appended = (kind: string, text: string, id: string | null = null) =>
  parts(text, APPENDED).map((content) =>
    JSON.stringify({
      type: `session.${kind}.append`,
      delegation_id: id,
      content,
    })
  )

let utf8 = new TextEncoder()

// `text` in parts of at most `most` UTF-8 bytes, split at the widest break
// that fits.
let parts = (text: string, most: number): string[] => {
  let fit = fitting(text, most)
  if (fit == text.length) return [text]
  for (let gap of ['\n\n', '\n', ' ']) {
    let at = text.lastIndexOf(gap, fit)
    if (at > 0) {
      return [text.slice(0, at), ...parts(text.slice(at + gap.length), most)]
    }
  }
  return [text.slice(0, fit), ...parts(text.slice(fit), most)]
}

// How many of `text`'s UTF-16 units fit in `most` UTF-8 bytes, never
// splitting a character.
let fitting = (text: string, most: number) => {
  let bytes = 0, at = 0
  for (let c of text) {
    bytes += utf8.encode(c).length
    if (bytes > most) break
    at += c.length
  }
  return at
}

// The model a `response.done` was answered by, where it says: it reports
// none, so the session's own model prices it.
let modelOf = (e: Event) =>
  String((e.response as { model?: string } | undefined)?.model ?? '')
