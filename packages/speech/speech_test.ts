import { equal, test, until } from '@yaks/testing'
import { assertRejects, assertThrows } from '@std/assert'
import {
  accept,
  balance,
  DEEPGRAM,
  hear,
  type Keyed,
  OPENAI,
  type Provider,
  type Socket,
  sounds,
  speak,
  SpeechError,
  talk,
  turns,
  unbase64,
  type Words,
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

// What Deepgram answers a recording, its utterances each `[speaker, text,
// from, to]`.
let listened = (
  duration: number,
  ...said: [number, string, number, number][]
) =>
  Response.json({
    metadata: { duration },
    results: {
      channels: [{
        alternatives: [{ transcript: said.map(([, text]) => text).join(' ') }],
      }],
      utterances: said.map(([speaker, transcript, start, end]) => ({
        speaker,
        transcript,
        start,
        end,
      })),
    },
  })

test('a recording is heard with its type, priced by its minutes', async () => {
  let o = answering(() => listened(60, [0, 'Call me', 0.5, 1.25]))
  equal(await hear({ ...o, audio: new Uint8Array([1]), type: 'audio/webm' }), {
    text: 'Call me',
    turns: [{ speaker: 0, text: 'Call me', from: 0.5, to: 1.25 }],
    seconds: 60,
    dollars: 0.0043,
  })
  equal(
    (o.asked[0].init.headers as Record<string, string>)['content-type'],
    'audio/webm',
  )
})

test('a recording of two voices is heard as turns, each with its speaker', async () => {
  let o = answering(() =>
    listened(
      9,
      [0, 'I move we adopt the budget.', 0.3, 2.1],
      [1, 'Second.', 2.6, 3.0],
      [0, 'All in favor?', 3.4, 4.2],
    )
  )
  let got = await hear({ ...o, audio: new Uint8Array([1]), type: 'audio/wav' })
  equal(got.turns, [
    { speaker: 0, text: 'I move we adopt the budget.', from: 0.3, to: 2.1 },
    { speaker: 1, text: 'Second.', from: 2.6, to: 3.0 },
    { speaker: 0, text: 'All in favor?', from: 3.4, to: 4.2 },
  ])
  equal(got.text, 'I move we adopt the budget. Second. All in favor?')
  let asked = new URL(o.asked[0].url).searchParams
  equal([asked.get('diarize_model'), asked.get('utterances')], [
    'latest',
    'true',
  ])
})

// A socket that keeps what it was sent and lets a test say what it hears.
let socket = () => {
  let on: Record<string, ((e: { data?: unknown; code?: number }) => void)[]> =
    {}
  let sent: (string | Uint8Array)[] = []
  let opened: { url: string; protocols: string[] }[] = []
  let json = () => sent.map((m) => JSON.parse(String(m)))
  let s: Socket = {
    send: (data) => void sent.push(data),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let fire = (type: string, data?: unknown, code?: number) =>
    on[type]?.forEach((f) => f({ data, code }))
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
  let told: unknown[] = []
  let stream = turns({
    provider: DEEPGRAM,
    key: 'k1',
    format: { encoding: 'mulaw', rate: 8000 },
    open: s.open,
    told: {
      start: () => told.push('start'),
      end: (turn) => told.push(turn),
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
    JSON.stringify({
      type: 'TurnInfo',
      event: 'EndOfTurn',
      transcript: 'Book it ',
      audio_window_start: '0.25',
      audio_window_end: '1.0',
    }),
  )
  s.fire('message', '{"type":"TurnInfo","event":"EndOfTurn","transcript":""}')
  equal(stream.close(), { seconds: 1, dollars: 0.0077 / 60 })
  equal(s.sent.at(-1), '{"type":"CloseStream"}')
  s.fire('close')
  equal(told, ['start', { speaker: 0, text: 'Book it', from: 0.25, to: 1 }])
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

let MULAW = { encoding: 'mulaw', rate: 8000 } as const
let HELLO = 'Hi Jeff, Elihu here. How can I help?'

// A caller's line on a talk stream: `say` and `hush` send seconds of a sound
// or of a quiet line, and `heard` is whether each frame the model was sent
// since it last answered holds a sound.
let line = (
  s: ReturnType<typeof socket>,
  stream: { send: (audio: Uint8Array) => void },
) => {
  let from = 0
  let frame = (byte: number) => (seconds: number) =>
    stream.send(new Uint8Array(seconds * MULAW.rate).fill(byte))
  return {
    say: frame(0x10),
    hush: frame(0xff),
    heard: () => {
      let sent = s.json().filter((m) => m.audio)
      let frames = sent.slice(from).map((m) => sounds(unbase64(m.audio), MULAW))
      from = sent.length
      return frames
    },
  }
}

// A talk stream on OpenAI's realtime model, the caller's audio sent and the
// model's events fired back.
let talking = (
  calls: (name: string, args: string) => Promise<Words>,
  speed?: number,
  opens?: string,
) => {
  let s = socket()
  let told: unknown[] = []
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    format: MULAW,
    voice: 'cedar',
    speed,
    opens,
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
      item: {
        type: 'function_call_output',
        call_id: 'c1',
        output: 'From the ask tool:\nBooked.',
      },
    },
    { type: 'response.create' },
  ])
})

test('what the model is told mid-stream is a note it reads, asking no response', () => {
  let { s, stream } = talking(() => Promise.resolve(''))
  s.fire('open')
  stream.tell('You are building the recipe app.')
  equal(s.json().slice(1), [{
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'system',
      content: [{
        type: 'input_text',
        text: 'From the system:\nYou are building the recipe app.',
      }],
    },
  }])
})

