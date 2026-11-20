// A member's Operator reading their app's rows (T-1064): an answer is `heard`
// when a stranger wrote a row in it, a person outside the space or a visitor
// who never signed in, and stays ordinary for the space's own people. A
// code_mode script's reads are heard the same way (T-1066).
import { equal, match, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { evaluate } from '../../packages/code-mode/testing.ts'
import type { Env } from './env.ts'
import { client, connector, fresh, signIn } from './probe.ts'
import { directoryOf, storeName } from './directory.ts'
import { GRANT, owning } from './dispatch.ts'
import { compiler } from './testing.ts'
import { KERNEL, meta } from './meta.ts'
import { idOf } from '@yaks/platform/listing'
import { operatorContext, operatorRoster } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'

let env!: Env
let k = await fresh({}, (e) => {
  env = Object.assign(e, { CODE_MODE: evaluate, ESBUILD: compiler() })
})
let [owner, colleague, stranger] = [
  await signIn(k),
  await signIn(k),
  await signIn(k),
]
let agent = connector(k, owner.cookie)
let dir = directoryOf(env.STORE)
let space = (await dir.space(owner.name))!
await dir.apply({
  entities: [{
    entity: { eid: mint() },
    member: { person: colleague.person, space: space.eid, role: 'editor' },
  }],
}, { 'x-yak-person': owner.person, 'x-yak-role': 'owner' })
let app = 'notes'
await agent.answer('app_new', { slug: app, title: 'Notes', access: 'open' })
for (
  let [path, content] of [
    ['index.html', '<h1>Notes</h1>'],
    [
      'vocab.json',
      '{"$defs":{"note":{"properties":{"by":{"type":"string"},"body":{"type":"string"},"heading":{"type":"string"}}}}}',
    ],
  ]
) await agent.tool('app_files', { app, op: 'write', path, content })
await agent.tool('app_deploy', { app })
let note = (by: string) => [{ entity: { eid: mint() }, note: { by } }]
let host = `${owner.name}.${k.host}`
await agent.tool('graph_apply', { app, entities: note('owner') })
await client(k, host, app, colleague.cookie).applied(note('colleague'))
await client(k, host, app, stranger.cookie).applied(note('stranger'))
await client(k, host, app).applied(note('visitor'))

let stored = (await dir.app(space, app))!
let browser = mint()
for (
  let [by, visitor] of [
    ['app', undefined],
    ['app-visitor', { person: null, via: browser }],
  ] as const
) {
  let res = await k.at(host, `/${app}/api/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [GRANT]: await owning(
        k.secret,
        storeName(space, stored),
        stored,
        visitor,
      ),
      'x-yak-via': mint(),
    },
    body: JSON.stringify(note(by)),
  })
  if (!res.ok) throw new Error(`App write ${res.status}: ${await res.text()}`)
}
let appNotes = await client(k, host, app, owner.cookie).get(
  '.note.by=app,app-visitor&?created&.order=note.by',
)
await dir.apply({
  entities: [{
    entity: { eid: mint() },
    grant: { app: stored.eid, person: stranger.person, access: 'editor' },
  }],
}, { 'x-yak-person': owner.person, 'x-yak-role': 'owner' })
let mixed = mint(), cleared = mint(), appended = mint()
await agent.tool('graph_apply', {
  app,
  entities: [mixed, cleared, appended].map((eid, i) => ({
    entity: { eid },
    note: {
      by: ['mixed', 'cleared', 'appended'][i],
      heading: 'Member heading',
    },
  })),
})

let claimed = client(k, host, app)
await claimed.applied(note('claimed'))
let [guest] = await claimed.get('.note.by=claimed&?created')
let via = idOf((guest.created as { via: string | { eid: string } }).via)
await meta(env).apply([{
  entity: { eid: via },
  browser: { by: owner.person },
}], KERNEL)
await agent.tool('graph_apply', {
  app,
  entities: [{
    entity: guest.entity,
    note: { heading: 'Member heading' },
  }],
})
await client(k, host, app, stranger.cookie).applied(
  [mixed, cleared, appended].map((eid) => ({
    entity: { eid },
    note: { body: 'Stranger instructions' },
  })),
)
await agent.tool('graph_apply', {
  app,
  entities: [
    { entity: { eid: mixed }, note: { heading: 'Revised heading' } },
    {
      entity: { eid: cleared },
      note: { body: 'Completely different wording' },
    },
    {
      entity: { eid: appended },
      note: { body: 'Stranger instructions plus member text' },
    },
  ],
})

let ctx = await operatorContext(env, { person: owner.person }, space, () => dir)
let tools = await operatorRoster(ctx, operatorMemory(), { space: space.eid })
let heard = async (name: string, args: Record<string, unknown>) => {
  let out = await tools.find((t) => t.name == name)!.run(args, {
    session: mint(),
    call: { entity: { eid: mint() }, call: { to: toolEid(name) } },
    entries: [],
  })
  return typeof out == 'object' && !!out.with?.heard
}
let writers = [
  'owner',
  'colleague',
  'stranger',
  'visitor',
  'app',
  'app-visitor',
]

test('env.APP stamps the app and the verified instrument that prompted its write', () => {
  match(appNotes, [
    { created: { by: stored.eid, via: stored.eid } },
    { created: { by: stored.eid, via: browser } },
  ])
})

test("an Operator's read is heard when a stranger wrote a row of it, and not when its space's people did", async () => {
  equal(
    await Promise.all(
      writers.map((by) => heard('graph_query', { app, q: `.note.by=${by}` })),
    ),
    [false, false, true, true, true, true],
  )
})

test("a code_mode script's read is heard as a direct one is", async () => {
  equal(
    await Promise.all(writers.map((by) =>
      heard('code_mode', {
        script: `await tools.yaks.graph_query({app:'${app}',q:'.note.by=${by}'})
          return 'read'`,
      })
    )),
    [false, false, true, true, true, true],
  )
})

test('an intermediate stranger stays heard after member edits, until their words are replaced', async () => {
  equal(
    await Promise.all(
      ['mixed', 'cleared', 'appended'].map((by) =>
        heard('graph_query', { app, q: `.note.by=${by}` })
      ),
    ),
    [
      true,
      false,
      true,
    ],
  )
})

test('claimed guest words belong to the verified member even after later edits', async () => {
  equal(await heard('graph_query', { app, q: '.note.by=claimed' }), false)
})
