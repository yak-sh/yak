// The Operator's own memory tools, as each member's conversation holds them
// (operator.ts `memories`): a save is its person's unless shared, a memory
// moves between them and the space only when shared is given, and a member
// forgets any memory they can recall, never another member's private one.
import { equal, test } from '@yaks/testing'
import { assertRejects as rejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { line } from '@yaks/query'
import { memoryDoc } from '@yaks/memory/vocab'
import { runs } from '@yaks/memory/tools'
import { memoryAudience } from '@yaks/platform/operator-memory'
import { operatorMemory } from './operator-testing.ts'
import { seenBy } from './operator-access.ts'

let [ada, bea] = [crypto.randomUUID(), crypto.randomUUID()]
let store = operatorMemory()
await store.g.apply([
  { entity: { eid: ada }, person: {} },
  { entity: { eid: bea }, person: {} },
], { trusted: true })

// One member's call to one of the Operator's memory tools, applied as the
// Operator applies it.
let ask = async (person: string, name: string, args: object) => {
  let [tool] = loadTools([memoryDoc], runs()).filter((t) => t.name == name)
  let held = name == 'memory_save' ? memoryAudience(tool, person) : tool
  let graph = seenBy(store, { person, member: true })
  let out = await held.run({ entity: { eid: '$c' }, call: { args } }, graph)
  return await store.g.apply(out as Bundle[])
}
let save = async (person: string, args: object) =>
  (await ask(person, 'memory_save', args))[0].entity.eid
let audience = async (eid: string) =>
  ((await store.g.get([eid]))[0]?.operator_memory as Comp | undefined)
    ?.person ?? 'space'
let recalls = async (person: string, eid: string) =>
  (await seenBy(store, { person, member: true }).get([eid])).length > 0

let hive = await save(ada, { said: 'My practice hive is named Juniper' })
let demo = await save(ada, { said: 'Our demo hive is Copper', shared: true })

test('a save is the person’s own unless it is shared', async () => {
  equal([await audience(hive), await audience(demo)], [ada, 'space'])
  equal([await recalls(bea, hive), await recalls(bea, demo)], [false, true])
})

test('a patch that leaves shared out keeps whom the memory is for', async () => {
  await save(bea, { id: demo, context: 'the apiary app' })
  equal(await audience(demo), 'space')
})

test('shared true or false moves a memory to the space and back', async () => {
  let moving = await save(ada, { said: 'I keep a spare queen' })
  await save(ada, { id: moving, shared: true })
  equal(await recalls(bea, moving), true)
  await save(ada, { id: moving, shared: false })
  equal([await audience(moving), await recalls(bea, moving)], [ada, false])
})

test('nobody forgets or moves another member’s private memory', async () => {
  await rejects(
    () => ask(bea, 'memory_forget', { id: hive }),
    Error,
    'no memory:',
  )
  await rejects(
    () => save(bea, { id: hive, shared: true }),
    Error,
    'no memory:',
  )
  equal(await audience(hive), ada)
})

test('a member forgets their own memory and a shared one', async () => {
  await ask(ada, 'memory_forget', { id: hive })
  await ask(bea, 'memory_forget', { id: demo })
  equal((await store.g.read(line`.memory&.entity.eid=${hive},${demo}`)).length, 0)
})
