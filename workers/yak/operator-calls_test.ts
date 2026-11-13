// Calling the Operator (operator-calls.ts): whom a ring on the platform's
// number answers, the stream door's refusals, the `voice` channel, and one
// call's conversation with its line, speech and Operator stood in for.
import { cleanup, clock, equal, test, until } from '@yaks/testing'
import { CallError } from '@yaks/tools'
import { line } from '@yaks/telnyx'
import { consentEid } from '@yaks/phone'
import {
  OPENAI,
  type Socket,
  talk,
  type Talked,
  type Told,
  type Words,
} from '@yaks/speech'
import type { Request } from '@yaks/model'
import { conversation } from '@yaks/anthropic'
import type { Bundle } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { textDoor } from './operator-texts.ts'
import { within } from './defects.ts'
import {
  type Around,
  converse,
  greeting,
  MINUTES,
  saying,
  streamDoor,
  type Talking,
  talking,
  type Ticket,
  voiced,
} from './operator-calls.ts'
import { opened, seal } from './lib/token.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive, requestId } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { answering, conversationOf, workOf } from './operator-host.ts'
import { ANSWERED, ASKED, HELLO, SMALL_TALK } from './operator-calls_fixture.ts'
import { parseHTML } from 'linkedom'
import { operators } from './operator-service-probe.ts'
import { personaFor } from './operator-persona.ts'
import { setupOf } from './speech.ts'
import { sourceWords } from './operator-source.ts'

let replyText = (words: Words) => typeof words == 'string' ? words : words.text
let HI = greeting('Ada', 'Jeff')
let NUMBER = '+18663141594', JEFF = '+12695550142', ANA = '+12695550143'

// Telnyx's API, keeping the calls it was told to answer or reject.
let acted: { action: string; call: string; body: Record<string, string> }[] = []
let telnyxApi = endpoints(globalThis).open(async (req) => {
  let [, call, action] = /^\/calls\/([^/]+)\/actions\/(\w+)$/.exec(
    new URL(req.url).pathname,
  ) ?? []
  acted.push({
    action,
    call: decodeURIComponent(call),
    body: await req.json(),
  })
  return Response.json({ data: { result: 'ok' } })
})
let signer = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))

let fixture = async () => {
  let p = platform('calls', {
    PHONE_SENDER: { via: 'telnyx', number: NUMBER },
    TELNYX_API: telnyxApi.url,
    TELNYX_API_KEY: 'a-key',
    TELNYX_PUBLIC_KEY: b64(
      await crypto.subtle.exportKey('raw', signer.publicKey),
    ),
    DEEPGRAM_API_KEY: 'a-key',
    BUILDER: operators,
  })
  let jeff = crypto.randomUUID(), ana = crypto.randomUUID()
  let meta = crypto.randomUUID(), own = crypto.randomUUID()
  let mine = crypto.randomUUID()
  await stamp(p.env, {
    entities: [
      {
        entity: { eid: jeff },
        person: {},
        phone: { number: JEFF },
        email: { address: 'jeff@x.test' },
        doc: { title: 'Jeff Peterson' },
      },
      { entity: { eid: ana }, person: {}, phone: { number: ANA } },
      { entity: { eid: meta }, space: { slug: 'yak', store: 'yak' } },
      { entity: { eid: own }, space: { slug: 'ana', store: 'ana' } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: jeff, space: meta, role: 'owner' },
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: ana, space: own, role: 'owner' },
      },
      { entity: { eid: mine }, space: { slug: 'jeff', store: 'jeff' } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: jeff, space: mine, role: 'owner' },
      },
    ],
  })
  let ring = async (
    from: string,
    to = NUMBER,
    id: string = crypto.randomUUID(),
  ) => {
    let body = JSON.stringify({
      data: {
        event_type: 'call.initiated',
        occurred_at: '2026-11-05T20:00:00Z',
        payload: {
          call_control_id: `v3:${id}`,
          from,
          to,
          direction: 'incoming',
        },
      },
    })
    let t = String(Math.floor(Date.now() / 1000))
    let signature = b64(
      await crypto.subtle.sign(
        'Ed25519',
        signer.privateKey,
        new TextEncoder().encode(`${t}|${body}`),
      ),
    )
    acted.length = 0
    equal(
      (await textDoor(
        new Request('https://yaks.app/telnyx/webhook', {
          method: 'POST',
          headers: {
            'telnyx-timestamp': t,
            'telnyx-signature-ed25519': signature,
          },
          body,
        }),
        p.env,
        'telnyx',
      )).status,
      200,
    )
    return acted.map((a) => a.action)
  }
  return { p, ring, jeff, ana, own }
}

