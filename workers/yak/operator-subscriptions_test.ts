import { short } from '@yaks/id'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item } from '@yaks/model'
import type { Bundle } from '@yaks/graph'
import { platform } from './directory-rows-probe.ts'
import { declared } from './directory-fixture.ts'
import { stores } from './app-store-probe.ts'
import { appDoc, appVocab } from './vocab.ts'
import { TOOLS } from './tools.ts'
import { reaching } from './agent.ts'
import { inReach } from './declared.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { operatorContext } from './operator.ts'

// A person asks their Operator to tell them when something in the space
// changes: it subscribes to a query, each look that finds the rows changed is
// one turn in their conversation with what changed, and a look that finds
// nothing new is no turn at all (T-145073).
let p = platform('operator-subscriptions')
let { dir, env } = p
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {} },
    { entity: { eid }, space: { slug: 'clerk', store: 'clerk' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)
let space = (await dir.at(eid))!
let held = { person, role: 'owner' as const, space: eid }
let ctx = await operatorContext(env, held, space, () => dir)
let words = {
  $defs: { meeting: { properties: { title: { type: 'string' } } } },
}
await TOOLS.find((t) => t.name == 'app_new')!.run(ctx, {
  slug: 'notices',
  title: 'Notices',
})
let app = (await dir.app(space, 'notices'))!
await dir.apply({
  entities: [{ entity: { eid: app.eid }, app: { version: 1 } }],
}, owner)
app = (await dir.app(space, 'notices'))!
await declared(env, space, app, { vocab: appDoc(words), tools: {} })
stores(env, appVocab(words))
let notices = await reaching(ctx, await inReach(ctx))
let meeting = async (title: string, id = crypto.randomUUID()) => {
  await notices.apply([{ entity: { eid: id }, meeting: { title } }])
  return id
}
let road = await meeting('Road millage: Thursday at 7')

let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let results: string[] = []
let script: Record<string, [string, unknown]> = {
  'Tell me about meetings': ['subscription_set', {
    say: 'Tell them which meetings changed.',
    query: '.meeting&*',
  }],
  'Watch my chats': ['subscription_set', {
    say: 'Note what they said.',
    query: '.operator_request.channel=chat',
    mine: true,
    every: '1h',
  }],
  'Watch every few seconds': ['subscription_set', {
    say: 'Look.',
    query: '.meeting',
    every: '10s',
  }],
  'What am I subscribed to?': ['subscription_list', {}],
  'What wake-ups do I have?': ['wake_list', {}],
}
let service = operatorService(env, held, {
  directory: () => dir,
  ...operatorModel((req) => {
    let last = req.items.at(-1)
    let said = req.items.findLast((i) => i.kind == 'user')
    let words = said?.kind == 'user' ? said.text : ''
    let planned = Object.entries(script).find(([w]) => words.includes(w))?.[1]
    let cancel = words.match(/Cancel (#\w+)/)?.[1]
    let items = last?.kind == 'result'
      ? (results.push(last.output), reply('Done.'))
      : words.includes('Tell them which meetings changed.')
      ? reply('The budget hearing is new.')
      : cancel
      ? call('subscription_cancel', { subscription: cancel })
      : planned
      ? call(...planned)
      : reply('Hello.')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0.001,
    })
  }),
})
env.BUILDER = service.binding
let { store } = service
let ask = async (say: string) => {
  await receive(store, { space: eid, person, channel: 'chat' }, say)
  await service.drain()
}
let fired = () => store.g.read('.operator_request.channel=subscription&*')
// The store's alarm comes to a subscription when its wake is due.
let look = async (sub: Bundle) => {
  await store.g.apply([{
    entity: sub.entity,
    wake: { at: new Date().toISOString() },
  }], { trusted: true })
  await service.drain()
}

await ask('Tell me about meetings')
let [sub] = await store.g.read(
  '.operator_subscription.query=".meeting&*" &* ?wake',
)
let first = (sub.operator_subscription as { seen: Record<string, string> })
  .seen
// Nothing changed since it subscribed: a look is no turn.
await look(sub)
let quiet = (await fired()).length
// A meeting arrives and another changes: one turn says both.
let hearing = await meeting('Budget hearing: Monday at 6')
await meeting('Road millage: Thursday at 8', road)
await look(sub)
let [request] = await fired()
let [told] = await store.g.read(`.deliver.to=${person}&*`)
// The change is now what it saw, so the next look is quiet again.
await look(sub)
let after = (await fired()).length

await ask('Watch my chats')
await ask('Watch every few seconds')
let refused = results.at(-1)!
await ask('What am I subscribed to?')
let listed = JSON.parse(results.at(-1)!.split('\n')[0])
await ask('What wake-ups do I have?')
let wakes = JSON.parse(results.at(-1)!.split('\n')[0])
let [mine] = await store.g.read('.operator_subscription.mine=true')
await ask(`Cancel ${short(mine.entity.eid)}`)
let gone = await store.g.get([mine.entity.eid])

test('subscription_set reads the query as the person, and what it answers now is no change', () => {
  assertEquals(Object.keys(first), [road])
  assertEquals((sub.wake as { every: string }).every, '1m')
  assertEquals(sub.operator_ask, {
    space: eid,
    person,
    say: 'Tell them which meetings changed.',
  })
  assertEquals(quiet, 0)
})

test("a change in the query's rows is one turn with what changed, answered in their Updates", () => {
  let asking = request.operator_request as Record<string, unknown>
  assertEquals(asking.person, person)
  assertEquals(asking.about, sub.entity.eid)
  let said = JSON.stringify(request)
  assertStringIncludes(said, 'What changed (1 new, 1 changed)')
  assertStringIncludes(said, 'Budget hearing')
  assertStringIncludes(said, 'Thursday at 8')
  assertStringIncludes(said, hearing)
  assertEquals(
    (told.doc as { body: string }).body,
    'The budget hearing is new.',
  )
  assertEquals(after, 1)
})

test('subscription_list shows each subscription, wake_list leaves them out, and subscription_cancel ends one', () => {
  assertStringIncludes(refused, 'a minute apart')
  assertEquals(listed.length, 2)
  let chats = listed.find((s: { mine?: boolean }) => s.mine)
  assertEquals(chats.every, '1h')
  assertEquals(chats.query, '.operator_request.channel=chat')
  assertEquals(chats.rows > 0, true)
  assertEquals(wakes, [])
  assertEquals(gone.filter((b) => b && !b.tombstone).length, 0)
})