test('talk streams preserve the source of supplied context, replies and failures', async () => {
  let cases: [() => Promise<Words>, string][] = [
    [() => Promise.resolve('No such app.'), 'From the ask tool:\nNo such app.'],
    [
      () => Promise.resolve({ text: 'Done.', from: 'the Operator' }),
      'From the Operator:\nDone.',
    ],
    [
      () => Promise.reject(new Error('Unavailable.')),
      'From the system:\nThat did not work: Unavailable.',
    ],
  ]
  for (let [answer, output] of cases) {
    let { s, stream, event } = talking(answer)
    s.fire('open')
    stream.tell('A fix is available.', 'TaskMaster')
    equal(
      s.json().at(-1).item.content[0].text,
      'From TaskMaster:\nA fix is available.',
    )
    event({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'ask',
      arguments: '{}',
    })
    await until(() => s.sent.length == 4)
    equal(s.json().at(-2).item.output, output)
    stream.close()
  }
  let { s, stream } = talking(() => Promise.resolve(''))
  s.fire('open')
  stream.say('The task is done.', 'the Operator')
  equal(
    s.json().at(-1).response.instructions.endsWith(
      'From the Operator:\nThe task is done.',
    ),
    true,
  )
  stream.close()
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

test('a stream that opens on the model’s first words asks for them once, and the model hears a quiet line until they have played', () => {
  let { s, told, stream, event } = talking(
    () => Promise.resolve(''),
    1,
    HELLO,
  )
  let caller = line(s, stream)
  s.fire('open')
  // Its own words, so they name no source to read aloud, and it has no
  // tool to ask for in place of saying them.
  equal(s.json().filter((m) => m.type == 'response.create'), [{
    type: 'response.create',
    response: {
      instructions:
        `Say only the message below, without reading its source label aloud:\n${HELLO}`,
      tool_choice: 'none',
    },
  }])
  // A hello of the caller's as the line picks up, and another over half a
  // second of greeting, are a quiet line to the model: it has no turn to
  // answer with a greeting of its own.
  caller.say(0.5)
  event({ type: 'response.created' })
  event({
    type: 'response.output_audio.delta',
    delta: btoa('\x10'.repeat(4000)),
  })
  event({ type: 'response.done' })
  caller.say(0.25)
  equal(caller.heard(), [false, false])
  // The greeting has played once the line has run as long as it lasts.
  caller.say(0.25)
  caller.say(0.5)
  equal(caller.heard(), [true, true])
  equal(told.filter((t) => t == 'done').length, 1)
  equal(s.json().filter((m) => m.type == 'response.create').length, 1)
})

test('a response asked to say given words plays its answer alone, not the words it says before it', () => {
  let { s, told, stream, event } = talking(() => Promise.resolve(''))
  s.fire('open')
  let part = (id: string, phase: string, byte: string, transcript: string) => {
    event({ type: 'response.output_item.added', item: { id, phase } })
    event({ type: 'response.output_audio.delta', item_id: id, delta: byte })
    event({
      type: 'response.output_audio_transcript.done',
      item_id: id,
      transcript,
    })
  }
  let respond = () => {
    event({ type: 'response.created' })
    part('i1', 'commentary', 'AQ==', 'One moment.')
    part('i2', 'final_answer', 'Ag==', 'Booked.')
    event({ type: 'response.done' })
  }
  // The model said the line twice in one response, as two parts.
  stream.say('Booked.')
  respond()
  equal(told, [[2], { said: 'Booked.' }, 'done'])
  // A turn's answer keeps the word the model says while it works.
  told.length = 0
  event({ type: 'input_audio_buffer.speech_started' })
  event({ type: 'input_audio_buffer.speech_stopped' })
  event({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'Book it.',
  })
  respond()
  equal(told, [
    'stopped',
    { heard: 'Book it.' },
    [1],
    { said: 'One moment.' },
    [2],
    { said: 'Booked.' },
    'done',
  ])
})

test('a model that never begins its first words hears the caller after six seconds', () => {
  let { s, stream } = talking(() => Promise.resolve(''), 1, HELLO)
  let caller = line(s, stream)
  s.fire('open')
  caller.say(5.5)
  caller.say(0.5)
  caller.say(1)
  equal(caller.heard(), [false, true, true])
})

// A talk stream a caller speaks to: `speak` starts their turn, `quiet` is
// seconds of a quiet line at 8 kHz μ-law and `loud` a sound, `heard` their
// words once heard, and `says` the model's audio. `sent` counts what was sent
// of a type.
let calling = () => {
  let c = talking(() => Promise.resolve(''))
  c.s.fire('open')
  let { s, stream, event } = c
  return {
    ...c,
    speak: () => event({ type: 'input_audio_buffer.speech_started' }),
    quiet: (seconds = 0.7) =>
      stream.send(new Uint8Array(Math.round(seconds * 8000)).fill(0xff)),
    loud: () => stream.send(new Uint8Array(160).fill(0x10)),
    heard: (transcript: string) =>
      event({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript,
      }),
    says: () => event({ type: 'response.output_audio.delta', delta: 'AwQ=' }),
    done: () => event({ type: 'response.done' }),
    sent: (type: string) => s.json().filter((m) => m.type == type).length,
  }
}

test('a caller turn ends when the model hears it end, or once quiet, and its answer waits for their words', () => {
  let { told, speak, quiet, heard, says, done, sent, event } = calling()
  speak()
  event({ type: 'input_audio_buffer.speech_stopped' })
  says()
  heard('Tuesday.')
  done()
  equal([sent('response.create'), sent('input_audio_buffer.commit')], [1, 0])
  speak()
  quiet(0.5)
  equal(sent('response.create'), 1)
  quiet(0.2)
  // Their words still heard once it ended are its own, not talking over.
  for (let delta of [' What', ' time', ' is', ' it']) {
    event({ type: 'conversation.item.input_audio_transcription.delta', delta })
  }
  says()
  event({ type: 'response.output_audio_transcript.done', transcript: 'Hi.' })
  equal([sent('response.create'), sent('input_audio_buffer.commit')], [2, 1])
  equal(sent('response.cancel'), 0)
  equal(told.length, 5)
  heard('What time is it?')
  equal(told.slice(5), [{ heard: 'What time is it?' }, [3, 4], { said: 'Hi.' }])
  equal(told.slice(0, 5), [
    'stopped',
    { heard: 'Tuesday.' },
    [3, 4],
    'done',
    'stopped',
  ])
})

test('an answer is not said when the caller stops where a sentence goes on, the model listens, or they talk first; left unanswered, it comes once they are long quiet', () => {
  let { s, told, speak, quiet, loud, heard, says, done, sent, event } =
    calling()
  let answers = () => told.filter((t) => Array.isArray(t)).length
  // "My address is": what the model began to say is stopped, and nothing
  // is said until they have been quiet 5 s, asked with their tools alone.
  speak()
  quiet()
  says()
  heard('My address is')
  done()
  quiet(4)
  equal([answers(), sent('response.cancel'), sent('response.create')], [
    0,
    1,
    1,
  ])
  quiet(1)
  let reply = s.json().at(-1)
  equal(reply.response.tools.map((t: { name: string }) => t.name), ['ask'])
  says()
  done()
  equal(answers(), 1)
  // The model asks to listen.
  speak()
  quiet()
  event({
    type: 'response.function_call_arguments.done',
    call_id: 'l1',
    name: 'listen',
    arguments: '{}',
  })
  heard('Book it for Friday.')
  done()
  equal(s.json().at(-1).item, {
    type: 'function_call_output',
    call_id: 'l1',
    output: 'From the system:\nListening.',
  })
  // Talking again before it plays: the answer under way is stopped, and the
  // one after their words is said.
  speak()
  quiet()
  heard('Okay.')
  loud()
  says()
  speak()
  quiet()
  says()
  done()
  says()
  equal([answers(), sent('response.cancel')], [1, 3])
  heard('So I need a plumber.')
  equal(answers(), 2)
})

test('a call the provider’s own line carries is accepted with the session, then joined without audio', async () => {
  let o = answering(() => new Response(null))
  await accept({
    ...o,
    provider: OPENAI,
    call: 'rtc_1',
    voice: 'marin',
    instructions: 'Be brief.',
  })
  let body = JSON.parse(String(o.asked[0].init.body))
  equal(o.asked[0].url, 'https://api.openai.com/v1/realtime/calls/rtc_1/accept')
  equal([body.model, body.audio.output, 'format' in body.audio.input], [
    'gpt-realtime-2.1-mini',
    { voice: 'marin' },
    false,
  ])
  let s = socket()
  let told: unknown[] = []
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    call: 'rtc_1',
    instructions: 'Be brief.',
    open: s.open,
    told: {
      audio: () => told.push('audio'),
      over: () => told.push('over'),
      plays: () => told.push('plays'),
      ended: () => told.push('ended'),
      lost: (why) => told.push('lost: ' + why),
      call: () => Promise.resolve(''),
    },
  })
  let event = (e: object) => s.fire('message', JSON.stringify(e))
  equal(s.opened[0].url, 'wss://api.openai.com/v1/realtime?call_id=rtc_1')
  stream.send(new Uint8Array([1, 2]))
  s.fire('open')
  equal(s.sent, [])
  // Talked over, the line is told to stop playing even with no response
  // under way: what the model said may still be playing.
  event({ type: 'output_audio_buffer.started' })
  event({ type: 'input_audio_buffer.speech_started' })
  for (let delta of [' Hold', ' on']) {
    event({ type: 'conversation.item.input_audio_transcription.delta', delta })
  }
  equal(s.json(), [{ type: 'output_audio_buffer.clear' }])
  s.fire('close', undefined, 1000)
  equal(told, ['plays', 'over', 'ended'])
  equal(stream.close().seconds, 0)
})