test('everyone the platform knows by number is answered, streamed to the stream door', async () => {
  let { p, ring } = await fixture()
  equal(await ring(JEFF, NUMBER, 'c1'), ['answer'])
  let answer = acted[0]
  equal(answer.call, 'v3:c1')
  equal(answer.body.stream_bidirectional_mode, 'rtp')
  equal(answer.body.stream_bidirectional_codec, 'PCMU')
  equal(
    answer.body.stream_url.startsWith('wss://yaks.app/telnyx/stream?call='),
    true,
  )
  // The ticket carries what to call them, for the greeting.
  let sealed = new URL(answer.body.stream_url).searchParams.get('call')!
  equal(
    (await opened<Ticket>('call', sealed, p.env.SESSION_SECRET!))?.first,
    'Jeff',
  )
  equal(await ring(ANA), ['answer'])
  equal(await ring('+12695550199'), ['reject'])
  // A call to another number is not the Operator's to take.
  equal(await ring(JEFF, '+18885550100'), [])
})

test('the stream door opens nothing without a ticket sealed here for a call that may still be on', async () => {
  let { p, own, ana } = await fixture()
  let at = (call: string, upgrade = true) =>
    streamDoor(
      new Request(`https://yaks.app/telnyx/stream?call=${call}`, {
        headers: upgrade ? { upgrade: 'websocket' } : {},
      }),
      p.env,
    ).then((r) => r.status)
  let ticket = {
    space: own,
    person: ana,
    call: 'v3:c',
    from: ANA,
    to: NUMBER,
    via: 'telnyx',
    at: Date.now() - (MINUTES + 1) * 60_000 - 1000,
  }
  equal(await at('x', false), 426)
  equal(await at('forged'), 404)
  equal(
    await at(encodeURIComponent(
      await seal('call', ticket, p.env.SESSION_SECRET!),
    )),
    404,
  )
})

test('a stream reopened on a ticket too old for its call is refused and reported', async () => {
  let { p, own, ana } = await fixture()
  let rows: Bundle[][] = []
  let env = {
    ...p.env,
    ERRORS: {
      send: (sample: Bundle[]) => Promise.resolve(void rows.push(sample)),
    },
  }
  let ticket = {
    space: own,
    person: ana,
    call: 'v3:c',
    from: ANA,
    to: NUMBER,
    via: 'telnyx',
    at: Date.now() - 12 * 60_000,
  }
  let sealed = await seal('call', ticket, p.env.SESSION_SECRET!)
  let refused = await within(env, {}, () =>
    streamDoor(
      new Request(
        `https://yaks.app/telnyx/stream?call=${encodeURIComponent(sealed)}`,
        { headers: { upgrade: 'websocket' } },
      ),
      env,
    ), clock())
  equal(refused.status, 404)
  await until(() => rows.length == 1)
  let [failure] = rows[0]
  equal(
    (failure.exception as { value: string }).value,
    "A call's stream was refused: its ticket is 720 s old",
  )
  equal((failure.error as { tags: unknown }).tags, {
    request: 'operator call',
  })
})

test('a call charges what it used as it goes, so the object restarted under it and the stream opened again charge it all once', async () => {
  let charged: { seconds: number; heard: number }[] = []
  let lost: unknown[] = []
  let time = clock()
  // Each opening hears a cent's worth a frame, and charges every 10 ms.
  let opening = () => {
    let cents = 0
    return calling(undefined, {
      time,
      every: 10,
      back: 20,
      charge: (used) => Promise.resolve(void charged.push(used)),
      listen: () => ({
        send: () => void cents++,
        spent: () => ({ seconds: cents, dollars: cents / 100 }),
        close: () => ({ seconds: cents, dollars: cents / 100 }),
      }),
      report: (e) => void lost.push(e),
    })
  }
  let sum = () => charged.reduce((n, u) => n + u.heard, 0)
  let audio = { event: 'media', media: { track: 'inbound', payload: 'AQI=' } }
  let first = opening()
  for (let i = 0; i < 3; i++) first.frame(audio)
  // Charged before anything ended it.
  await time.advance(10)
  await until(() => sum() == 0.03)
  first.frame(audio)
  // The object restarts: the line it carried drops before the call ended,
  // and the provider opens the stream again.
  first.hangup(1006)
  await first.call.ended
  let again = opening()
  for (let i = 0; i < 2; i++) again.frame(audio)
  again.frame({ event: 'stop' })
  await again.call.ended
  equal(sum().toFixed(2), '0.06')
  await time.advance(20)
  equal(lost, [])
})

test('a line that drops is reported lost once its stream has not opened again', async () => {
  for (let code of [1006, 1011]) {
    let lost: unknown[] = []
    let time = clock()
    let c = calling(undefined, {
      time,
      back: 10,
      report: (e) => void lost.push(e),
    })
    c.hangup(code)
    await c.call.ended
    equal(c.done[0].ended, `close ${code}`)
    await time.advance(9)
    equal(lost, [])
    await time.advance(1)
    equal(lost.length, 1)
    equal(
      (lost[0] as Error).message,
      `A call's line closed with ${code} before it ended`,
    )
  }
})

test('a line that sends nothing is lost, and the call lets its sockets go', async () => {
  let lost: unknown[] = [], closed: string[] = []
  let time = clock()
  let c = calling(undefined, {
    time,
    quiet: 10,
    back: 5,
    report: (e) => void lost.push(e),
    listen: () => ({
      send: () => {},
      spent: () => ({ seconds: 0, dollars: 0 }),
      close: () => (closed.push('speech'), { seconds: 0, dollars: 0 }),
    }),
  })
  await time.advance(6)
  c.frame({ event: 'media', media: { track: 'inbound', payload: 'AQI=' } })
  await time.advance(6)
  equal(c.done, [])
  await time.advance(4)
  await c.call.ended
  equal([c.done[0].ended, closed], ['quiet', ['speech']])
  await time.advance(5)
  equal((lost[0] as Error).message, "A call's line went quiet before it ended")
})

