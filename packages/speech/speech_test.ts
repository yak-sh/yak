import { equal, test, until } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  balance,
  DEEPGRAM,
  hear,
  type Keyed,
  OPENAI,
  type Provider,
  type Socket,
  speak,
  SpeechError,
  talk,
  turns,
} from './mod.ts'

// A provider answering every call with `said`, keeping what it was asked.
let answering = (
  said: (url: string) => Response,
  provider: Provider = DEEPGRAM,
) => {
  let asked: { url: string; init: RequestInit }[] = []
  let fetch = ((url: string, init: RequestInit) => {
    asked.push({ url: String(url), init })
    return Promise.resolve(said(String(url)))
  }) as typeof globalThis.fetch
  return { asked, fetch, provider, key: 'k1' }
}

test('speaking asks the voice for the format, with the key, and prices the characters', async () => {
  let o = answering(() => new Response(new Uint8Array([7, 8])))
  let said = await speak({ ...o, text: 'x'.repeat(500) })
  let url = new URL(o.asked[0].url)
  equal(url.pathname, '/v1/speak')
  equal(url.searchParams.get('model'), 'aura-2-thalia-en')
  equal(url.searchParams.get('encoding'), 'mp3')
  equal(url.searchParams.has('container'), false)
  equal(
    (o.asked[0].init.headers as Record<string, string>).authorization,
    'token k1',
  )
  equal(JSON.parse(String(o.asked[0].init.body)), { text: 'x'.repeat(500) })
  equal(said.type, 'audio/mpeg')
  equal(said.dollars, 0.015)
  equal([...new Uint8Array(await new Response(said.body).arrayBuffer())], [
    7,
    8,
  ])
})

test('each provider is asked to speak at the speed given, held within its own', async () => {
  let asked = async (provider: Provider, speed: number) => {
    let o = answering(() => new Response(new Uint8Array(1)), provider)
    await speak({ ...o, text: 'Hi.', speed })
    let { url, init } = o.asked[0]
    return provider == DEEPGRAM
      ? new URL(url).searchParams.get('speed')
      : JSON.parse(String(init.body)).speed
  }
  equal(await asked(DEEPGRAM, 1.3), '1.3')
  equal(await asked(DEEPGRAM, 2), '1.5')
  equal(await asked(DEEPGRAM, 1), null)
  equal(await asked(OPENAI, 1.3), 1.3)
  equal(await asked(OPENAI, 1), undefined)
  let { s } = talking(() => Promise.resolve(''), 2)
  s.fire('open')
  equal(s.json()[0].session.audio.output.speed, 1.5)
})

test('a refusal says the provider’s words, and only a 429 or 5xx is tried again', async () => {
  for (let [status, retry] of [[401, false], [429, true], [503, true]]) {
    let o = answering(() => new Response('nope', { status: Number(status) }))
    let error = await assertRejects(
      () => speak({ ...o, text: 'Hi' }),
      SpeechError,
      `deepgram answered ${status} to /v1/speak: nope`,
    )
    equal(error.retry, retry)
  }
})

test('the balance adds up every project’s', async () => {
  let o = answering((url) =>
    Response.json(
      url.endsWith('/projects')
        ? { projects: [{ project_id: 'a' }, { project_id: 'b' }] }
        : { balances: [{ amount: url.includes('/a/') ? 199.5 : 0.25 }] },
    )
  )
  equal(await balance(o), 199.75)
})

test('a recording is heard with its type, priced by its minutes', async () => {
  let o = answering(() =>
    Response.json({
      metadata: { duration: 60 },
      results: { channels: [{ alternatives: [{ transcript: 'Call me' }] }] },
    })
  )
  equal(await hear({ ...o, audio: new Uint8Array([1]), type: 'audio/webm' }), {
    text: 'Call me',
    seconds: 60,
    dollars: 0.0043,
  })
  equal(
    (o.asked[0].init.headers as Record<string, string>)['content-type'],
    'audio/webm',
  )
})