test('a joined call’s stream that drops is lost, not ended', () => {
  let s = socket()
  let told: unknown[] = []
  talk({
    provider: OPENAI,
    key: 'k1',
    call: 'rtc_1',
    instructions: '',
    open: s.open,
    told: {
      audio: () => {},
      ended: () => told.push('ended'),
      lost: (why) => told.push(why),
      call: () => Promise.resolve(''),
    },
  })
  s.fire('close', undefined, 1006)
  equal(told, ['the stream closed'])
})

test('OpenAI’s webhook says which call rang, with its headers', () => {
  let rang = OPENAI.talk![0].calls!.rang
  equal(
    rang({
      type: 'realtime.call.incoming',
      data: {
        call_id: 'rtc_1',
        sip_headers: [{ name: 'X-Yak-Call', value: 'sealed' }],
      },
    }),
    { id: 'rtc_1', headers: { 'x-yak-call': 'sealed' } },
  )
  equal(
    rang({ type: 'realtime.call.ended', data: { call_id: 'x' } }),
    undefined,
  )
})

test('GPT-Live is started, takes its own turns, keeps each side’s words as lines, and hands work over', async () => {
  let s = socket()
  let told: unknown[] = []
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    model: 'gpt-live-1',
    format: { encoding: 'mulaw', rate: 8000 },
    instructions: 'Be brief.',
    open: s.open,
    told: {
      stopped: (ago) => told.push(`stopped ${ago}`),
      heard: (text) => told.push({ heard: text }),
      said: (text) => told.push({ said: text }),
      audio: (bytes) => told.push(bytes.length),
      call: () => Promise.resolve(''),
      delegate: (
        request,
      ) => (told.push({ delegate: request }),
        Promise.resolve({ text: 'Moved to Friday.', from: 'the Operator' })),
    },
  })
  let event = (e: object) => s.fire('message', JSON.stringify(e))
  let types = () => s.json().map((m) => m.type)
  equal(s.opened[0].url, 'wss://api.openai.com/v1/live/sessions')
  s.fire('open')
  // Nothing goes before the session started.
  stream.say('Hello.')
  stream.send(new Uint8Array(160).fill(0x10))
  equal(types(), ['session.start'])
  equal(s.json()[0].session.audio, {
    format: { type: 'audio/pcmu', rate: 8000 },
    output: { voice: 'cedar' },
  })
  event({ type: 'session.started' })
  equal(types(), [
    'session.start',
    'session.commentary.append',
    'session.input_audio.append',
  ])
  // 0.4 s quiet after the caller spoke: the answer's first sound times
  // from their last, and quiet audio plays as it comes.
  stream.send(new Uint8Array(3200).fill(0xff))
  event({ type: 'session.input_transcript.delta', delta: ' Move it' })
  event({ type: 'session.input_transcript.delta', delta: ' to Friday.' })
  event({ type: 'session.output_audio.delta', delta: '//8=' })
  event({ type: 'session.output_audio.delta', delta: 'EBA=' })
  event({ type: 'session.output_transcript.delta', delta: ' One moment.' })
  event({ type: 'session.delegation.created', delegation: { id: 'd1' } })
  await until(() => s.sent.length == 4)
  equal(told, [2, 'stopped 0.4', 2, { heard: 'Move it to Friday.' }, {
    said: 'One moment.',
  }, { delegate: 'Move it to Friday.' }])
  equal(s.json().at(-1), {
    type: 'session.commentary.append',
    delegation_id: 'd1',
    content: 'From the Operator:\nMoved to Friday.',
  })
  // Priced by the minute of the stream, $0.05.
  equal(stream.close(), { seconds: 0.42, dollars: 0.035 / 100 })
})