test('a line opened again for a call ends the one it replaced, which is not lost', async () => {
  let lost: unknown[] = []
  let time = clock()
  let opening = () =>
    calling(undefined, { time, back: 5, report: (e) => void lost.push(e) })
  let first = opening(), again = opening()
  await first.call.ended
  equal(first.done[0].ended, 'again')
  again.frame({ event: 'stop' })
  await again.call.ended
  await time.advance(5)
  equal(lost, [])
})

test('a line closed cleanly ends the call quietly, with or without the provider saying it stopped', async () => {
  for (let code of [1000, 1001, undefined]) {
    let c = calling()
    c.hangup(code)
    await c.call.ended
    equal(c.done[0].ended, `close ${code ?? 1005}`)
  }
  let c = calling()
  c.frame({ event: 'stop' })
  c.hangup(1000)
  await c.call.ended
  equal(c.done.map((d) => d.ended), ['stop'])
})

test('an answer is texted once the call is over, to a caller who agreed to texts', async () => {
  let { p, ana, own } = await fixture()
  let texts = 0
  let texted = () => Promise.resolve({ id: String(++texts) })
  equal(await voiced(p.env, { space: own, person: ana }, 'Done', texted), {})
  equal(texts, 0)
  await stamp(p.env, {
    entities: [{
      entity: { eid: consentEid(ana) },
      sms_consent: { person: ana, consent: 'yes', at: '2026-11-05T00:00:00Z' },
    }],
  })
  equal(await voiced(p.env, { space: own, person: ana }, 'Done', texted), {
    id: '1',
  })
})

