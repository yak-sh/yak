// A member's Operator reading their app's rows (T-1064): an answer is `heard`
// when a stranger wrote a row in it, a person outside the space or a visitor
// who never signed in, and stays ordinary for the space's own people.
import { equal, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import type { Env } from './env.ts'
import { client, connector, fresh, signIn } from './probe.ts'
import { directoryOf } from './directory.ts'
import { operatorContext, operatorRoster } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'

let env!: Env
let k = await fresh({}, (e) => (env = e))
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
      '{"$defs":{"note":{"properties":{"by":{"type":"string"}}}}}',
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

let ctx = await operatorContext(env, { person: owner.person }, space, () => dir)
let tools = await operatorRoster(ctx, operatorMemory(), { space: space.eid })
let heard = async (by: string) => {
  let args = { app, q: `.note.by=${by}` }
  let out = await tools.find((t) => t.name == 'graph_query')!.run(args, {
    session: mint(),
    call: { entity: { eid: mint() }, call: { to: toolEid('graph_query') } },
    entries: [],
  })
  return typeof out == 'object' && !!out.with?.heard
}

test("an Operator's read is heard when a stranger wrote a row of it, and not when its space's people did", async () => {
  equal(
    await Promise.all(['owner', 'colleague', 'stranger', 'visitor'].map(heard)),
    [false, false, true, true],
  )
})
