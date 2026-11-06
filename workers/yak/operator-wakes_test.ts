import { short } from '@yaks/id'
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { fire, receive, rootOf } from './operator-channels.ts'
import { drain } from './operator-store.ts'

// A person asks their Operator to come back to something: it sets a wake-up
// in its own store, the store's alarm fires it, and the firing is a turn in
// their conversation whose answer reaches their Updates (T-145054).
let { env } = platform('operator-wakes')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    { entity: { eid: person }, person: {}, doc: { title: 'Jeff Peterson' } },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)
let held = { person, role: 'owner' as const, space: eid }

let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let asked: Request[] = []
let results: string[] = []
// The person's words name the tool call the model makes for them.
let script: Record<string, [string, unknown]> = {
  'Remind me in ten minutes to call Mom': ['wake_set', {
    say: 'Remind them to call Mom.',
    at: '10m',
  }],
  'Check my mail every morning': ['wake_set', {
    say: 'Read their mail and tell them what needs them.',
    every: '0 9 * * * America/Detroit',
  }],
  'What wake-ups do I have?': ['wake_list', {}],
}
let service = operatorService(
  env,
  held,
  operatorModel((req) => {
    asked.push(req)
    let last = req.items.at(-1)
    let said = req.items.findLast((i) => i.kind == 'user')
    let words = said?.kind == 'user' ? said.text : ''
    let planned = Object.entries(script).find(([w]) => words.includes(w))?.[1]
    let cancel = words.match(/Cancel (#\w+)/)?.[1]
    let items = last?.kind == 'result'
      ? (results.push(last.output), reply('Done.'))
      : words.includes('Remind them to call Mom.')
      ? reply('Time to call Mom.')
      : cancel
      ? call('wake_cancel', { wake: cancel })
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
)
env.BUILDER = service.binding
let { store } = service
let ask = async (say: string) => {
  await receive(store, { space: eid, person, channel: 'chat' }, say)
  await service.drain()
}

await ask('Remind me in ten minutes to call Mom')
let [set] = await store.g.read(`.operator_ask.person=${person}&*`)
let wake = set.wake as { at: string }
let inTen = Date.parse(wake.at) - Date.now()

// Ten minutes on: the row is due, and the store's alarm drains it.
let next = await drain(store)
let early = (await store.g.read('.operator_request.channel=wake')).length
await store.g.apply([{
  entity: set.entity,
  wake: { at: new Date().toISOString() },
}], {
  trusted: true,
})
await service.drain()
let [request] = await store.g.read('.operator_request.channel=wake')
let [told] = await store.g.read(`.deliver.to=${person}&*`)
let [fired] = await store.g.get([set.entity.eid])
// A second driver, or a replay, gives the same firing again to no effect.
await fire(store, fired, 'wake', (fired.fired as { at: string }).at)
await service.drain()
let again = (await store.g.read('.operator_request.channel=wake')).length

await ask('Check my mail every morning')
await ask('What wake-ups do I have?')
let listed = JSON.parse(results.at(-1)!.split('\n')[0])
let [daily] = await store.g.read(`.operator_ask.person=${person} .wake.every`)
await ask(`Cancel ${short(daily.entity.eid)}`)
let gone = await store.g.get([daily.entity.eid])

test('wake_set keeps a one-shot in ten minutes, as the person, and the alarm comes back for it', () => {
  assertEquals(Math.abs(inTen - 10 * 60_000) < 5000, true)
  assertEquals(set.operator_ask, {
    space: eid,
    person,
    say: 'Remind them to call Mom.',
  })
  assertEquals(early, 0)
  assertEquals(next, Date.parse(wake.at))
})

test("a firing is the wake-up's words in the person's conversation, and its answer is in their Updates", () => {
  let asking = request.operator_request as Record<string, unknown>
  assertEquals(asking.person, person)
  assertEquals(asking.about, set.entity.eid)
  assertEquals(asking.session, rootOf(eid, person))
  let framed = asked.find((r) =>
    JSON.stringify(r.items).includes(
      `Your wake-up ${short(set.entity.eid)} fired`,
    )
  )
  assertEquals(!!framed, true)
  assertEquals((told.doc as { body: string }).body, 'Time to call Mom.')
  assertEquals((fired.wake as { at?: string }).at, undefined)
  assertEquals(again, 1)
})

test('wake_list shows a cadence and its next time, and wake_cancel ends it', () => {
  let shown = listed.find((w: { every?: string }) => w.every)
  assertEquals(shown.wake, short(daily.entity.eid))
  assertEquals(shown.every, '0 9 * * * America/Detroit')
  assertStringIncludes(shown.say, 'Read their mail')
  assertEquals(
    new Date(shown.at).toLocaleString('en-US', {
      timeZone: 'America/Detroit',
      hour: 'numeric',
      minute: '2-digit',
    }),
    '9:00 AM',
  )
  assertEquals(gone.filter((b) => b && !b.tombstone).length, 0)
})
