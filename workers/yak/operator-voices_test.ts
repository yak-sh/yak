// The Operator's voices (operator-voices.ts), with ElevenLabs stood in for:
// refused until the person connects their own ElevenLabs account, then a line
// voiced with its key, charging the space nothing, and kept as an Operator
// file beside its call, and voices listed.
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
import { connect, need } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { ctxOf } from './connections.ts'

let asked: string[] = []
let eleven = endpoints(globalThis).open((req) => {
  let url = new URL(req.url)
  asked.push(`${url.pathname} ${req.headers.get('xi-api-key')}`)
  return Promise.resolve(
    url.pathname == '/v1/text-to-voice/design'
      ? Response.json({
        previews: [{ generated_voice_id: 'g1', audio_base_64: '//sBAg==' }],
      })
      : url.pathname == '/v2/voices'
      ? Response.json({
        voices: [{ voice_id: 'v1', name: 'Ada', description: 'bright' }],
      })
      : new Response(new Uint8Array([0xff, 0xfb, 1, 2])),
  )
})
let p = platform('operator voices', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let env = { ...p.env, SPEECH_API: eleven.url } as typeof p.env
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
// The person's own ElevenLabs connection, its key `key`.
let connected = async (key: string) => {
  let c = ctxOf(env, { person, role: 'owner' })
  let made = await c.graph.apply(
    await need(c.graph.read, {
      owner: person,
      integration: 'elevenlabs',
    }),
  )
  await connect(c, made.find((b) => b.connection)!.entity.eid, { key })
}

test('without their own ElevenLabs account, the Operator is told to connect it', async () => {
  let e = await assertRejects(
    () => Promise.resolve(tools.speech_new.run({ text: 'Hi' }, ctx)),
    CallError,
  )
  assertEquals([e.code, asked], ['connection', []])
})

test('a line is voiced with their own key, charging the space nothing, and kept beside its call', async () => {
  await connected('their-key')
  let told = await tools.speech_new.run(
    { text: 'Ahoy there.', voice: 'v1' },
    ctx,
  ) as string
  assertEquals(asked.at(-1), '/v1/text-to-speech/v1 their-key')
  let [file] = ((await filesOf(store, [{
    entity: { eid: mint() },
    entry: { session },
    result: { call },
  }])).values().next().value?.files ?? []).map((f) => keptOf(space, f))
  assertEquals([file.name, file.mime], ['line.mp3', 'audio/mpeg'])
  assertEquals(told.includes(file.key.split('/').at(-1)!), true)
  assertEquals(budget((await dir.at(eid))!).spent, 0)
})

test('voices are listed, and found by their words', async () => {
  assertEquals(
    JSON.parse(await tools.voice_list.run({ search: 'BRIGHT' }, ctx) as string),
    [
      { id: 'v1', name: 'Ada', about: 'bright' },
    ],
  )
})

test('voices are designed with their own key, each sample kept beside its call', async () => {
  let told = await tools.voice_design.run(
    { description: 'an old sea captain' },
    ctx,
  ) as string
  assertEquals(asked.at(-1), '/v1/text-to-voice/design their-key')
  assertEquals(told.startsWith('Designed 1: design g1 (attachment '), true)
})