// A socket that keeps what it was sent and lets a test say what it hears.
let socket = () => {
  let on: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  let sent: (string | Uint8Array)[] = []
  let opened: { url: string; protocols: string[] }[] = []
  let json = () => sent.map((m) => JSON.parse(String(m)))
  let s: Socket = {
    send: (data) => void sent.push(data),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let fire = (type: string, data?: unknown) =>
    on[type]?.forEach((f) => f({ data }))
  return {
    sent,
    json,
    opened,
    fire,
    open: (url: string, { protocols }: Keyed) => {
      opened.push({ url, protocols })
      return s
    },
  }
}

test('a stream sends what it heard once open, tells turns, and prices its seconds', () => {
  let s = socket()
  let told: string[] = []
  let stream = turns({
    provider: DEEPGRAM,
    key: 'k1',
    format: { encoding: 'mulaw', rate: 8000 },
    open: s.open,
    told: {
      start: () => told.push('start'),
      end: (text) => told.push(text),
      lost: (why) => told.push('lost: ' + why),
    },
  })
  equal(s.opened, [{
    url:
      'wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.5',
    protocols: ['token', 'k1'],
  }])
  stream.send(new Uint8Array(4000))
  equal(s.sent.length, 0)
  s.fire('open')
  stream.send(new Uint8Array(4000))
  equal(s.sent.length, 2)
  s.fire('message', '{"type":"TurnInfo","event":"StartOfTurn"}')
  s.fire('message', '{"type":"TurnInfo","event":"Update","transcript":"Bo"}')
  s.fire(
    'message',
    '{"type":"TurnInfo","event":"EndOfTurn","transcript":"Book it "}',
  )
  equal(stream.close(), { seconds: 1, dollars: 0.0077 / 60 })
  equal(s.sent.at(-1), '{"type":"CloseStream"}')
  s.fire('close')
  equal(told, ['start', 'Book it'])
})

test('a stream that drops says so once', () => {
  let s = socket()
  let told: string[] = []
  turns({
    provider: DEEPGRAM,
    key: 'k1',
    format: { encoding: 'mulaw', rate: 8000 },
    open: s.open,
    told: { end: () => {}, lost: (why) => told.push(why) },
  })
  s.fire('error')
  s.fire('close')
  equal(told, ['the stream failed'])
})

test('OpenAI speaks PCM made into a call’s μ-law, at its own price', async () => {
  let pcm = new Int16Array(2400).fill(8000)
  let o = answering(() => new Response(new Uint8Array(pcm.buffer)), OPENAI)
  let said = await speak({
    ...o,
    text: 'x'.repeat(1000),
    voice: 'fable',
    format: { encoding: 'mulaw', rate: 8000 },
  })
  equal(new URL(o.asked[0].url).pathname, '/v1/audio/speech')
  equal(
    (o.asked[0].init.headers as Record<string, string>).authorization,
    'Bearer k1',
  )
  let body = JSON.parse(String(o.asked[0].init.body))
  equal([body.voice, body.response_format], ['fable', 'pcm'])
  let audio = new Uint8Array(await new Response(said.body).arrayBuffer())
  equal([audio.length, said.type, said.dollars], [800, 'audio/basic', 0.015])
})

test('a μ-law clip comes without the silence its provider padded it with', async () => {
  // OpenAI's 24 kHz PCM: a tenth of a second of silence, a sound with a
  // pause inside, and a quarter second of silence after.
  let pcm = new Int16Array([
    ...Array(2400).fill(0),
    ...Array(300).fill(8000),
    ...Array(300).fill(0),
    ...Array(300).fill(8000),
    ...Array(6000).fill(0),
  ])
  let o = answering(() => new Response(new Uint8Array(pcm.buffer)), OPENAI)
  let said = await speak({
    ...o,
    text: 'Hi.',
    format: { encoding: 'mulaw', rate: 8000 },
  })
  let audio = new Uint8Array(await new Response(said.body).arrayBuffer())
  // At the call's 8 kHz, 50 ms kept at each end: 400 + 100 + 100 + 100 + 400.
  equal(audio.length, 1100)
})

// A talk stream on OpenAI's realtime model, the caller's audio sent and the
// model's events fired back.
let talking = (
  calls: (name: string, args: string) => Promise<string>,
  speed?: number,
) => {
  let s = socket()
  let told: unknown[] = []
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    format: { encoding: 'mulaw', rate: 8000 },
    voice: 'cedar',
    speed,
    instructions: 'Be brief.',
    tools: [{ name: 'ask', description: 'Ask.', parameters: {} }],
    open: s.open,
    told: {
      over: () => told.push('over'),
      stopped: () => told.push('stopped'),
      heard: (text) => told.push({ heard: text }),
      audio: (bytes) => told.push([...bytes]),
      said: (text) => told.push({ said: text }),
      call: calls,
      done: () => told.push('done'),
      lost: (why) => told.push('lost: ' + why),
    },
  })
  let event = (e: object) => s.fire('message', JSON.stringify(e))
  return { s, told, stream, event }
}

