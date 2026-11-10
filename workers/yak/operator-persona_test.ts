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
import { BASE, personaFor } from './operator-persona.ts'
import { spaced } from './operator-persona.ts'
import { link } from '@yaks/edge'
import { KERNEL, meta } from './meta.ts'
import { derivedEid } from '@yaks/graph/identity'

let owner = crypto.randomUUID()
// The platform holds Anthropic's key, so the Operator is on Claude.
let { env } = platform('operator-persona', { ANTHROPIC_API_KEY: 'probe' })
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

// A doc an earlier deploy's code declared, which this one does not.
let retired = derivedEid('operator-persona|retired')
await meta(env).apply([
  { entity: { eid: retired }, doc: { title: 'Retired', body: 'Gone now.' } },
  link(BASE, 'contains', retired, 99),
], KERNEL)
let first = await said('Hi')
await meta(env).apply([{
  entity: { eid: BASE },
  doc: { body: 'Speak plainly, and keep every answer short.' },
}], KERNEL)
let second = await said('Again')
let [persona] = await store.g.get([personaFor(space.eid)])
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
    'Someone signing up',
    "An app's icon",
    'Where they are',
    'Making a new app',
    `${space.operator}, the Operator of home`,
    'Who you are',
  ])
  assertStringIncludes(
    String(first.instructions),
    `You are ${space.operator}, the Operator of home`,
  )
  assertEquals(persona.persona, { base: BASE, home: space.eid })
})

test('a doc the code no longer declares leaves the base', () => {
  assertEquals(String(first.instructions).includes('Gone now.'), false)
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

let legacy = operatorMemory()
let session = crypto.randomUUID(), note = crypto.randomUUID()
await legacy.g.apply([
  {
    entity: { eid: space.eid },
    persona: { base: BASE },
    doc: { title: 'Old Operator', body: 'Keep my editable instructions.' },
  },
  { entity: { eid: note }, doc: { body: 'An authored memory.' } },
  link(space.eid, 'contains', note, 3),
  { entity: { eid: session }, session: { persona: space.eid } },
])
await legacy.g.apply(await spaced(legacy.g.storage, space))
let moved = await legacy.g.get([space.eid, personaFor(space.eid), session])
let holdings = await legacy.g.read(
  `.contains .edge.from=${personaFor(space.eid)}`,
)
let again = await spaced(legacy.g.storage, space)

test('separating a space topic from its Operator persona preserves authored text, holdings and sessions once', async () => {
  assertEquals(moved[0].persona, undefined)
  assertEquals(moved[1].doc, {
    title: `${space.operator}, the Operator of home`,
    body: 'Keep my editable instructions.',
  })
  assertEquals(
    (moved[2].session as { persona: string }).persona,
    personaFor(space.eid),
  )
  assert(holdings.some((b) => (b.edge as { to: string }).to == note))
  assertEquals(await legacy.g.read(`.contains .edge.from=${space.eid}`), [])
  assertEquals(again, [])
})
