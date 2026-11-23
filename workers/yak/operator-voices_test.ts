// The Operator's voices (operator-voices.ts), with ElevenLabs stood in for: a
// line voiced on the platform's key is charged to the space and kept as an
// Operator file beside its call, voices are listed, and designing a voice is
// refused until the person connects their own ElevenLabs account.
import { assertEquals, assertRejects } from '@std/assert'
import { mint } from '@yaks/graph'
import { test } from '@yaks/testing'
import { CallError } from '@yaks/tools/errors'
import { budget, monthOf } from '@yaks/platform/meter'
import { directoryOf, stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { filesOf, keptOf } from './operator-files.ts'
import { operatorMemory } from './operator-testing.ts'
import { voiceTools } from './operator-voices.ts'
import { platform } from './testing.ts'

let asked: string[] = []
let eleven = endpoints(globalThis).open((req) => {
  let url = new URL(req.url)
  asked.push(`${url.pathname} ${req.headers.get('xi-api-key')}`)
  return Promise.resolve(
    url.pathname == '/v2/voices'
      ? Response.json({
        voices: [{ voice_id: 'v1', name: 'Ada', description: 'bright' }],
      })
      : new Response(new Uint8Array([0xff, 0xfb, 1, 2])),
  )
})
let p = platform('operator voices')
let env = {
  ...p.env,
  ELEVENLABS_API_KEY: 'our-key',
  SPEECH_API: eleven.url,
} as typeof p.env
let eid = mint()
await stamp(env, {
  entities: [{
    entity: { eid },
    space: { slug: 'stage-' + eid, store: eid },
    budget: { dollars: 1 },
    starter: { dollars: 0 },
    meter: { month: monthOf(new Date()), models: 0, files: 0 },
  }],
})
let dir = directoryOf(env.STORE)
let space = (await dir.at(eid))!
let store = operatorMemory()
let person = mint(), session = mint(), call = mint()
await store.g.apply([
  {
    entity: { eid: session },
    session: {},
    operator_session: { space: eid, person },
  },
  { entity: { eid: call }, entry: { session } },
], { trusted: true })
let tools = Object.fromEntries(
  voiceTools(env, { person, dir }, space, store).map((t) => [t.name, t]),
)
let ctx = { session, call: { entity: { eid: call } }, entries: [] }

test('a line is voiced on the platform’s key, charged to the space, and kept beside its call', async () => {
  let told = await tools.speech_new.run(
    { text: 'Ahoy there.', voice: 'v1' },
    ctx,
  ) as string
  assertEquals(asked.at(-1), '/v1/text-to-speech/v1 our-key')
  let [file] = ((await filesOf(store, [{
    entity: { eid: mint() },
    entry: { session },
    result: { call },
  }])).values().next().value?.files ?? []).map((f) => keptOf(space, f))
  assertEquals([file.name, file.mime], ['line.mp3', 'audio/mpeg'])
  assertEquals(told.includes(file.key.split('/').at(-1)!), true)
  // 11 characters at $0.08 a thousand.
  assertEquals(budget((await dir.at(eid))!).spent.toFixed(6), '0.000880')
})

test('voices are listed, and found by their words', async () => {
  assertEquals(
    JSON.parse(await tools.voice_list.run({ search: 'BRIGHT' }, ctx) as string),
    [
      { id: 'v1', name: 'Ada', about: 'bright' },
    ],
  )
})

test('designing a voice waits for the person’s own ElevenLabs account', async () => {
  let e = await assertRejects(
    () =>
      Promise.resolve(
        tools.voice_design.run({ description: 'a captain' }, ctx),
      ),
    CallError,
  )
  assertEquals(e.code, 'speech_own')
})
