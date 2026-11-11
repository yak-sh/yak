// Calls a talking model's own line carries (operator-carried.ts): its
// webhook door's refusals, and one call joined without its audio.
import { equal, test, until } from '@yaks/testing'
import { OPENAI, type Socket, talk } from '@yaks/speech'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { type Around, talking } from './operator-calls.ts'
import { carriedDoor } from './operator-carried.ts'

let KEY = 'a probe key'
let enc = new TextEncoder()
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))

// OpenAI's API, keeping what it was asked.
let asked: { path: string; body: string }[] = []
let openai = endpoints(globalThis).open(async (req) => {
  asked.push({ path: new URL(req.url).pathname, body: await req.text() })
  return new Response(null)
})

// The webhook OpenAI rings, signed as Standard Webhooks signs it.
let rung = async (event: object, key = KEY) => {
  let body = JSON.stringify(event), at = String(Math.floor(Date.now() / 1000))
  let mac = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey(
      'raw',
      enc.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    ),
    enc.encode(`wh_1.${at}.${body}`),
  )
  return new Request('https://yaks.app/openai/calls', {
    method: 'POST',
    headers: {
      'webhook-id': 'wh_1',
      'webhook-timestamp': at,
      'webhook-signature': `v1,${b64(mac)}`,
    },
    body,
  })
}

let incoming = (from: string) => ({
  type: 'realtime.call.incoming',
  data: {
    call_id: 'rtc_1',
    sip_headers: [{ name: 'From', value: `"Caller" <sip:${from}@sip.x>` }],
  },
})

test('the door takes only a signed webhook, and refuses a call from anyone the platform does not know', async () => {
  let p = platform('carried', {
    PHONE_SENDER: { via: 'telnyx', number: '+18663141594' },
    TELNYX_API_KEY: 'a-key',
    OPENAI_VOICE_KEY: 'k1',
    OPENAI_CALLS_SECRET: `whsec_${btoa(KEY)}`,
    SPEECH_API: openai.url,
  })
  await stamp(p.env, {
    entities: [{ entity: { eid: crypto.randomUUID() }, person: {} }],
  })
  let door = async (req: Request) =>
    (await carriedDoor(req, p.env, OPENAI)).status
  asked.length = 0
  equal(await door(await rung(incoming('+12695550199'), 'another key')), 401)
  equal(await door(await rung({ type: 'realtime.call.ended' })), 204)
  equal(asked, [])
  equal(await door(await rung(incoming('+12695550199'))), 204)
  equal(asked, [{
    path: '/v1/realtime/calls/rtc_1/reject',
    body: '{"status_code":486}',
  }])
})

// One carried call: the Operator's conversation around a stream joined to
// the call, its socket a stand-in a test speaks into.
let carried = () => {
  let on: Record<string, ((e: { data?: unknown; code?: number }) => void)[]> =
    {}
  let sent: unknown[] = []
  let socket: Socket = {
    send: (data) => void sent.push(JSON.parse(String(data))),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let done: Parameters<Around['done']>[0][] = []
  let hungUp = 0, asked: string[] = [], reported: unknown[] = []
  let call = talking({
    call: 'rtc_1',
    talk: (told, opens) =>
      talk({
        provider: OPENAI,
        key: 'k1',
        call: 'rtc_1',
        instructions: 'Be the Operator.',
        told,
        opens,
        open: () => socket,
      }),
    note: () => Promise.resolve(),
    ask: (text) => Promise.resolve(void asked.push(text)),
    hello: 'Hi.',
    charge: () => Promise.resolve(),
    done: (call) => Promise.resolve(void done.push(call)),
    hangup: () => Promise.resolve(void hungUp++),
    report: (e) => void reported.push(e),
  })
  on.open.forEach((h) => h({}))
  let tell = (...events: object[]) =>
    events.forEach((e) =>
      on.message.forEach((h) => h({ data: JSON.stringify(e) }))
    )
  let close = (code: number) => on.close.forEach((h) => h({ code }))
  return { call, sent, done, reported, hungUp: () => hungUp, tell, close }
}

test('a carried call says hello on the line, times its turns by when the model starts playing, and ends with the call', async () => {
  let c = carried()
  equal(c.sent, [{
    type: 'response.create',
    response: {
      instructions:
        'Say only the message below, without reading its source label aloud:\nHi.',
      tool_choice: 'none',
    },
  }])
  c.tell(
    { type: 'input_audio_buffer.speech_started' },
    { type: 'input_audio_buffer.speech_stopped' },
    { type: 'output_audio_buffer.started' },
  )
  c.close(1000)
  await c.call.ended
  equal(c.done[0].ended, 'ended')
  equal(typeof c.done[0].turns[0].answer, 'number')
  // The call ended on the line: nothing is left to hang up.
  equal([c.hungUp(), c.reported], [0, []])
})

test('a carried call whose stream drops is hung up, not left with a model alone', async () => {
  let c = carried()
  c.close(1006)
  await c.call.ended
  await until(() => c.hungUp() == 1)
  equal(
    (c.reported[0] as Error).message,
    "A call's talk stream was lost: the stream closed",
  )
})
