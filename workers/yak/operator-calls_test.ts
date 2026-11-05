// Calling the Operator (operator-calls.ts): whom a ring on the platform's
// number answers, the stream door's refusals, the `voice` channel, and one
// call's conversation with its line, speech and Operator stood in for.
import { equal, test, until } from '@yaks/testing'
import { line } from '@yaks/telnyx'
import { consentEid } from '@yaks/phone'
import { OPENAI, type Socket, talk, type Talked, type Told } from '@yaks/speech'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { telnyxDoor } from './operator-texts.ts'
import {
  type Around,
  converse,
  streamDoor,
  talking,
  voiced,
} from './operator-calls.ts'
import { seal } from './lib/token.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { rootOf } from './operator-channels.ts'
import { conversationOf, workOf } from './operator-host.ts'
import { ANSWERED, ASKED, HELLO, SMALL_TALK } from './operator-calls_fixture.ts'

let NUMBER = '+18663141594', JEFF = '+12695550142', ANA = '+12695550143'

// Telnyx's API, keeping the calls it was told to answer or reject.
let acted: { action: string; call: string; body: Record<string, string> }[] = []
let telnyxApi = endpoints(globalThis).open(async (req) => {
  let [, call, action] = /^\/calls\/([^/]+)\/actions\/(\w+)$/.exec(
    new URL(req.url).pathname,
  ) ?? []
  acted.push({ action, call: decodeURIComponent(call), body: await req.json() })
  return Response.json({ data: { result: 'ok' } })
})
let signer = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))