// One call, its line a socket a test speaks into, its speech and Operator
// stand-ins that keep what they were given.
let calling = (
  ack?: string[],
  more: Partial<Parameters<typeof converse>[0]> = {},
) => {
  let on: Record<string, ((e: { data?: unknown; code?: number }) => void)[]> =
    {}
  let sent: string[] = []
  let wire: Socket = {
    send: (data) => void sent.push(String(data)),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let told!: Told
  let heard: Uint8Array[] = []
  let asked: string[] = [], said: string[] = []
  let done: Parameters<Around['done']>[0][] = []
  let call = converse({
    call: 'v3:c',
    stream: { wire, line },
    listen: (t) => {
      told = t
      return {
        send: (audio) => void heard.push(audio),
        spent: () => ({ seconds: 1, dollars: 0.5 }),
        close: () => ({ seconds: 1, dollars: 0.5 }),
      }
    },
    say: (text) => {
      said.push(text)
      return Promise.resolve(new Response(new Uint8Array(1000)).body!)
    },
    ask: (text) => {
      asked.push(text)
      return Promise.resolve()
    },
    hello: HI,
    charge: () => Promise.resolve(),
    done: (cost) => {
      done.push(cost)
      return Promise.resolve()
    },
    hangup: () => Promise.resolve(),
    ack,
    report: (e) => {
      throw e
    },
    ...more,
  })
  let frame = (f: object) =>
    on.message.forEach((h) => h({ data: JSON.stringify(f) }))
  cleanup(() => {
    frame({ event: 'stop' })
    return call.ended
  })
  let played = () => sent.filter((s) => JSON.parse(s).event == 'media').length
  return {
    call,
    told: () => told,
    /** the caller's turn ended, saying `text` */
    end: (text: string) => told.end({ speaker: 0, text }),
    heard,
    asked,
    said,
    done,
    sent,
    frame,
    played,
    /** the provider's side of the line, closed with `code` */
    hangup: (code?: number) => on.close.forEach((h) => h({ code })),
  }
}

// The speech provider, saying each line as samples of one value a voice.
let voices: string[] = []
let speech = endpoints(globalThis).open((req) => {
  let voice = new URL(req.url).searchParams.get('model')!
  voices.push(voice)
  return Promise.resolve(
    new Response(new Uint8Array(1000).fill(voice == PANDORA ? 2 : 1)),
  )
})
let PANDORA = 'aura-2-pandora-en'

test('a voice the Operator sets on its persona during a call is heard on its next line and acknowledgement, the call going on', async () => {
  let p = platform('call-voice', {
    DEEPGRAM_API_KEY: 'a-key',
    SPEECH_API: speech.url,
  })
  let person = crypto.randomUUID()
  let space = (await p.dir.at(
    await p.dir.mint(person, 'voice', 'Voice', {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    }),
  ))!
  await stamp(p.env, {
    entities: [{ entity: { eid: space.eid }, budget: { dollars: 1 } }],
  })
  let store = operatorMemory()
  let time = clock()
  let c = calling(['One moment.'], {
    time,
    wait: 20,
    say: saying(p.env, space, store.g, line.format, setupOf(p.env, space)),
  })
  await until(() => c.played() == 1)
  c.end('Please speak in Pandora.')
  // What the Operator writes, asked: the same write as its settings page's.
  await store.g.apply([{
    entity: { eid: personaFor(space.eid) },
    operator: { voice: PANDORA },
  }], { trusted: true })
  c.call.answered('This is Pandora.')
  await until(() => c.played() == 2)
  c.end('What is on my calendar?')
  await time.advance(20)
  await until(() => c.played() == 3)
  equal(voices, ['aura-2-draco-en', PANDORA, PANDORA])
  equal(
    c.sent.map((s) => JSON.parse(s)).filter((f) => f.event == 'media')
      .map((f) => atob(f.media.payload).charCodeAt(0)),
    [1, 2, 2],
  )
  equal(c.done, [])
})

test('a call says hello, hears a turn, and speaks the reply a sentence at a time as it is written', async () => {
  let c = calling()
  await until(() => c.played() == 1)
  equal(c.said, [HI])
  // What the caller says over the greeting, an eighth of a second long, is
  // a quiet line to whoever listens, so it starts no turn that would stop
  // the greeting; once it has played, they are heard.
  let sound = (bytes: Uint8Array) =>
    c.frame({
      event: 'media',
      media: { track: 'inbound', payload: btoa(String.fromCharCode(...bytes)) },
    })
  sound(new Uint8Array([1, 2]))
  sound(new Uint8Array(1000).fill(1))
  sound(new Uint8Array([1, 2]))
  equal([c.heard[0], c.heard[2]], [
    new Uint8Array([255, 255]),
    new Uint8Array([1, 2]),
  ])
  // Words before a question are not the caller's reply.
  c.call.typed('Stray words. ')
  c.end('Book the hall for Friday')
  equal(c.asked, ['Book the hall for Friday'])
  equal(c.call.waiting(), true)
  c.call.typed('Done, **booked** for Fri')
  c.call.typed('day. I texted ')
  c.call.typed('the [form](https://x.yaks.app/f) too')
  await until(() => c.said.length == 2)
  equal(c.said[1], 'Done, booked for Friday.')
  // The answer's rest is what was not yet said, said once.
  c.call.answered('Done, booked for Friday. I texted the form too')
  await until(() => c.said.length == 3)
  equal(c.said[2], 'I texted the form too')
  equal(c.call.waiting(), false)
  // An answer that never streamed is said whole, in plain words.
  c.call.answered('Your build finished: https://hall.yaks.app')
  await until(() => c.said.length == 4)
  equal(c.said[3], 'Your build finished: the link')
  c.frame({ event: 'stop' })
  await c.call.ended
  equal(c.done.length, 1)
  equal(c.done[0].heard, 0.5)
  equal(c.done[0].turns.length, 1)
  equal(typeof c.done[0].turns[0].answer, 'number')
})

test('a turn the Operator could not take is reported, and said plainly, differently each time', async () => {
  let reported: unknown[] = []
  let c = calling(undefined, {
    ask: () => Promise.reject(new Error('refused')),
    report: (e) => void reported.push(e),
  })
  c.end('Add a recipe to my recipe box')
  c.end('Add a recipe to my recipe box')
  await until(() => c.said.length == 3)
  equal(reported.length, 2)
  equal(c.call.waiting(), false)
  equal(c.said[1] != c.said[2], true)
  equal(c.said.some((s) => /take that|say it again|refused/.test(s)), false)
})

test('a caller who starts talking stops what is playing, and a turn is acknowledged only once its wait is noticeable, differently each time', async () => {
  // Each line is as many samples long as it has letters, to tell them apart.
  let spoken: string[] = []
  let time = clock()
  let c = calling(['One moment.', 'Let me see.'], {
    time,
    wait: 20,
    say: (text) => {
      spoken.push(text)
      return Promise.resolve(new Response(new Uint8Array(text.length)).body!)
    },
  })
  let lengths = () =>
    c.sent.map((s) => JSON.parse(s)).filter((f) => f.event == 'media')
      .map((f) => atob(f.media.payload).length)
  // An acknowledgement is said only when it is needed, in the voice then.
  await until(() => c.played() == 1)
  equal(spoken, [HI])
  c.told().start!()
  equal(JSON.parse(c.sent.at(-1)!), { event: 'clear' })
  // A quick answer comes with no acknowledgement.
  c.end('Thanks')
  c.call.answered('You are welcome.')
  await until(() => c.played() == 2)
  await time.advance(20)
  await time.advance(0)
  equal(c.played(), 2)
  // A slow one is acknowledged, and the next slow one in other words.
  c.end('What is on my calendar?')
  await time.advance(20)
  await until(() => c.played() == 3)
  // What the model wrote before its tool is said before the tool runs.
  await time.advance(5)
  c.call.typed('Let me look')
  c.call.paused()
  await until(() => spoken.length == 4)
  equal(spoken[3], 'Let me look')
  c.call.answered('Let me look. You have choir at 7.')
  c.end('And tomorrow?')
  await time.advance(20)
  await until(() => c.played() == 5)
  equal(
    lengths(),
    [
      HI,
      'You are welcome.',
      'One moment.',
      'Let me look',
      'Let me see.',
    ].map((t) => t.length),
  )
  c.frame({ event: 'stop' })
  await c.call.ended
  let [quick, slow] = c.done[0].turns
  equal(quick.first, quick.answer)
  equal([slow.first, slow.answer], [20, 25])
})

test('a call whose hearing stream is refused once the call is answered reports to the tracker', async () => {
  let rows: Bundle[][] = []
  let env = {
    ERRORS: {
      send: (sample: Bundle[]) => Promise.resolve(void rows.push(sample)),
    },
  }
  // The call starts in its request's invocation; the caller's audio, and the
  // refusal it meets, arrive on the wire after that request has answered.
  let c = await within(env, {}, () =>
    calling(undefined, {
      report: undefined,
      listen: (told) => ({
        send: () => told.lost!('Turn detection is not supported'),
        spent: () => ({ seconds: 0, dollars: 0 }),
        close: () => ({ seconds: 0, dollars: 0 }),
      }),
    }), clock())
  c.frame({ event: 'media', media: { track: 'inbound', payload: 'AQI=' } })
  await c.call.ended
  await until(() => rows.length == 1)
  let [failure] = rows[0]
  equal(
    (failure.exception as { value: string }).value,
    "A call's speech stream was lost: Turn detection is not supported",
  )
  equal((failure.error as { tags: unknown }).tags, {
    request: 'operator call',
  })
})

// A call a model hears and speaks itself, the model stood in for, or with
// `talking` OpenAI's realtime stream itself, its messages told by the test;
// `given` stands in for what the call is given (its Operator, its notes).
let talkingCall = (real = false, given: Partial<Talking> = {}) => {
  let on: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  let sent: string[] = []
  let wire: Socket = {
    send: (data) => void sent.push(String(data)),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let told!: Talked
  let heard: Uint8Array[] = [], said: string[] = [], asked: string[] = []
  let noted: [string, boolean][] = [], known: string[] = []
  // What its stream was opened on: the call's one greeting.
  let opened: string[] = []
  let done: Parameters<Around['done']>[0][] = []
  // The realtime stream's socket: what was sent on it, and its messages.
  let stream: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  let streamed: Record<string, unknown>[] = []
  let call = talking({
    call: 'v3:t',
    stream: { wire, line },
    talk: (t, opens) => {
      told = t
      opened.push(opens)
      if (real) {
        return talk({
          provider: OPENAI,
          key: 'k1',
          format: line.format,
          instructions: 'Be the Operator.',
          tools: [],
          told: t,
          opens,
          open: () => ({
            send: (data) => void streamed.push(JSON.parse(String(data))),
            close: () => {},
            addEventListener: (type, f) => void (stream[type] ??= []).push(f),
          }),
        })
      }
      return {
        send: (audio) => void heard.push(audio),
        say: (text) => void said.push(text),
        tell: (text) => void known.push(text),
        spent: () => ({ seconds: 1, dollars: 0.25 }),
        close: () => ({ seconds: 1, dollars: 0.25 }),
      }
    },
    note: (text, said) => {
      noted.push([text, said])
      return Promise.resolve()
    },
    ask: (text) => {
      asked.push(text)
      return Promise.resolve()
    },
    hello: HI,
    charge: () => Promise.resolve(),
    done: (call) => {
      done.push(call)
      return Promise.resolve()
    },
    hangup: () => Promise.resolve(),
    report: (e) => {
      throw e
    },
    ...given,
  })
  let frame = (f: object) =>
    on.message.forEach((h) => h({ data: JSON.stringify(f) }))
  let played = () => sent.filter((s) => JSON.parse(s).event == 'media').length
  let tell = (events: object[]) =>
    events.forEach((e) =>
      stream.message.forEach((h) => h({ data: JSON.stringify(e) }))
    )
  stream.open?.forEach((h) => h({}))
  return {
    call,
    told: () => told,
    heard,
    said,
    opened,
    asked,
    noted,
    known,
    done,
    frame,
    played,
    tell,
    streamed,
  }
}

test('a recorded call answers small talk itself, keeping it in the conversation, and asks the Operator what needs a tool', async () => {
  let c = talkingCall(true)
  c.tell([...HELLO, ...SMALL_TALK, ...ASKED])
  await until(() => c.asked.length == 1)
  equal(c.asked, ['Hi Elihu, do any of my apps have errors right now?'])
  // What the caller said is kept before the request made of it.
  equal(c.noted.slice(-2), [
    ['Hi, Ellahu, do any of my apps have errors right now?', false],
    ['Certainly, one moment.', true],
  ])
  c.call.answered('Mossvale has **one** open error.')
  await until(() =>
    c.streamed.some((m) => m.type == 'conversation.item.create')
  )
  equal(c.streamed.at(-2), {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: 'call_Gx7AcRPt9P8OTiLI',
      output: 'From the Operator:\nMossvale has one open error.',
    },
  })
  c.tell(ANSWERED)
  c.frame({ event: 'stop' })
  await c.call.ended
  // Every line said on the call is kept, the answer as the caller heard it.
  equal(c.noted, [
    ["Hi, it's Elihu.", true],
    ['Hi Ellihu, how are you this evening?', false],
    [
      'Good evening. I’m well, thank you. Ready to assist with anything you need.',
      true,
    ],
    ['Hi, Ellahu, do any of my apps have errors right now?', false],
    ['Certainly, one moment.', true],
    ['You have one open error in Mossvale.', true],
  ])
  equal(c.done[0].turns.map((t) => t.asked ?? false), [false, true])
  // Priced at the mini's rates, which the stream does not name.
  equal(c.done[0].heard.toFixed(6), '0.005918')
})

test('a call on a talking model has one greeting: its model is asked for it once, and a hello said over it is a quiet line to the model', () => {
  let c = talkingCall(true)
  let hello = () =>
    c.frame({ event: 'media', media: { track: 'inbound', payload: 'EBAQ' } })
  let heard = () =>
    c.streamed.filter((m) => m.audio).map((m) => m.audio).join(' ')
  hello()
  c.tell(HELLO)
  // The model heard a quiet line while its greeting had still to play, and
  // hears the caller once it has: nothing asks it for a second.
  hello()
  equal(heard(), '//// EBAQ')
  let asked = c.streamed.filter((m) => m.type == 'response.create')
  equal(asked.map((m) => JSON.stringify(m).includes(HI)), [true])
  equal(c.noted, [["Hi, it's Elihu.", true]])
})

test('a talking model hears the call, asks the Operator, and says its answer', async () => {
  let c = talkingCall()
  // Its stream opens on the greeting, which nothing else asks it to say.
  equal([c.opened, c.said], [[HI], []])
  c.frame({ event: 'media', media: { track: 'inbound', payload: 'AQI=' } })
  equal(c.heard, [new Uint8Array([1, 2])])
  c.told().stopped!()
  c.told().audio(new Uint8Array([9]))
  let output = c.told().call('ask', '{"request":"Book the hall"}')
  await until(() => c.asked.length == 1)
  equal(c.asked, ['Book the hall'])
  equal(c.call.waiting(), true)
  c.call.answered('**Booked** for Friday: https://hall.yaks.app')
  equal(await output, {
    text: 'Booked for Friday: the link',
    from: 'the Operator',
  })
  c.told().audio(new Uint8Array([8]))
  equal(c.played(), 2)
  // An answer nobody is waiting on, such as a helper's, is said as it comes.
  c.call.answered('Your build finished.')
  equal(c.said.at(-1), 'Your build finished.')
  equal(await c.told().call('nope', '{}'), 'There is no tool called nope.')
  // Work a duplex model hands over, on a turn of its own, is asked the same
  // way.
  c.told().stopped!(0.5)
  let delegated = c.told().delegate!('Move it to Friday')
  await until(() => c.asked.length == 2)
  c.call.answered('Moved.')
  equal([c.asked[1], await delegated], ['Move it to Friday', {
    text: 'Moved.',
    from: 'the Operator',
  }])
  c.frame({ event: 'stop' })
  await c.call.ended
  equal(c.done[0].heard, 0.25)
  let [turn] = c.done[0].turns
  // The words before the Operator answered were its acknowledgement.
  equal(turn.first! <= turn.answer!, true)
})

test('a talking model is told the conversation and the work as the call starts, the work again only once it changed, and answers status with its tools without asking the Operator', async () => {
  let time = clock()
  let work = 'Building the recipe box.'
  let failures: unknown[] = []
  let c = talkingCall(false, {
    time,
    glance: {
      recent: () => Promise.resolve('They asked for a recipe box.'),
      work: () => Promise.resolve(work),
    },
    looks: [
      {
        name: 'apps',
        description: 'Their apps.',
        parameters: {},
        read: () => Promise.resolve('home/recipes'),
      },
      {
        name: 'updates',
        description: 'Their Updates.',
        parameters: {},
        read: () => Promise.reject(new Error('the inbox is gone')),
      },
    ],
    report: (e) => void failures.push(e),
  })
  await until(() => c.known.length == 1)
  equal(c.known, ['They asked for a recipe box.\n\nBuilding the recipe box.'])
  // Moves that leave the work as it was tell nothing.
  c.call.moved()
  c.call.moved()
  await time.advance(2000)
  equal(c.known.length, 1)
  work = 'Built the recipe box.'
  c.call.moved()
  await time.advance(2000)
  await until(() => c.known.length == 2)
  equal(c.known[1], 'Built the recipe box.')
  equal(await c.told().call('apps', '{}'), 'home/recipes')
  // A lookup that fails is reported, and the caller told it failed on our side.
  equal(
    replyText(await c.told().call('updates', '{}')).startsWith('That failed'),
    true,
  )
  equal(failures.map((e) => (e as Error).message), ['the inbox is gone'])
  equal(c.asked, [])
  c.frame({ event: 'stop' })
  await c.call.ended
})

test("a talking model's backend calls the Operator's own tools: their refusal is its answer, and a failure is reported", async () => {
  let failures: unknown[] = []
  let ran: [string, unknown][] = []
  let c = talkingCall(false, {
    tools: {
      tools: [],
      run: (name, args) => {
        ran.push([name, args])
        if (name == 'wake_set') {
          return Promise.reject(new CallError('arguments', 'Say when.'))
        }
        if (name == 'text_send') {
          return Promise.reject(new Error('the line is down'))
        }
        return Promise.resolve('Written.')
      },
    },
    report: (e) => void failures.push(e),
  })
  equal(await c.told().call('graph_apply', '{"app":"list"}'), 'Written.')
  equal(await c.told().call('wake_set', '{}'), 'Say when.')
  equal(
    replyText(await c.told().call('text_send', '{}')).startsWith('That failed'),
    true,
  )
  equal(ran, [['graph_apply', { app: 'list' }], ['wake_set', {}], [
    'text_send',
    {},
  ]])
  equal(failures.map((e) => (e as Error).message), ['the line is down'])
  equal(c.asked, [])
  c.frame({ event: 'stop' })
  await c.call.ended
})

test("a recorded call is the caller's conversation: their words theirs, its voice's the Operator's own, and what its voice asked folded under the caller's words", async () => {
  let { env } = platform('call-notes')
  let person = crypto.randomUUID()
  let dir = directoryOf(env.STORE)
  let space = (await dir.at(
    await dir.mint(person, 'home', 'Home', {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    }),
  ))!
  let store = operatorMemory()
  let asked: Request[] = []
  let operator = operating(
    store,
    env,
    operatorModel((req) => {
      asked.push(req)
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'Mossvale has one open error.' }],
        cost: 0,
      })
    }),
  )
  // As operator-calls.ts `answering` keeps a talking model's call.
  let noted = Promise.resolve()
  let note = (text: string, o: { said?: boolean; began?: boolean }) =>
    noted = noted.then(() =>
      operator.note({ person }, space, text, { call: 'c1', ...o })
    )
  note('', { began: true })
  let turn = 0
  let c = talkingCall(true, {
    note: (text, said) => note(text, { said }),
    ask: (text) =>
      receive(
        store,
        {
          space: space.eid,
          person,
          channel: 'voice',
          address: JEFF,
          reply_to: NUMBER,
          via: 'telnyx',
          call: 'c1',
        },
        text,
        { id: requestId(space.eid, `telnyx:c1:${++turn}`) },
      ).then(async () => void await drain(store)),
  })
  handleChannels(operator, env, {
    voice: (_, answer) => {
      c.call.answered(answer.text)
      return Promise.resolve({})
    },
  })
  c.tell([...HELLO, ...SMALL_TALK])
  await noted
  await drain(store)
  // Nothing said without asking starts a turn.
  equal(asked.length, 0)
  c.tell(ASKED)
  await until(() => asked.length == 1)
  await until(() =>
    c.streamed.some((m) => m.type == 'conversation.item.create')
  )
  c.tell(ANSWERED)
  c.frame({ event: 'stop' })
  await c.call.ended
  await noted
  let root = rootOf(space.eid, person)
  equal((await workOf(store, space.eid, person)).map((w) => w.open), [root])

  // The conversation: the caller's words and what they heard, the Operator's
  // written answer folded under the words it answers, opened by their mark.
  let { html } = await conversationOf(store, '/at', root)
  let { document } = parseHTML(`<div>${html}</div>`)
  let texts = (q: string) =>
    [...document.querySelectorAll(q)].map((e) => e.textContent!.trim())
  let open = ':not(.More_Body *)'
  equal(texts(`.Transcript_Bubble${open}`), [
    'Hi Ellihu, how are you this evening?',
    'Hi, Ellahu, do any of my apps have errors right now?',
  ])
  equal(texts('div.More > .Transcript_Bubble'), [
    'Hi, Ellahu, do any of my apps have errors right now?',
  ])
  equal(texts(`.Transcript_Reply${open}`), [
    "Hi, it's Elihu.",
    'Good evening. I’m well, thank you. Ready to assist with anything you need.',
    'Certainly, one moment.',
    'You have one open error in Mossvale.',
  ])
  equal(texts('.More_Body .Transcript_Bubble'), [])
  equal(texts('.More_Body .Transcript_Reply'), [
    'Mossvale has one open error.',
  ])
  equal(
    ['By phone:', 'your voice', 'called you'].map((s) =>
      [
        ...texts(`.Transcript_Bubble${open}`),
        ...texts(`.Transcript_Reply${open}`),
      ].some((
        text,
      ) => text.includes(s))
    ),
    [false, false, false],
  )

  // What the Operator reads at its next turn: the caller's words as theirs,
  // and what its voice said identified as the voice, after the call's start.
  await operator.ask({ person }, space, { say: 'Any more?' })
  await drain(store)
  equal(asked.length, 2)
  let read = asked[1].items.flatMap((i) =>
    i.kind == 'user' || i.kind == 'assistant'
      ? [`${i.kind}: ${i.text.replace(/\[Sent [^\]]*\]\s*/, '')}`]
      : []
  )
  equal(read.slice(0, 6), [
    'user: From the system:\nThey called you, and your voice on the call answered.',
    "user: From your voice on the call:\nHi, it's Elihu.",
    'user: From the person on the phone:\nBy phone: Hi Ellihu, how are you this evening?',
    'user: From your voice on the call:\nGood evening. I’m well, thank you. Ready to assist with anything you need.',
    'user: From the person on the phone:\nBy phone: Hi, Ellahu, do any of my apps have errors right now?',
    'user: From your voice on the call:\nCertainly, one moment.',
  ])
  equal(read.slice(6, 9).map((r) => r.split('\n')[0]), [
    'user: From your voice on the call:',
    'assistant: Mossvale has one open error.',
    'user: From your voice on the call:',
  ])
})

