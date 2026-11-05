import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  balance,
  DEEPGRAM,
  hear,
  type Socket,
  speak,
  SpeechError,
  turns,
} from './mod.ts'

// A provider answering every call with `said`, keeping what it was asked.
let answering = (said: (url: string) => Response) => {
  let asked: { url: string; init: RequestInit }[] = []
  let fetch = ((url: string, init: RequestInit) => {
    asked.push({ url: String(url), init })
    return Promise.resolve(said(String(url)))
  }) as typeof globalThis.fetch
  return { asked, fetch, provider: DEEPGRAM, key: 'k1' }
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
  let s: Socket = {
    send: (data) => void sent.push(data),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let fire = (type: string, data?: unknown) =>
    on[type]?.forEach((f) => f({ data }))
  return {
    sent,
    opened,
    fire,
    open: (url: string, protocols: string[]) => {
      opened.push({ url, protocols })
      return s
    },
  }
}

test('a stream sends what it heard once open, tells turns, and prices its seconds', async () => {
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
      'wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000',
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