let fixture = async (calls?: string) => {
  let p = platform('calls', {
    CALLS: calls,
    PHONE_SENDER: { via: 'telnyx', number: NUMBER },
    TELNYX_API: telnyxApi.url,
    TELNYX_API_KEY: 'a-key',
    TELNYX_PUBLIC_KEY: b64(
      await crypto.subtle.exportKey('raw', signer.publicKey),
    ),
    DEEPGRAM_API_KEY: 'a-key',
  })
  let jeff = crypto.randomUUID(), ana = crypto.randomUUID()
  let meta = crypto.randomUUID(), own = crypto.randomUUID()
  let mine = crypto.randomUUID()
  await stamp(p.env, {
    entities: [
      { entity: { eid: jeff }, person: {}, phone: { number: JEFF } },
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
      (await telnyxDoor(
        new Request('https://yaks.app/telnyx/webhook', {
          method: 'POST',
          headers: {
            'telnyx-timestamp': t,
            'telnyx-signature-ed25519': signature,
          },
          body,
        }),
        p.env,
      )).status,
      200,
    )
    return acted.map((a) => a.action)
  }
  return { p, ring, jeff, ana, own }
}

test('while calls are a pilot only the platform’s owner is answered, streamed to the stream door', async () => {
  let { ring } = await fixture()
  equal(await ring(JEFF, NUMBER, 'c1'), ['answer'])
  let answer = acted[0]
  equal(answer.call, 'v3:c1')
  equal(answer.body.stream_bidirectional_mode, 'rtp')
  equal(answer.body.stream_bidirectional_codec, 'PCMU')
  equal(
    answer.body.stream_url.startsWith('wss://yaks.app/telnyx/stream?call='),
    true,
  )
  equal(await ring(ANA), ['reject'])
  equal(await ring('+12695550199'), ['reject'])
  // A call to another number is not the Operator's to take.
  equal(await ring(JEFF, '+18885550100'), [])
})

test('with calls on, everyone the platform knows by number is answered', async () => {
  let { ring } = await fixture('on')
  equal(await ring(ANA), ['answer'])
  equal(await ring('+12695550199'), ['reject'])
})

test('the stream door opens nothing without a fresh ticket sealed here', async () => {
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
    at: Date.now() - 61_000,
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
let calling = (ack?: string) => {
  let on: Record<string, ((e: { data?: unknown }) => void)[]> = {}
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
    wire,
    line,
    listen: (t) => {
      told = t
      return {
        send: (audio) => void heard.push(audio),
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
    hello: "Hi, it's Ada.",
    done: (cost) => {
      done.push(cost)
      return Promise.resolve()
    },
    hangup: () => Promise.resolve(),
    ack,
    report: (e) => {
      throw e
    },
  })
  let frame = (f: object) =>
    on.message.forEach((h) => h({ data: JSON.stringify(f) }))
  let played = () => sent.filter((s) => JSON.parse(s).event == 'media').length
  return {
    call,
    told: () => told,
    heard,
    asked,
    said,
    done,
    sent,
    frame,
    played,
  }
}

test('a call says hello, hears a turn, and speaks the reply a sentence at a time as it is written', async () => {
  let c = calling()
  await until(() => c.played() == 1)
  equal(c.said, ["Hi, it's Ada."])
  c.frame({ event: 'media', media: { track: 'inbound', payload: 'AQI=' } })
  equal(c.heard, [new Uint8Array([1, 2])])
  // Words before a question are not the caller's reply.
  c.call.typed('Stray words. ')
  c.told().end('Book the hall for Friday')
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

test('a caller who starts talking stops what is playing, and a turn is acknowledged the moment it ends', async () => {
  let c = calling('One moment.')
  // The acknowledgement is made as the call starts, and said only once.
  await until(() => c.played() == 1)
  equal(c.said, ['One moment.', "Hi, it's Ada."])
  c.told().start!()
  equal(JSON.parse(c.sent.at(-1)!), { event: 'clear' })
  c.told().end('What is on my calendar?')
  await until(() => c.played() == 2)
  equal(c.said.length, 2)
  // What the model wrote before its tool is said before the tool runs.
  c.call.typed('Let me look')
  c.call.paused()
  await until(() => c.said.length == 3)
  equal(c.said[2], 'Let me look')
  c.call.answered('Let me look. You have choir at 7.')
  c.frame({ event: 'stop' })
  await c.call.ended
  let [turn] = c.done[0].turns
  equal(turn.first! <= turn.answer!, true)
})

// A call a model hears and speaks itself, the model stood in for, or with
// `talking` OpenAI's realtime stream itself, its messages told by the test.
let talkingCall = (real = false) => {
  let on: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  let sent: string[] = []
  let wire: Socket = {
    send: (data) => void sent.push(String(data)),
    close: () => {},
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let told!: Talked
  let heard: Uint8Array[] = [], said: string[] = [], asked: string[] = []
  let noted: [string, boolean][] = []
  let done: Parameters<Around['done']>[0][] = []
  // The realtime stream's socket: what was sent on it, and its messages.
  let stream: Record<string, ((e: { data?: unknown }) => void)[]> = {}
  let streamed: Record<string, unknown>[] = []
  let call = talking({
    wire,
    line,
    talk: (t) => {
      told = t
      if (real) {
        return talk({
          provider: OPENAI,
          key: 'k1',
          format: line.format,
          instructions: 'Be the Operator.',
          tools: [],
          told: t,
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
        close: () => ({ seconds: 1, dollars: 0.25 }),
      }
    },
    note: (text, said) => void noted.push([text, said]),
    ask: (text) => {
      asked.push(text)
      return Promise.resolve()
    },
    hello: "Hi, it's Ada.",
    done: (call) => {
      done.push(call)
      return Promise.resolve()
    },
    hangup: () => Promise.resolve(),
    report: (e) => {
      throw e
    },
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
    asked,
    noted,
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
  c.call.answered('Mossvale has **one** open error.')
  await until(() =>
    c.streamed.some((m) => m.type == 'conversation.item.create')
  )
  equal(c.streamed.at(-2), {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: 'call_Gx7AcRPt9P8OTiLI',
      output: 'Mossvale has one open error.',
    },
  })
  c.tell(ANSWERED)
  c.frame({ event: 'stop' })
  await c.call.ended
  // The turn that asked, and the answer said, are in the conversation as
  // the request and the Operator's answer.
  equal(c.noted, [
    ["Hi, it's Elihu.", true],
    ['Hi Ellihu, how are you this evening?', false],
    [
      'Good evening. I’m well, thank you. Ready to assist with anything you need.',
      true,
    ],
  ])
  equal(c.done[0].turns.map((t) => t.asked ?? false), [false, true])
  // Priced at the mini's rates, which the stream does not name.
  equal(c.done[0].heard.toFixed(6), '0.005918')
})

test('a talking model hears the call, asks the Operator, and says its answer', async () => {
  let c = talkingCall()
  equal(c.said, ["Hi, it's Ada."])
  c.frame({ event: 'media', media: { track: 'inbound', payload: 'AQI=' } })
  equal(c.heard, [new Uint8Array([1, 2])])
  c.told().stopped!()
  c.told().audio(new Uint8Array([9]))
  let output = c.told().call('ask', '{"request":"Book the hall"}')
  await until(() => c.asked.length == 1)
  equal(c.asked, ['Book the hall'])
  equal(c.call.waiting(), true)
  c.call.answered('**Booked** for Friday: https://hall.yaks.app')
  equal(await output, 'Booked for Friday: the link')
  c.told().audio(new Uint8Array([8]))
  equal(c.played(), 2)
  // An answer nobody is waiting on, such as a helper's, is said as it comes.
  c.call.answered('Your build finished.')
  equal(c.said.at(-1), 'Your build finished.')
  equal(await c.told().call('nope', '{}'), 'There is no tool called nope.')
  c.frame({ event: 'stop' })
  await c.call.ended
  equal(c.done[0].heard, 0.25)
  let [turn] = c.done[0].turns
  // The words before the Operator answered were its acknowledgement.
  equal(turn.first! <= turn.answer!, true)
})

test("what a call said without asking is the caller's conversation: listed, drawn, and read at the next ask, starting no turn", async () => {
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
        items: [{ kind: 'assistant', text: 'Two apps have errors.' }],
        cost: 0,
      })
    }),
  )
  await operator.note({ person }, space, 'How are you?', { call: 'c1' })
  await operator.note({ person }, space, 'Very well, thank you.', {
    call: 'c1',
    said: true,
  })
  await drain(store)
  equal(asked.length, 0)
  let root = rootOf(space.eid, person)
  equal((await workOf(store, space.eid, person)).map((w) => w.open), [root])
  let { html } = await conversationOf(store, '/at', root)
  // The model's words are drawn as the Operator's, without what says so.
  equal(
    ['By phone: How are you?', 'Very well, thank you.', 'you said'].map((s) =>
      html.includes(s)
    ),
    [true, true, false],
  )
  await operator.ask({ person }, space, { say: 'Any errors?' })
  await drain(store)
  equal(asked.length, 1)
  let items = JSON.stringify(asked[0].items)
  equal(
    ['How are you?', 'Very well, thank you.', 'Any errors?'].map((s) =>
      items.includes(s)
    ),
    [true, true, true],
  )
})