test('GPT-Live opens on its first words, asked for as it starts and once it has, and hears a quiet line until it has said them and paused', () => {
  let s = socket()
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    model: 'gpt-live-1',
    format: MULAW,
    instructions: 'Be brief.',
    opens: HELLO,
    open: s.open,
    told: { audio: () => {}, call: () => Promise.resolve('') },
  })
  let caller = line(s, stream)
  let event = (e: object) => s.fire('message', JSON.stringify(e))
  let says = (byte: number, seconds: number) =>
    event({
      type: 'session.output_audio.delta',
      delta: btoa(String.fromCharCode(byte).repeat(seconds * MULAW.rate)),
    })
  s.fire('open')
  let greet =
    `Say exactly this to the caller now, word for word: "${HELLO}" Then pause and listen.`
  equal(s.json()[0].session.input, [{
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: greet }],
  }])
  event({ type: 'session.started' })
  equal(s.json().slice(1), [{
    type: 'session.commentary.append',
    delegation_id: null,
    content: greet,
  }])
  // The caller's hello before it speaks, over its greeting, and in the
  // 0.4 s it pauses between two sentences of it, is a quiet line.
  caller.say(0.5)
  says(0x10, 1)
  caller.say(0.5)
  says(0xff, 0.4)
  caller.say(0.5)
  says(0x10, 1)
  equal(caller.heard(), [false, false, false])
  // Quiet 0.6 s, it has said them: the caller is heard.
  says(0xff, 0.6)
  caller.say(0.5)
  equal(caller.heard(), [true])
  stream.close()
})

