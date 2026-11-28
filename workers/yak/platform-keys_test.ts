// yaks.app's own keys (platform-keys.ts): a connection of the `yak` space that
// its `platform` app uses under a name answers that name over the Worker
// secret of it, which answers alone until one is given; and ElevenLabs speaks
// on that key for a space without its own account, charged to the space.
import { assertEquals, assertRejects } from '@std/assert'
import { connect, need } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { mint } from '@yaks/graph'
import { budget, monthOf } from '@yaks/platform/meter'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { line } from '@yaks/query'
import { ELEVENLABS } from '@yaks/speech'
import { test } from '@yaks/testing'
import { d1 } from '../../packages/d1/testing.ts'
import { comp, connecting, ctxOf } from './connections.ts'
import { directoryOf, seeding, stamp } from './directory.ts'
import { endpoints } from './endpoints.ts'
import { meta } from './meta.ts'
import { invokePackage } from './package-tools.ts'
import { phoneAddress, phoneNamed, phoneOf, textable } from './phones.ts'
import { keyed } from './platform-keys.ts'
import { connector, fresh as kernel, signIn } from './probe.ts'
import type { Env } from './env.ts'
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
let given = async (
  integration: string,
  binding: string,
  key: string,
  hosts?: string[],
) => {
  let [app] = await c.graph.read(line`.app.store=${PLATFORM_STORE}&*`)
  let made = await c.graph.apply(
    await need(c.graph.read, {
      owner: String((app.app as { space: string }).space),
      app: app.entity.eid,
      integration,
      binding,
      hosts,
    }),
  )
  await connect(c, made.find((b) => b.connection)!.entity.eid, { key })
}

// A fresh env, as a new isolate is handed one.
let fresh = (vars: object = {}) => ({ ...p.env, ...vars })

test('reading a phone address or looking for an unknown provider does not read credentials', async () => {
  let env = fresh({ PHONE_SENDER: { via: 'telnyx', number: '+18885550100' } })
  let { STORE } = env
  let reads = 0
  env.STORE = {
    ...STORE,
    get: (id) => {
      reads++
      return STORE.get(id)
    },
  }
  assertEquals(await phoneNamed(env, 'unconfigured'), undefined)
  assertEquals(await phoneAddress(env), {
    number: '+18885550100',
    calling: true,
  })
  assertEquals(reads, 0)
})

test('a Worker secret answers until its connection is given, and the connection over it after', async () => {
  let env = fresh({ ANTHROPIC_API_KEY: 'secret' })
  assertEquals((await keyed(env)).ANTHROPIC_API_KEY, 'secret')
  await given('anthropic', 'ANTHROPIC_API_KEY', 'pasted')
  let next = fresh({ ANTHROPIC_API_KEY: 'secret' })
  let key = () => keyed(next).then((env) => env.ANTHROPIC_API_KEY)
  assertEquals(await Promise.all([key(), key()]), ['pasted', 'pasted'])
  assertEquals({ ...await keyed(next) }.ANTHROPIC_API_KEY, 'pasted')
})

test('Telnyx can send a platform text on the connection alone', async () => {
  await given('telnyx-platform', 'TELNYX_API_KEY', 'text-key', [
    'api.telnyx.com',
  ])
  let from = '+18885550100'
  let to = '+12695550142'
  let telnyx = endpoints(globalThis).open(async (req) => {
    assertEquals(new URL(req.url).pathname, '/messages')
    assertEquals(req.headers.get('authorization'), 'Bearer text-key')
    assertEquals(await req.json(), { from, to, text: 'Hello' })
    return Response.json({ data: { id: 'accepted' } })
  })
  try {
    let env = fresh({
      TELNYX_API: telnyx.url,
      PHONE_SENDER: { via: 'telnyx', number: from },
      TEXT_SIGNUP: 'on',
    })
    assertEquals(await textable(env), true)
    assertEquals(await (await phoneOf(env)).send({ to, text: 'Hello' }), {
      id: 'accepted',
      via: 'telnyx',
      from,
    })
  } finally {
    await telnyx.stop()
  }
})

