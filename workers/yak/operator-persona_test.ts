// What an Operator is told is personas in the graph (D-137704, "Layers"): the
// platform's base persona in the directory, with the space's own worn on it,
// then where it is. An edit to the base reaches the next turn.
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import {
  callable,
  operatorMemory,
  operatorModel,
  promptOf,
} from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { BASE, bases, personaFor } from './operator-persona.ts'
import { spaced } from './operator-persona.ts'
import { link } from '@yaks/edge'
import { KERNEL, meta } from './meta.ts'
import { derivedEid } from '@yaks/graph/identity'
import { PRICE } from '@yaks/platform/plans'
import { short } from '@yaks/id'

let owner = crypto.randomUUID()
// The platform holds Anthropic's key, so the Operator is on Claude.
let { env } = platform('operator-persona', {
  OPENAI_OPERATOR_API_KEY: 'probe',
})
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
    // After its first words it loads two tools, to be sent them whole.
    let last = req.items.at(-1)
    let loads = last?.kind == 'user' && last.text != 'Hi'
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: loads
        ? [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'tool_load',
          args: JSON.stringify({ names: ['spawn', 'task_update'] }),
        }]
        : [{ kind: 'assistant', text: 'Hello.' }],
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

// A doc an earlier deploy's files held, which this one's do not.
let retired = derivedEid('operator-persona|retired')
await meta(env).apply([
  { entity: { eid: retired }, doc: { title: 'Retired', body: 'Gone now.' } },
  link(BASE, 'contains', retired, 99),
], KERNEL)
let first = await said('Hi')
let otherId = await dir.mint(owner, 'other', 'Other', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let other = (await dir.at(otherId))!
let otherStore = operatorMemory()
let otherOperator = operating(otherStore, env, {
  ...operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: 'other',
      model: req.model,
      items: [{ kind: 'assistant', text: 'Hello.' }],
    })
  }),
  name: 'claude-sonnet-5-5',
})
await otherOperator.ask(held, other, { say: 'Hi' }, {})
await drain(otherStore)
let otherAsk = asked.at(-1)!
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
    'What you have done, and finding it again',
    'Your conversations, and the work they fork',
    space.operator,
    'Who you are',
  ])
  assertStringIncludes(
    String(first.instructions),
    `You are ${space.operator}, the Operator of home`,
  )
  assertEquals(persona.persona, { base: BASE, home: space.eid })
})

test('what only some turns need is named under Reads, by id and when to open it, not said', () => {
  let reads = String(first.instructions).split('## Reads').slice(1).join(
    '## Reads',
  )
  for (
    let title of [
      'Working in the apps: open before',
      'Making a new app: open before',
      'Options: open when',
      'Someone signing up: open on',
      'Your name and voice: open when',
    ]
  ) assertStringIncludes(reads, title)
  assert(!String(first.instructions).includes('A new app is made, not drafted'))
  assert(first.tools.some((t) => t.name == 'read_open'))
})

test("the base's files say the platform's own numbers", async () => {
  let [starting] = await bases(env).get([
    derivedEid('operator-persona|starting'),
  ])
  assertStringIncludes(
    String((starting.doc as { body: string }).body),
    `$${PRICE.plus} a month`,
  )
  assert(!String(first.instructions).includes('{{'))
})

test('a plan change reaches the Operator in turn context', async () => {
  assertStringIncludes(
    promptOf(first),
    'home is on the free plan: 5 apps, 100 emails',
  )
  let before = await said('Hi')
  await meta(env).apply([{
    entity: { eid: space.eid },
    plan: { tier: 'plus' },
  }], KERNEL)
  let after = await said('Hi')
  assertEquals(after.instructions, before.instructions)
  assertStringIncludes(
    promptOf(after),
    'home is on the Plus plan: as many apps as it likes, 2,500 emails',
  )
})

test('a doc the files no longer hold leaves the base', () => {
  assertEquals(String(first.instructions).includes('Gone now.'), false)
})

test('the guidance is a doc in the directory: an edit reaches the next turn', () => {
  assertStringIncludes(String(first.instructions), "Read the app's schema")
  assertStringIncludes(String(second.instructions), 'Speak plainly')
  assert(!String(second.instructions).includes("Read the app's schema"))
})