test('GPT-Live hands its work to a larger model on OpenAI’s side, whose tool calls are answered here and whose tokens are priced', async () => {
  let s = socket()
  let told: unknown[] = []
  let tools = [{ name: 'apps', description: 'Their apps.', parameters: {} }]
  let stream = talk({
    provider: OPENAI,
    key: 'k1',
    model: 'gpt-live-1',
    format: { encoding: 'mulaw', rate: 8000 },
    instructions: 'Be brief.',
    backend: { model: 'gpt-6-luna', instructions: 'Do the work.', tools },
    open: s.open,
    told: {
      audio: () => {},
      call: (
        name,
        args,
      ) => (told.push({ call: name, args }),
        Promise.resolve('Shopping and Recipes.')),
      delegate: () => (told.push('delegate'), Promise.resolve('')),
    },
  })
  let event = (e: object) => s.fire('message', JSON.stringify(e))
  s.fire('open')
  equal(s.json()[0].session.delegation, {
    type: 'responses',
    responses: {
      model: 'gpt-6-luna',
      instructions: 'From the system:\nDo the work.',
      tools: [
        { type: 'function', ...tools[0], strict: false },
        { type: 'web_search' },
      ],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
    },
  })
  event({ type: 'session.started' })
  // The work is the backend's: nothing here is asked to do it.
  event({
    type: 'session.delegation.created',
    delegation: { id: 'd1', target: 'responses' },
  })
  event({
    type: 'response.event',
    delegation_id: 'd1',
    event: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: 'c1',
        name: 'apps',
        arguments: '{}',
      },
    },
  })
  await until(() => s.sent.length == 3)
  equal(told, [{ call: 'apps', args: '{}' }])
  equal(s.json().slice(1), [{
    type: 'response.item.create',
    item: {
      type: 'function_call_output',
      call_id: 'c1',
      output: 'From the apps tool:\nShopping and Recipes.',
    },
  }, { type: 'response.create' }])
  // 1,000 tokens written to the cache, 4,000 read from it, 1,000 new and 100
  // out, at gpt-6-luna's rates.
  event({
    type: 'response.event',
    delegation_id: 'd1',
    event: {
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 6000,
          output_tokens: 100,
          input_tokens_details: {
            cached_tokens: 4000,
            cache_write_tokens: 1000,
          },
        },
      },
    },
  })
  equal(stream.close().dollars.toFixed(6), '0.000315')
})

test('GPT-Live hands work only to a larger model it has', () => {
  let s = socket()
  let opened = () =>
    talk({
      provider: OPENAI,
      key: 'k1',
      model: 'gpt-live-1',
      format: { encoding: 'mulaw', rate: 8000 },
      instructions: 'Be brief.',
      backend: { model: 'gpt-2', instructions: '', tools: [] },
      open: s.open,
      told: { audio: () => {}, call: () => Promise.resolve('') },
    })
  assertThrows(opened, Error, 'hands no work to gpt-2')
})