test('four OpenAI project keys can be requested and pasted separately, each over its Worker secret', async () => {
  let dir = directoryOf(p.env.STORE)
  let space = (await dir.space('yak'))!
  let person = mint()
  let who = { person, role: 'owner' as const }
  await stamp(p.env, {
    entities: [
      { entity: { eid: person }, person: {} },
      {
        entity: { eid: mint() },
        member: { space: space.eid, person, role: 'owner' },
      },
    ],
  })
  let bindings = [
    'OPENAI_API_KEY',
    'OPENAI_VOICE_KEY',
    'OPENAI_MODELS_KEY',
    'OPENAI_OPERATOR_API_KEY',
  ]
  let fallback = Object.fromEntries(
    bindings.map((binding) => [binding, 'fallback']),
  )
  let ask = async (binding: string) => {
    let made = await invokePackage(
      { env: p.env, dir, person },
      'connection_need',
      {
        space: 'yak',
        app: 'platform',
        owner: 'yak',
        integration: 'openai-api',
        binding,
        separate: true,
      },
    )
    let connection = made.find((b) => b.connection)!
    assertEquals(comp(connection, 'connection').integration, 'openai-api')
    return connection.entity.eid
  }
  let requests = []
  for (let binding of bindings) requests.push(await ask(binding))
  assertEquals(new Set(requests).size, 4)
  assertEquals(await ask(bindings[0]), requests[0])
  for (let [index, binding] of bindings.entries()) {
    let fields = new FormData()
    fields.set('do', 'key')
    fields.set('connection', requests[index])
    fields.set('key', `key-${index}`)
    let said = await connecting(
      new Request('https://yaks.app/manage/yak/connections'),
      p.env,
      space,
      who,
      fields,
    )
    if (said instanceof Response) {
      throw new Error(`Unexpected response ${said.status}`)
    }
    if (said.no) throw new Error(said.say)
    fallback[binding] = `key-${index}`
    let env = await keyed(
      fresh(
        Object.fromEntries(bindings.map((binding) => [binding, 'fallback'])),
      ),
    )
    assertEquals(
      Object.fromEntries(
        bindings.map((binding) => [binding, env[binding as keyof typeof env]]),
      ),
      fallback,
    )
  }
})

let workerKeys = {
  OPENAI_API_KEY: 'images-key',
  OPENAI_VOICE_KEY: 'voice-key',
  OPENAI_MODELS_KEY: 'models-key',
  OPENAI_OPERATOR_API_KEY: 'operator-key',
}
let importedFrom!: Env
let k = await kernel({
  ...workerKeys,
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
}, (env) => importedFrom = env)
let platformAdmin = connector(k, k.owner.cookie)
let stranger = connector(k, (await signIn(k, 'key-import@example.test')).cookie)

test('only the platform admin can import a Worker binding', async () => {
  await assertRejects(
    () =>
      stranger.tool('platform_connection_import', {
        binding: 'OPENAI_API_KEY',
      }),
    Error,
    'Platform admin sign-in required',
  )
  await assertRejects(
    () =>
      platformAdmin.tool('platform_connection_import', {
        binding: 'SESSION_SECRET',
      }),
    Error,
    'Choose a supported platform provider binding',
  )
})

test('platform credential import fills existing requests and serves all four keys without Worker bindings', async () => {
  for (let [binding, key] of Object.entries(workerKeys)) {
    let made = await invokePackage(
      { env: importedFrom, dir: k.dir, person: k.owner.person },
      'connection_need',
      {
        space: 'yak',
        app: 'platform',
        owner: 'yak',
        integration: 'openai-api',
        binding,
        separate: true,
      },
    )
    let connection = made.find((b) => b.connection)!.entity.eid
    let answer = () =>
      platformAdmin.answer('platform_connection_import', { binding })
    let imported = await answer()
    assertEquals(imported.value, {
      binding,
      connection,
      status: 'imported',
      workerMatches: true,
    })
    assertEquals(JSON.stringify(imported).includes(key), false)
    assertEquals((await answer()).value, {
      binding,
      connection,
      status: 'connected',
      workerMatches: true,
    })
  }
  let noWorkerKeys = { ...importedFrom } as Record<string, unknown>
  for (let binding of Object.keys(workerKeys)) delete noWorkerKeys[binding]
  let served = await keyed(noWorkerKeys)
  assertEquals(
    Object.fromEntries(
      Object.keys(workerKeys).map((binding) => [binding, served[binding]]),
    ),
    workerKeys,
  )
})

test('keying is idempotent: an env and its keyed env key to one object', async () => {
  let env = fresh()
  let once = await keyed(env)
  assertEquals([await keyed(env) == once, await keyed(once) == once], [
    true,
    true,
  ])
})

test('overlapping cold callers load the platform credentials once', async () => {
  await given('deepgram', 'DEEPGRAM_API_KEY', 'speech-key')
  let env = fresh()
  let { STORE } = env
  let appReads = 0
  env.STORE = {
    ...STORE,
    get: (id) => {
      let store = STORE.get(id)
      return {
        ...store,
        fetch: (req) => {
          if (new URL(req.url).searchParams.get('q')?.includes('.app.store=')) {
            appReads++
          }
          return store.fetch(req)
        },
      }
    },
  }
  let [first, second] = await Promise.all([keyed(env), keyed(env)])
  assertEquals([first, second], [await keyed(env), first])
  assertEquals(first.DEEPGRAM_API_KEY, 'speech-key')
  assertEquals(appReads, 1)
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
