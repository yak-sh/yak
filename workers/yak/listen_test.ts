// A page's microphone heard through an app's ./api/speech/listen door
// (listen.ts), with the page's socket and Deepgram's stream stood in for: its
// turns told back as they end with their speakers and seconds, its minutes
// charged to the space, a stream opened again told from where it resumes,
// and a space whose budget is spent told so.
import type { Upgrade } from '@yaks/api'
import type { Socket } from '@yaks/speech'
import { equal, test, until } from '@yaks/testing'
import type { Asked } from './apps.ts'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { listens } from './listen.ts'
import { budget } from './meter.ts'

type Heard = { data?: unknown; code?: number }

// A socket that keeps what it was sent, and fires what a test says it heard.
let socket = () => {
  let on: Record<string, ((e: Heard) => void)[]> = {}
  let sent: (string | Uint8Array)[] = []
  let closed: [number?, string?][] = []
  let s: Socket = {
    send: (data) => void sent.push(data),
    close: (code, reason) => {
      closed.push([code, reason])
      on.close?.forEach((f) => f({ code }))
    },
    addEventListener: (type, f) => void (on[type] ??= []).push(f),
  }
  let fire = (type: string, data?: unknown) =>
    on[type]?.forEach((f) => f({ data }))
  let json = () =>
    sent.filter((m) => typeof m == 'string').map((m) => JSON.parse(m))
  return { s, sent, closed, fire, json }
}

// Nova-3's final words, each [word, speaker, start, end].
let words = (ws: [string, number, number, number][], end = false) =>
  JSON.stringify({
    type: 'Results',
    is_final: true,
    speech_final: end,
    channel: {
      alternatives: [{
        words: ws.map(([word, speaker, start, end]) => ({
          word,
          speaker,
          start,
          end,
        })),
      }],
    },
  })

let p = platform('listen', { DEEPGRAM_API_KEY: 'a-key' })
let person = crypto.randomUUID()
await p.dir.apply({
  entities: [{ entity: { eid: person }, person: {} }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })

// A space of its own with `dollars` to spend, and a page of one of its apps
// opening the door with `query`.
let listening = async (query: string, dollars = 1) => {
  let eid = crypto.randomUUID()
  await p.dir.apply({
    entities: [
      { entity: { eid }, space: { slug: `s${eid.slice(0, 8)}`, store: eid } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space: eid, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  await stamp(p.env, {
    entities: [{
      entity: { eid },
      budget: { dollars },
      starter: { dollars: 0 },
    }],
  })
  let space = async () => (await p.dir.at(eid))!
  let page = socket(), deepgram = socket(), opened: string[] = []
  let reported: unknown[] = []
  let door = listens({
    upgrade: (() => ({
      socket: page.s,
      response: new Response('upgraded'),
    })) as unknown as Upgrade,
    open: (url) => {
      opened.push(url)
      queueMicrotask(() => deepgram.fire('open'))
      return deepgram.s
    },
    report: (e) => void reported.push(e),
  })
  let res = await door({
    env: p.env,
    req: new Request(`https://choir.yaks.app/x/api/speech/listen?${query}`, {
      headers: { upgrade: 'websocket' },
    }),
    path: '/speech/listen',
    space: await space(),
    app: { access: 'private' },
    who: { person, role: 'owner' },
    refuse: () => Promise.resolve(new Response(null, { status: 401 })),
    json: (status: number, code: string) =>
      Response.json({ error: { code } }, { status }),
  } as unknown as Asked)
  equal(await res!.text(), 'upgraded')
  return { page, deepgram, opened, reported, space }
}

// Seconds of 16 kHz PCM.
let pcm = (seconds: number) => new Uint8Array(seconds * 32000)

test('a page streams a meeting and reads each turn back as it ends, its minutes charged to the space', async () => {
  let { page, deepgram, opened, space } = await listening('')
  await until(() => page.json().length)
  equal(page.json(), [{ type: 'ready', at: 0, speakers: true }])
  equal(new URL(opened[0]).searchParams.get('diarize_model'), 'latest')
  page.fire('message', pcm(50).buffer)
  page.fire('message', pcm(40).buffer)
  deepgram.fire('message', words([['I', 0, 1, 1.2], ['move.', 0, 1.2, 1.5]]))
  deepgram.fire('message', words([['Second.', 1, 2, 2.4]], true))
  page.fire('message', '{"type":"end"}')
  await until(() => deepgram.sent.length == 3)
  equal(deepgram.sent.at(-1), '{"type":"CloseStream"}')
  deepgram.fire('message', words([['Carried.', 0, 88, 89]]))
  deepgram.fire('message', '{"type":"Metadata"}')
  deepgram.fire('close')
  await until(() => page.closed.length)
  equal(page.json().slice(1), [
    { type: 'turn', speaker: 0, text: 'I move.', from: 1, to: 1.5 },
    { type: 'turn', speaker: 1, text: 'Second.', from: 2, to: 2.4 },
    { type: 'turn', speaker: 0, text: 'Carried.', from: 88, to: 89 },
    { type: 'done', at: 90 },
  ])
  equal(page.closed, [[1000, 'done']])
  // A minute and a half at Nova-3's $0.0097 a minute with its speakers.
  equal(budget(await space()).spent.toFixed(5), (1.5 * 0.0097).toFixed(5))
})

test('a stream opened again at a second tells its turns from there, and where to resume once lost', async () => {
  let { page, deepgram, reported } = await listening('at=600.5')
  // Audio sent as the socket opens is heard once the stream is.
  page.fire('message', pcm(3))
  await until(() => deepgram.sent.length)
  equal((deepgram.sent[0] as Uint8Array).length, 96000)
  deepgram.fire('message', words([['Next', 2, 1, 1.25], ['item.', 2, 1.25, 2]]))
  deepgram.fire('message', words([['Yes', 1, 2.5, 3]]))
  deepgram.fire('error')
  await until(() => page.closed.length)
  equal(page.json(), [
    { type: 'ready', at: 600.5, speakers: true },
    { type: 'turn', speaker: 2, text: 'Next item.', from: 601.5, to: 602.5 },
    {
      type: 'error',
      code: 'speech_failed',
      message: 'the stream was lost: open it again at `at`',
      at: 602.5,
    },
  ])
  equal(reported.length, 1)
})

test('a space whose budget is spent is told so, and nothing is heard', async () => {
  let { page, opened } = await listening('', 0)
  await until(() => page.closed.length)
  equal(page.json().map((m) => [m.type, m.code]), [['error', 'limit']])
  equal([page.closed[0][0], opened], [1008, []])
})

test('a stream whose next minute the budget can’t cover is stopped, and charged what it heard', async () => {
  let { page, space } = await listening('', 0.015)
  await until(() => page.json().length)
  page.fire('message', pcm(55))
  await until(() => page.closed.length)
  equal(page.json().slice(1).map((m) => [m.type, m.code]), [['error', 'limit']])
  equal(page.closed[0][0], 1008)
  equal(budget(await space()).spent.toFixed(6), (55 / 60 * 0.0097).toFixed(6))
})

test('a page naming no format the door hears is told how to open it', async () => {
  let { page } = await listening('encoding=mp3')
  await until(() => page.closed.length)
  equal(page.json().map((m) => [m.type, m.code, m.at]), [[
    'error',
    'bad_request',
    0,
  ]])
})