test('a talk stream is set up with the voice, tools and μ-law, then hears and speaks', () => {
  let { s, told, stream, event } = talking(() => Promise.resolve(''))
  equal(s.opened[0], {
    url: 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini',
    protocols: ['realtime', 'openai-insecure-api-key.k1'],
  })
  stream.send(new Uint8Array([1, 2]))
  s.fire('open')
  let [setup, audio] = s.json()
  equal(setup.session.audio.output, {
    format: { type: 'audio/pcmu' },
    voice: 'cedar',
  })
  equal(setup.session.tools[0].type, 'function')
  equal(audio, { type: 'input_audio_buffer.append', audio: 'AQI=' })
  event({ type: 'input_audio_buffer.speech_started' })
  event({ type: 'input_audio_buffer.speech_stopped' })
  event({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: ' Hello ',
  })
  event({ type: 'response.output_audio.delta', delta: 'AwQ=' })
  event({ type: 'response.output_audio_transcript.done', transcript: 'Hi.' })
  // The response names no model, so it is priced at the session's.
  event({
    type: 'response.done',
    response: {
      model: null,
      usage: {
        input_token_details: { audio_tokens: 100_000 },
        output_token_details: { audio_tokens: 50_000 },
      },
    },
  })
  equal(told, ['stopped', { heard: 'Hello' }, [3, 4], {
    said: 'Hi.',
  }, 'done'])
  equal(stream.close(), { seconds: 2 / 8000, dollars: 2 })
})

test('a tool the model asks for is answered with its output, and it goes on', async () => {
  let asked: string[] = []
  let { s, event } = talking((name, args) => {
    asked.push(`${name} ${args}`)
    return Promise.resolve('Booked.')
  })
  s.fire('open')
  event({
    type: 'response.function_call_arguments.done',
    call_id: 'c1',
    name: 'ask',
    arguments: '{"request":"Book it"}',
  })
  await until(() => s.sent.length == 3)
  equal(asked, ['ask {"request":"Book it"}'])
  equal(s.json().slice(1), [
    {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'c1', output: 'Booked.' },
    },
    { type: 'response.create' },
  ])
})

test('a response asked for while one is under way waits for it to be done', async () => {
  let { s, stream, event } = talking(() => Promise.resolve('Booked.'))
  s.fire('open')
  let created = () => s.json().filter((m) => m.type == 'response.create').length
  event({ type: 'response.created' })
  for (let id of ['c1', 'c2']) {
    event({
      type: 'response.function_call_arguments.done',
      call_id: id,
      name: 'ask',
      arguments: '{}',
    })
  }
  stream.say('One moment.')
  await until(() => s.sent.length == 3)
  equal(created(), 0)
  // Done, it is asked to say its words, and only then once to go on with
  // both answers.
  let saying = (m: { response?: { instructions?: string } }) =>
    m.response?.instructions?.endsWith('One moment.')
  event({ type: 'response.done' })
  equal(saying(s.json().at(-1)), true)
  // Refused as another began first, it is asked again once that one is done.
  event({
    type: 'error',
    error: { code: 'conversation_already_has_active_response', message: 'x' },
  })
  event({ type: 'response.done' })
  equal(saying(s.json().at(-1)), true)
  event({ type: 'response.done' })
  equal(s.json().at(-1), { type: 'response.create' })
  event({ type: 'response.done' })
  equal(created(), 3)
})

test('a caller talking over the model stops it only once their words say something', () => {
  let { s, told, event } = talking(() => Promise.resolve(''))
  s.fire('open')
  let hear = (...words: string[]) => {
    event({ type: 'input_audio_buffer.speech_started' })
    for (let delta of words) {
      event({
        type: 'conversation.item.input_audio_transcription.delta',
        delta,
      })
    }
  }
  let cancels = () => s.json().filter((m) => m.type == 'response.cancel').length
  event({ type: 'response.created' })
  event({ type: 'response.output_audio.delta', delta: 'AQ==' })
  // An "okay", a laugh or one word lets it go on.
  hear(' Okay', '.', ' Ha', '.', ' Cool', ',', ' uh')
  hear(' One', '.')
  equal(told, [[1]])
  equal(cancels(), 0)
  // Words that say something stop what plays and the response under way,
  // whose audio still on its way is not played.
  hear(' Okay', ',', ' hold', ' on', ',', ' I')
  event({ type: 'response.output_audio.delta', delta: 'Ag==' })
  equal(told, [[1], 'over'])
  equal(cancels(), 1)
  event({ type: 'response.done' })
  // Once the response is done, a caller talking over what still plays
  // stops it with nothing to cancel, and a stop too late is no failure.
  hear(' Wait', ' stop')
  event({
    type: 'error',
    error: { code: 'response_cancel_not_active', message: 'x' },
  })
  event({ type: 'response.output_audio.delta', delta: 'Aw==' })
  equal(told, [[1], 'over', 'done', 'over', [3]])
  equal(cancels(), 1)
})