test("a tool's guidance is where the tool is given, once it is loaded", () => {
  let spawn = first.tools.find((t) => t.name == 'spawn')!
  assertStringIncludes(spawn.description, 'To consult an app or space oracle')
  assert(
    !String(first.instructions).includes('To consult an app or space oracle'),
  )
  let update = second.tools.find((t) => t.name == 'task_update')!
  assert(!update.description.includes('carries on that task'))
  let close = tasked.tools.find((t) => t.name == 'task_update')!
  assertStringIncludes(close.description, 'carries on that task')
})

test("an Operator holds the space's task and goal tools, and leaves answering its questions to the person", () => {
  let names = callable(first)
  let work = ['task_new', 'task_list', 'task_update', 'decision_new']
  assertEquals(
    [...work, 'goal_new', 'goal_list', 'goal_update'].filter((n) =>
      !names.includes(n)
    ),
    [],
  )
  assert(!names.includes('decision_answer'))
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
  line`.contains .edge.from=${personaFor(space.eid)}`,
)
let again = await spaced(legacy.g.storage, space)

test('separating a space topic from its Operator persona preserves authored text, holdings and sessions once', async () => {
  assertEquals(moved[0].persona, undefined)
  assertEquals(moved[1].doc, {
    title: space.operator,
    body: 'Keep my editable instructions.',
  })
  assertEquals(
    (moved[2].session as { persona: string }).persona,
    personaFor(space.eid),
  )
  assert(holdings.some((b) => (b.edge as { to: string }).to == note))
  assertEquals(
    await legacy.g.read(line`.contains .edge.from=${space.eid}`),
    [],
  )
  assertEquals(again, [])
})

test('it is told its session and the model its using names, never another assistant', () => {
  let text =
    first.turnContext?.flatMap((item) =>
      item.kind == 'instruction' ? [item.text] : []
    ).join('\n') ?? ''
  assertStringIncludes(text, `your session ${short(first.conversation!)}`)
  assertStringIncludes(text, `answered by the model ${first.model}`)
  assertStringIncludes(text, 'never ChatGPT, Claude')
})

test('Operator spaces with the same tools share the base prefix and keep local context after it', () => {
  let prefix = (ask: Request) =>
    ask.instructions!.slice(0, ask.cachePrefix!.length)
  assertEquals(first.cachePrefix, otherAsk.cachePrefix)
  assertEquals(prefix(first), prefix(otherAsk))
  let sharedTools = (ask: Request) =>
    ask.tools.filter((t) => ask.cachePrefix?.tools?.includes(t.name))
  assertEquals(sharedTools(first), sharedTools(otherAsk))
  assert(first.instructions != otherAsk.instructions)
  assert(!prefix(first).includes('the Operator of home'))
  assert(
    first.turnContext?.some((item) =>
      item.kind == 'instruction' &&
      item.text.includes(short(first.conversation!))
    ),
  )
})

// A stranger's helper is worn on the same persona, so it holds read_open for
// its Reads, a Read's id given to graph_show says to open it there, and
// chat_send, which the persona names, is told withheld where no room is.
test("a stranger's helper opens its Reads, graph_show on one points to read_open, and chat_send says why it is not held", async () => {
  let read = short(derivedEid('operator-persona|work'))
  let steps = [
    { name: 'tool_load', args: { names: ['chat_send'] } },
    { name: 'graph_show', args: { id: read } },
    { name: 'read_open', args: { read } },
  ]
  let seen: Request[] = []
  let helper = operating(store, env, {
    ...operatorModel((req) => {
      seen.push(req)
      let step = steps.shift()
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: step
          ? [{
            kind: 'call',
            id: crypto.randomUUID(),
            name: step.name,
            args: JSON.stringify(step.args),
          }]
          : [{ kind: 'assistant', text: 'Done.' }],
      })
    }),
    name: 'claude-sonnet-5-5',
  })
  await helper.ask({ person: crypto.randomUUID() }, space, { say: 'Hi' }, {})
  await drain(store)
  assert(seen[0].tools.some((t) => t.name == 'read_open'))
  let told = JSON.stringify(seen.at(-1)!.items)
  assertStringIncludes(
    told,
    `${read} is one of your Reads: open it with read_open`,
  )
  assertStringIncludes(told, `# ${read} Working in the apps`)
  assertStringIncludes(
    told,
    'chat_send is not held in this turn: nobody addressed you in a chat room',
  )
})
