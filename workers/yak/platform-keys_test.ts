// yaks.app's own keys (platform-keys.ts): a connection of the `yak` space that
// its `platform` app uses under a name answers that name over the Worker
// secret of it, which answers alone until one is given; and ElevenLabs speaks
// on that key for a space without its own account, charged to the space.
import { assertEquals } from '@std/assert'
import { connect, need } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { mint } from '@yaks/graph'
import { budget, monthOf } from '@yaks/platform/meter'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { line } from '@yaks/query'
import { ELEVENLABS } from '@yaks/speech'
import { test } from '@yaks/testing'
import { d1 } from '../../packages/d1/testing.ts'
import { ctxOf } from './connections.ts'
import { directoryOf, seeding, stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { meta } from './meta.ts'
import { keyed } from './platform-keys.ts'
import { speaking } from './speech.ts'
import { platform } from './testing.ts'

let asked: string[] = []
let eleven = endpoints(globalThis).open((req) => {
  asked.push(req.headers.get('xi-api-key') ?? '')
  return Promise.resolve(new Response(new Uint8Array([0xff, 0xfb, 1, 2])))
})
let p = platform('platform keys', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let c = ctxOf(p.env)
// The directory's own rows, the `yak` space and its `platform` app among them.
await seeding(meta(p.env))

// The platform app's connection through `integration`, read as `binding`.
let given = async (integration: string, binding: string, key: string) => {
  let [app] = await c.graph.read(line`.app.store=${PLATFORM_STORE}&*`)
  let made = await c.graph.apply(
    await need(c.graph.read, {
      owner: String((app.app as { space: string }).space),
      app: app.entity.eid,
      integration,
      binding,
    }),
  )
  await connect(c, made.find((b) => b.connection)!.entity.eid, { key })
}

// A fresh env, as a new isolate is handed one.
let fresh = (vars: object = {}) => ({ ...p.env, ...vars })

test('a Worker secret answers until its connection is given, and the connection over it after', async () => {
  let env = fresh({ ANTHROPIC_API_KEY: 'secret' })
  assertEquals((await keyed(env)).ANTHROPIC_API_KEY, 'secret')
  await given('anthropic', 'ANTHROPIC_API_KEY', 'pasted')
  let next = fresh({ ANTHROPIC_API_KEY: 'secret' })
  assertEquals((await keyed(next)).ANTHROPIC_API_KEY, 'pasted')
  assertEquals({ ...await keyed(next) }.ANTHROPIC_API_KEY, 'pasted')
})

test('keying is idempotent: an env and its keyed env key to one object', async () => {
  let env = fresh()
  let once = await keyed(env)
  assertEquals([await keyed(env) == once, await keyed(once) == once], [
    true,
    true,
  ])
})

test("ElevenLabs speaks on yaks.app's key for a space without its own, charged to the space", async () => {
  await given('elevenlabs', 'ELEVENLABS_API_KEY', 'platform-key')
  let eid = mint()
  let env = fresh({ SPEECH_API: eleven.url })
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
  let said = await speaking(env, (await dir.at(eid))!, 'Ahoy there.', {
    provider: ELEVENLABS,
  })
  await said.body?.cancel()
  assertEquals(asked, ['platform-key'])
  assertEquals(budget((await dir.at(eid))!).spent > 0, true)
})
