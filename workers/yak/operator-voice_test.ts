// The Operator page's speech for a browser without its own (operator-page.ts
// `?hear`, `?speak`, public/voice.js), with Deepgram stood in for: what the
// person said is heard and the Operator's line said in its own voice, each
// charged to the space's one budget, and refused once that is spent.
import { equal, test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { budget } from './meter.ts'
import { operatorAnswer } from './operator-page.ts'
import { unread } from './speech.ts'

let voices: string[] = []
let deepgram = endpoints(globalThis).open(async (req) => {
  let url = new URL(req.url)
  if (url.pathname == '/v1/speak') {
    voices.push(`${url.searchParams.get('model')} ${await req.text()}`)
    return new Response(new Uint8Array([1, 2, 3]))
  }
  await req.arrayBuffer()
  return Response.json({
    metadata: { duration: 60 },
    results: {
      channels: [{ alternatives: [{ transcript: 'Make it warmer' }] }],
    },
  })
})

let fixture = async (dollars = 1) => {
  let p = platform('operator-voice', {
    DEEPGRAM_API_KEY: 'a-key',
    SPEECH_API: deepgram.url,
  })
  let person = crypto.randomUUID(), eid = crypto.randomUUID()
  await p.dir.apply({
    entities: [
      { entity: { eid: person }, person: {} },
      { entity: { eid }, space: { slug: 'choir', store: 'choir' } },
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
  let post = async (asked: string, body: BodyInit, type: string) =>
    (await operatorAnswer(
      new Request('https://yaks.app/manage/choir/operator?' + asked, {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
      p.env,
      await space(),
      { person, role: 'owner' },
    ))!
  return { space, post }
}

test('what the person said is heard and the Operator’s line said in its own voice, each from the space’s budget', async () => {
  unread()
  voices = []
  let { space, post } = await fixture()
  let heard = await post('hear=1', new Uint8Array([9]), 'audio/webm')
  equal(await heard.json(), { text: 'Make it warmer' })
  let said = await post(
    'speak=1',
    '{"text":"Released notes"}',
    'application/json',
  )
  equal(said.headers.get('content-type'), 'audio/mpeg')
  equal([...new Uint8Array(await said.arrayBuffer())], [1, 2, 3])
  equal(voices, ['aura-2-draco-en {"text":"Released notes"}'])
  // A minute heard at $0.0043, and 14 characters at $0.030 a thousand.
  equal(budget(await space()).spent.toFixed(6), '0.004720')
})

test('speech is refused with the space’s budget spent, or asked of with nothing to say', async () => {
  unread()
  let broke = await fixture(0)
  let refused = await broke.post('speak=1', '{"text":"Hi"}', 'application/json')
  equal(refused.status, 402)
  let { post } = await fixture()
  let status = async (r: Response) => [r.status, (await r.json()).message]
  equal(await status(await post('speak=1', '{}', 'application/json')), [
    400,
    'Send up to 600 characters to say.',
  ])
  equal(await status(await post('hear=1', 'hi', 'text/plain')), [
    400,
    'Send what was said as audio.',
  ])
  // Nothing recorded is nothing heard, and costs nothing.
  equal(await (await post('hear=1', new Uint8Array(), 'audio/webm')).json(), {
    text: '',
  })
})
