// What an Operator is told is personas in the graph (D-137704, "Layers"): the
// platform's base persona in the directory, with the space's own worn on it,
// then where it is. An edit to the base reaches the next turn.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { BASE } from './operator-persona.ts'
import { KERNEL, meta } from './meta.ts'

let owner = crypto.randomUUID()
let { env } = platform('operator-persona')
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'home', 'Home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let asked: Request[] = []
let operator = operating(store, env, {
  ...operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Hello.' }],
    })
  }),
  // A Claude model, so coding goes to a stronger one in a helper.
  name: 'claude-sonnet-5-5',
})
let held = { person: owner }
let said = async (say: string, task?: string) => {
  await operator.ask(held, space, { say }, { task })
  await drain(store)
  return asked.at(-1)!
}

let first = await said('Hi')
await meta(env).apply([{
  entity: { eid: BASE },
  doc: { body: 'Speak plainly, and keep every answer short.' },
}], KERNEL)
let second = await said('Again')
let [persona] = await store.g.get([space.eid])
let tasked = await said('Fix the chores app', crypto.randomUUID())

// Each part's heading, in the order it is said.
let parts = (r: Request) =>
  String(r.instructions).split('\n').filter((l) => l.startsWith('# '))
    .map((l) => l.replace(/^# \S+ /, ''))

test('the base comes first, then the space persona worn on it, then where it is', () => {
  assertEquals(parts(first), [
    'yaks.app Operator',
    'yaks.app',
    'Your conversations, and the work they fork',
    'What you have done, and finding it again',
    `${space.operator}, the Operator of home`,
    'Who you are',
  ])
  assertStringIncludes(
    String(first.instructions),
    `You are ${space.operator}, the Operator of home`,
  )
  assertEquals(persona.persona, { base: BASE })
})

test('the guidance is a doc in the directory: an edit reaches the next turn', () => {
  assertStringIncludes(String(first.instructions), "Read the app's schema")
  assertStringIncludes(String(second.instructions), 'Speak plainly')
  assert(!String(second.instructions).includes("Read the app's schema"))
})

test("a tool's guidance is where the tool is given", () => {
  let spawn = first.tools.find((t) => t.name == 'spawn')!
  assertStringIncludes(spawn.description, 'use spawn with model claude-opus')
  assert(!String(first.instructions).includes('use spawn with model'))
  assert(!first.tools.some((t) => t.name == 'task_update'))
  let close = tasked.tools.find((t) => t.name == 'task_update')!
  assertStringIncludes(close.description, 'carries on that task')
})
