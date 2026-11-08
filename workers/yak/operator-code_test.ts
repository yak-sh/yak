import { equal, match, ok, test, until } from '@yaks/testing'
import type { Item, Request } from '@yaks/model'
import type { Comp } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { platform } from './directory-probe.ts'
import { compiler } from './testing.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operating } from './operator.ts'
import { drain } from './operator-store.ts'
import { handleChannels, receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'

let { env } = platform('operator-code', {
  CODE_MODE: evaluate,
  ESBUILD: compiler(),
})
let owner = crypto.randomUUID()
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'bulk-home', 'Bulk home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let asked: Request[] = []
let answers: string[] = []
let script = `
  await tools.yaks.app_new({slug:'bulk',title:'Bulk'});
  await tools.yaks.app_files({app:'bulk',files:[{path:'vocab.json',content:JSON.stringify({$defs:{bulk_note:{component:true,type:'object',properties:{body:{type:'string'}}}}})}]});
  await tools.yaks.app_deploy({app:'bulk'});
  await tools.yaks.graph_apply({bundles:[{entity:{eid:'$note'},bulk_note:{body:'written in bulk'}}]});
  return await tools.yaks.graph_query({q:'.bulk_note'});
`
let call = (name: string, args: object): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
let respond = (req: Request): Item[] => {
  asked.push(req)
  let fork = JSON.stringify(req.items).includes('fork of the')
  let last = req.items.at(-1)!
  if (!fork) {
    return req.items.some((i) => i.kind == 'result')
      ? say('On it.')
      : call('fork', { prompt: 'Create the app and write its first note.' })
  }
  if (last.kind != 'result') return call('code_mode', { search: 'app_new' })
  answers.push(last.output)
  return answers.length == 1
    ? call('code_mode', { script })
    : say('Created the app and its first note.')
}
let operator = operating(
  store,
  env,
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: respond(req),
      cost: 0.001,
    }), { output: 32_000 }),
)
handleChannels(operator, env)
await receive(store, {
  space: space.eid,
  person: owner,
  channel: 'chat',
}, 'Create an app and write its first note.')
await drain(store)
let root = rootOf(space.eid, owner)
let [fork] = await store.g.read(`.spawned.parent=${root}`)
let calls = await store.g.read(`.call.to=${toolEid('code_mode')} &*`)
let bulk = calls.find((b) => ((b.call as Comp).args as Comp)?.script)
let nested = await store.g.read(`.call.source=${bulk?.entity.eid} &*`)

test('root and fork offer the same code mode; the fork discovers and runs connector tools in bulk', () => {
  let atRoot = asked[0].tools.find((t) => t.name == 'code_mode')
  ok(atRoot)
  equal(
    asked.find((r) => JSON.stringify(r.items).includes('fork of the'))!
      .tools.find((t) => t.name == 'code_mode'),
    atRoot,
  )
  ok(answers[0]?.includes('"app_new"'))
  let out = JSON.parse(answers[1].replace(/\ntook [^\n]*$/, ''))
  equal(out.error, undefined)
  equal(out.calls.length, 5)
  match(out.value, {
    structuredContent: {
      result: [{ bulk_note: { body: 'written in bulk' } }],
    },
  })
})

test('nested Operator calls keep their source and the fork writer', () => {
  equal(nested.length, 5)
  for (let b of nested) {
    equal((b.created as Comp).by, space.eid)
    equal((b.created as Comp).via, fork.entity.eid)
  }
})

test('the Operator gives its model row the limits its catalogue lists and uses its output allowance', async () => {
  await until(async () =>
    (await store.g.read('.model.context')).some((b) =>
      (b.model as Comp).context == 1000 && (b.model as Comp).output == 32_000
    )
  )
  ok(asked.length > 0)
  ok(asked.every((req) => req.tokens == 32_000))
})
