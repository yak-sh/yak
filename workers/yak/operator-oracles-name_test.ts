import { equal, test } from '@yaks/testing'
import { line } from '@yaks/query'
import { named } from '@yaks/topic'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { declared } from './directory-fixture.ts'
import { operatorContext } from './operator.ts'
import { oracleMap, oracleOf, oracleTopic } from './operator-oracles.ts'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'

let person = crypto.randomUUID()
let { env } = platform('operator-oracle-names')
let dir = directoryOf(env.STORE)
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let eid = await dir.mint(person, 'home', 'Home', owner)
let space = (await dir.at(eid))!
let app = async () => {
  let eid = crypto.randomUUID()
  await dir.apply({
    entities: [{
      entity: { eid },
      app: { space: space.eid, slug: 'recipes', version: 1, access: 'private' },
      doc: { title: 'Recipe box' },
    }],
  }, owner)
  await declared(env, space, (await dir.app(space, 'recipes'))!, {
    vocab: { $defs: {} },
    tools: {},
  })
  return eid
}
let old = await app()
let { g } = await operatorStore(durable())
let oldTopic = oracleOf(person, old)
// A projection kept by the code before names were scoped to their subject.
await g.apply([{
  entity: { eid: oldTopic },
  topic: { name: named(`home/recipes ${person}`) },
  operator_oracle: { person, subject: old },
  content: { body: 'What the old recipe box learned.' },
}], { trusted: true })
await dir.apply({ entities: [{ entity: { eid: old }, $delete: true }] }, owner)
let current = await app()
let ctx = await operatorContext(env, { person }, space)

test('a reused app slug gets its own oracle without taking the old topic or its learned contents', async () => {
  await oracleMap(ctx, g)
  equal(await oracleTopic(ctx, g, current), oracleOf(person, current))
  let [kept] = await g.get([oldTopic])
  equal(kept.content, { body: 'What the old recipe box learned.' })
  let [fresh] = await g.get([oracleOf(person, current)])
  equal(fresh.content, undefined)
  equal(fresh.doc, {
    title: 'home/recipes',
    body: 'Recipe box. https://home.yaks.app/recipes/',
  })
  let before = await g.read(line`.topic&*`)
  await oracleMap(ctx, g)
  equal(await g.read(line`.topic&*`), before)
})