test("a call whose voice spoke after the caller's last words asks the Operator with every line, ending on a user's message", async () => {
  let { env } = platform('call-voice-last')
  let person = crypto.randomUUID()
  let dir = directoryOf(env.STORE)
  let space = (await dir.at(
    await dir.mint(person, 'home', 'Home', {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    }),
  ))!
  let store = operatorMemory()
  let asked: Request[] = []
  let operator = operating(
    store,
    env,
    operatorModel((req) => {
      asked.push(req)
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'Added Garlic Butter Chicken.' }],
        cost: 0,
      })
    }),
  )
  handleChannels(operator, env, { voice: () => Promise.resolve({}) })
  let note = (text: string, o: { said?: boolean; began?: boolean } = {}) =>
    operator.note({ person }, space, text, { call: 'c1', ...o })
  // As on Jeff's call of 2026-11-06: the voice asked, and the caller and the
  // voice spoke again before the Operator's turn began.
  await note('', { began: true })
  await operator.ask({ person }, space, { say: 'Add a random recipe.' }, {
    channel: 'voice',
    call: 'c1',
  })
  await note('Okay.')
  await note('The request is still in progress, so I can’t', { said: true })
  await drain(store)
  let said = conversation(asked[0]).flatMap((m) =>
    m.content.flatMap((c) =>
      c.type == 'text'
        ? [
          `${m.role}: ${sourceWords(c.text).replace(/\[Sent [^\]]*\]\s*/, '')}`,
        ]
        : []
    )
  )
  equal(said, [
    'user: From the system:\nThey called you, and your voice on the call answered.',
    'user: From your voice on the call:\nAdd a random recipe.',
    'user: From the person on the phone:\nBy phone: Okay.',
    'user: From your voice on the call:\nThe request is still in progress, so I can’t',
  ])
  // The Operator is asked for its turn, never to finish its voice's words.
  equal(said.at(-1)!.startsWith('user: '), true)
})

