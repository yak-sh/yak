// Speech through an app's ./api/speech/ door (speech.ts), with Deepgram stood
// in for: text spoken and a recording heard for a member, each charged to the
// space's model budget, and refused once the pilot has spent its share or the
// space its budget.
import { equal, test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { budget } from './meter.ts'
import { sampled, setupOf, speechDoor, unread } from './speech.ts'
import type { Asked } from './apps.ts'

let left = 199.5
let voices: string[] = []
let deepgram = endpoints(globalThis).open(async (req) => {
  let url = new URL(req.url)
  if (url.pathname == '/v1/projects') {
    return Response.json({ projects: [{ project_id: 'p' }] })
  }
  if (url.pathname.endsWith('/balances')) {
    return Response.json({ balances: [{ amount: left }] })
  }
  if (url.pathname == '/v1/speak') {
    voices.push(url.searchParams.get('model')!)
    return new Response(new Uint8Array([1, 2, 3]))
  }
  // OpenAI's voice, which says who asked.
  if (url.pathname == '/v1/audio/speech') {
    let { voice } = await req.json()
    voices.push(`${voice} ${req.headers.get('authorization')}`)
    return new Response(new Uint8Array([4, 5]))
  }
  await req.arrayBuffer()
  return Response.json({
    metadata: { duration: 120 },
    results: { channels: [{ alternatives: [{ transcript: 'Book Friday' }] }] },
  })
})

let fixture = async (dollars = 1) => {
  let p = platform('speech', {
    DEEPGRAM_API_KEY: 'a-key',
    OPENAI_VOICE_KEY: 'o-key',
    SPEECH_API: deepgram.url,
    SPEECH_FLOOR: '195',
  })
  let person = crypto.randomUUID(), eid = crypto.randomUUID()
  await p.dir.apply({
    entities: [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid },
        space: { slug: 'choir', store: 'choir' },
      },
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
  let ask = async (path: string, body: BodyInit, type: string) => {
    let res = await speechDoor({
      env: p.env,
      req: new Request('https://choir.yaks.app/x/api' + path, {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
      path,
      space: await space(),
      app: { access: 'private' },
      who: { person, role: 'owner' },
      refuse: () => Promise.resolve(new Response(null, { status: 401 })),
      json: (status: number, code: string, says?: string) =>
        Response.json({ error: { code, message: says } }, { status }),
    } as unknown as Asked)
    return res!
  }
  return { p, eid, space, ask }
}

test('a member’s text is spoken and a recording heard, each charged to the space', async () => {
  unread()
  left = 199.5
  let { space, ask } = await fixture()
  let spoke = await ask('/speech/speak', '{"text":"Hello choir"}', 'text/json')
  equal(spoke.headers.get('content-type'), 'audio/mpeg')
  equal([...new Uint8Array(await spoke.arrayBuffer())], [1, 2, 3])
  let heard = await ask('/speech/hear', new Uint8Array([9]), 'audio/webm')
  equal(await heard.json(), { text: 'Book Friday', seconds: 120 })
  // 11 characters at $0.030 a thousand, and two minutes at $0.0043.
  equal(budget(await space()).spent.toFixed(6), '0.008930')
})

test('speech is refused once the pilot spent its share, or the space its budget', async () => {
  unread()
  left = 194.99
  let { ask } = await fixture()
  let code = async (r: Response) => [r.status, (await r.json()).error.code]
  equal(await code(await ask('/speech/speak', '{"text":"Hi"}', 'text/json')), [
    503,
    'speech_off',
  ])
  unread()
  left = 199.5
  let broke = await fixture(0)
  equal(
    await code(await broke.ask('/speech/speak', '{"text":"Hi"}', 'text/json')),
    [
      402,
      'limit',
    ],
  )
  equal(await code(await ask('/speech/speak', '{}', 'text/json')), [
    400,
    'bad_request',
  ])
})

test('a voice’s sample is spoken once and kept for every space after', async () => {
  unread()
  left = 199.5
  voices = []
  let { p, space } = await fixture()
  equal([...await sampled(p.env, await space(), 'aura-2-draco-en')], [
    1,
    2,
    3,
  ])
  equal([...await sampled(p.env, await space(), 'aura-2-draco-en')], [
    1,
    2,
    3,
  ])
  equal(voices, ['aura-2-draco-en'])
  equal(
    await sampled(p.env, await space(), 'aura-2-nobody-en').catch((e) =>
      e.message
    ),
    'Pick one of the voices listed.',
  )
})

test('text spoken in a voice of another provider goes to it, with its own key', async () => {
  unread()
  left = 199.5
  voices = []
  let { ask, space } = await fixture()
  let spoke = await ask(
    '/speech/speak',
    '{"text":"Hello choir","voice":"cedar"}',
    'text/json',
  )
  equal([...new Uint8Array(await spoke.arrayBuffer())], [4, 5])
  equal(voices, ['cedar Bearer o-key'])
  // 11 characters at OpenAI's $0.015 a thousand.
  equal(budget(await space()).spent.toFixed(6), '0.000165')
})

test('an Operator’s setup: its voice names the provider, its pace how fast it speaks, and its model whether that provider talks', () => {
  let on = { DEEPGRAM_API_KEY: 'a', OPENAI_VOICE_KEY: 'b' } as never
  let of = (
    voice?: string,
    voice_model?: string,
    voice_speed?: string,
    env = on,
  ) => {
    let { provider, ...rest } = setupOf(env, {
      voice,
      voice_model,
      voice_speed,
    })
    return { provider: provider.name, ...rest }
  }
  // Nothing picked is Normal and the quickest way, in its own voice.
  equal(of(), {
    provider: 'openai',
    voice: 'cedar',
    pace: 'normal',
    speed: 1.15,
    model: 'gpt-realtime-2.1-mini',
    talks: true,
    duplex: false,
  })
  // Where its provider is off, the next way, in a butler's voice.
  equal(
    of(undefined, undefined, undefined, { DEEPGRAM_API_KEY: 'a' } as never),
    {
      provider: 'deepgram',
      voice: 'aura-2-draco-en',
      pace: 'normal',
      speed: 1.15,
      model: 'claude-haiku-5-5',
      talks: false,
      duplex: false,
    },
  )
  // A voice the quickest way can't speak keeps its voice, answered the next.
  equal(of('aura-2-draco-en').model, 'claude-haiku-5-5')
  equal(of('marin').model, 'gpt-realtime-2.1-mini')
  equal(of('cedar', 'gpt-realtime-2.1-mini', 'relaxed'), {
    provider: 'openai',
    voice: 'cedar',
    pace: 'relaxed',
    speed: 1,
    model: 'gpt-realtime-2.1-mini',
    talks: true,
    duplex: false,
  })
  equal(of('aura-2-draco-en', 'claude-sonnet-5-5', 'brisk').pace, 'brisk')
  equal(of(undefined, undefined, 'gone').pace, 'normal')
  equal(of('fable', 'claude-sonnet-5-5').talks, false)
  equal(of('fable', 'gpt-realtime-2.1').voice, 'cedar')
  // GPT-Live hears and speaks at once, in the realtime model's voices.
  equal(
    [of('marin', 'gpt-live-1'), of('fable', 'gpt-live-1')].map((
      o,
    ) => [o.voice, o.talks, o.duplex]),
    [['marin', true, true], ['cedar', true, true]],
  )
})