test("a call's turns answered together, and the helper they start, are each said once", async () => {
  let { env } = platform('call-helper')
  let person = crypto.randomUUID()
  let dir = directoryOf(env.STORE)
  let space = (await dir.at(
    await dir.mint(person, 'home', 'Home', {
      'x-yak-person': person,
      'x-yak-role': 'owner',
    }),
  ))!
  let store = operatorMemory()
  let forked = (r: Request) => JSON.stringify(r.items).includes('fork of the')
  let reply = (text: string) => [{ kind: 'assistant' as const, text }]
  let operator = operating(
    store,
    env,
    operatorModel((req) => {
      let last = req.items.at(-1)
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        cost: 0,
        items: forked(req)
          ? reply('Added Garlic Butter Chicken.')
          : last?.kind == 'user' && /Added Garlic/.test(last.text)
          ? reply('Done: Garlic Butter Chicken is in your recipe box.')
          : last?.kind == 'result'
          ? reply('Adding a recipe now.')
          : [{
            kind: 'call' as const,
            id: crypto.randomUUID(),
            name: 'fork',
            args: JSON.stringify({ prompt: 'Add a random recipe' }),
          }],
      })
    }),
  )
  // As on Jeff's call of 2026-11-05: a request, and a fragment of the next
  // heard before the Operator took the first, so one turn answers both.
  let turn = 0
  let received: Promise<string>[] = []
  let c = calling(undefined, {
    ask: (text) => {
      let request = receive(
        store,
        {
          space: space.eid,
          person,
          channel: 'voice',
          address: JEFF,
          reply_to: NUMBER,
          via: 'telnyx',
        },
        text,
        { id: requestId(space.eid, `telnyx:c1:${++turn}`) },
      )
      received.push(request)
      return request.then(() => {})
    },
  })
  handleChannels(operator, env, {
    voice: (_, answer) => {
      c.call.answered(answer.text)
      return Promise.resolve({})
    },
  })
  c.end('Can you add a random recipe to my recipe box?')
  c.end('I.')
  await Promise.all(received)
  // Accept both inputs before running the model: retaining their original
  // text is asynchronous, so intake can otherwise finish on separate turns.
  await store.fx.work(store.g, undefined, { passes: 1 })
  await drain(store)
  await until(() => c.played() >= 3)
  equal(c.said, [
    HI,
    'Adding a recipe now.',
    'Done: Garlic Butter Chicken is in your recipe box.',
  ])
  // Each request has its answers, and each reached the caller.
  let requests = await answering(
    store,
    await store.g.read('.operator_request'),
  )
  equal(requests.map((r) => !!r.delivered), [true, true])
  c.frame({ event: 'stop' })
  await c.call.ended
})
