import { line } from '@yaks/query'
import { short } from '@yaks/id'
import { test, until } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { declared } from './directory-fixture.ts'
import { stores } from './app-store-probe.ts'
import { appDoc, appVocab } from './vocab.ts'
import { TOOLS } from './tools.ts'
import { reaching } from './agent.ts'
import { inReach } from './declared.ts'
import { callable, operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { heard, ownCommits, uncadenced } from './operator-schedules.ts'
import { SOON } from '@yaks/wake'
import { operatorContext } from './operator.ts'
import { seatsAs } from './people.ts'

// A person asks their Operator to tell them when something in the space
// changes: it subscribes to a query, a wake that watches it (@yaks/wake
// `watch`) with no cadence. A commit it reads stirs it (`heard`), each look
// that finds the rows changed is one turn in their conversation with what
// changed, and a look that finds nothing new is no turn at all (T-145073,
// T-164109, T-2346). That an app tells the Operator of its commits is
// borrowed_test.ts's.
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
// Matt, an editor of the space, who asked to hear once his role changes.
let matt = crypto.randomUUID(), seat = crypto.randomUUID()
await dir.apply({
  entities: [
    { entity: { eid: matt }, person: {}, email: { address: 'matt@x.test' } },
    {
      entity: { eid: seat },
      member: { person: matt, space: eid, role: 'editor' },
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
let subject = 'Notices: a budget hearing was added'
// The tools each turn was offered, by the words that began it.
let offered = new Map<string, string[]>()
let script: Record<string, [string, unknown]> = {
  'Tell me about meetings': ['subscription_set', {
    say: 'Tell them which meetings changed.',
    query: '.meeting&*',
  }],
  'Watch my chats': ['subscription_set', {
    say: 'Note what they said.',
    query: '.operator_request.channel=chat',
    mine: true,
  }],
  'Watch the meetings graph_query answers': ['subscription_set', {
    say: 'The meetings answer moved.',
    tool: 'graph_query',
    args: { q: '.meeting&*' },
  }],
  'Watch my open tasks': ['subscription_set', {
    say: 'An open task moved.',
    tool: 'task_list',
    args: {},
  }],
  'Watch my apps': ['subscription_set', {
    say: 'Apps moved.',
    tool: 'app_list',
    args: {},
  }],
  'Watch a branch': ['subscription_set', {
    say: 'The branch moved.',
    tool: 'graph_query',
    args: { q: '.meeting', branch: 2 },
  }],
  'Who is in the space?': ['member_list', {}],
  "Tell me when Matt's role changes": ['subscription_set', {
    say: "Tell them Matt's role changed.",
    tool: 'member_list',
    args: { person: matt },
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
    offered.set(words, callable(req))
    let cancel = words.match(/Cancel (\S+)/)?.[1]
    let items = last?.kind == 'result'
      ? (results.push(last.output), reply('Done.'))
      : words.includes('Tell them which meetings changed.')
      ? call('notification_send', {
        subject,
        text: 'The budget hearing is new.',
      })
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
// An app told the Operator of a commit (build.ts `HEARD`), a beat ago, so
// the store's alarm comes to each subscription over the space now.
let look = async () => {
  await heard(store, false, Date.now() - SOON)
  await service.drain()
}

await ask('Tell me about meetings')
let [sub] = await store.g.read('.watch.query=".meeting&*" &*')
let first = (sub.watch as { seen: Record<string, string> }).seen
// Nothing changed since it subscribed: a look is no turn.
await look()
let quiet = (await fired()).length
// A meeting arrives and another changes: one turn says both.
let hearing = await meeting('Budget hearing: Monday at 6')
await meeting('Road millage: Thursday at 8', road)
await look()
let [request] = await fired()
let [told] = await store.g.read(
  line`.notification.to=${person}&.doc.title=${subject}&*`,
)
// The change is now what it saw, so the next look is quiet again.
await look()
let after = (await fired()).length
let [rested] = await store.g.get([sub.entity.eid])

await ask('Watch my chats')
// The store's own commits stir the subscriptions over it, and a write of
// wakes alone, as a look writes, stirs none.
let stirs = 0
store.g.use(ownCommits(() => stirs++))
let [mine] = await store.g.read('.watch.local=true')
await store.g.apply([{ entity: sub.entity, wake: { at: null } }], {
  trusted: true,
})
let wakesAlone = stirs
await receive(store, { space: eid, person, channel: 'chat' }, 'Hi')
let chatted = stirs
let stirredAt = await heard(store, true)
let [stirred] = await store.g.get([mine.entity.eid])
await ask('What am I subscribed to?')
let listed = JSON.parse(results.at(-1)!.split('\n')[1])
await ask('What wake-ups do I have?')
let wakes = JSON.parse(results.at(-1)!.split('\n')[1])
await ask(`Cancel ${short(mine.entity.eid)}`)
let gone = await store.g.get([mine.entity.eid])

// A reading tool's answer, subscribed to by name and args: its declared
// query is watched live, over the space or the Operator's own store as the
// tool reads.
let firedFor = async (sub: { entity: { eid: string } }) =>
  (await fired()).filter((r) =>
    (r.operator_request as { about?: string }).about == sub.entity.eid
  )
await ask('Watch the meetings graph_query answers')
let [byQuery] = await store.g.read('.watch.tool=graph_query&*')
await meeting('Parks board: Friday at 5')
await look()
let [queried] = await firedFor(byQuery)
await ask('Watch my open tasks')
let [byTasks] = await store.g.read('.watch.tool=task_list&*')
await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  task: { status: 'open' },
  doc: { title: 'Call the clerk' },
}], { trusted: true })
await heard(store, true, Date.now() - SOON)
await service.drain()
let [tasked] = await firedFor(byTasks)
await ask('Watch my apps')
let appsRefused = results.at(-1)!
await ask('Watch a branch')
let branchRefused = results.at(-1)!

// The space's seats, read and watched as the person reads them: the
// directory tells the Operator of each seat written in the space
// (facets/directory-graph.ts `seatsHeard`).
await ask('Who is in the space?')
let members = JSON.parse(results.at(-1)!.split('\n')[1])
let mattSees = await seatsAs(dir, space, matt, 'editor')
await ask("Tell me when Matt's role changes")
let [bySeat] = await store.g.read('.watch.tool=member_list&*')
await dir.apply({
  entities: [{ entity: { eid: seat }, member: { role: 'owner' } }],
}, owner)
await until(async () =>
  !!((await store.g.get([bySeat.entity.eid]))[0].wake as { at?: string }).at
)
await look()
let [promoted] = await firedFor(bySeat)

test('subscription_set reads the query as the person, and what it answers now is no change', () => {
  assertEquals(Object.keys(first), [road])
  assertEquals((sub.wake as { every?: string }).every, undefined)
  let { for: by, note } = sub.wake as { for: string; note: string }
  assertEquals([by, note], [person, 'Tell them which meetings changed.'])
  assertEquals(quiet, 0)
})

test("a change in the query's rows is one turn with what changed, which tells them in their Updates", () => {
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
  assertEquals((rested.wake as { at?: string }).at ?? null, null)
})

test("a commit in the Operator's own store stirs its subscriptions over it, a look's own write none", () => {
  assertEquals([wakesAlone, chatted > 0], [0, true])
  assertEquals(
    (stirred.wake as { at: string }).at,
    new Date(stirredAt!).toISOString(),
  )
})

test('a subscription kept on a cadence is taken off it and looks now', async () => {
  let entity = { eid: crypto.randomUUID() }
  let later = new Date(Date.now() + 3_600_000).toISOString()
  await store.g.apply([{
    entity,
    wake: { for: person, at: later, every: '1m' },
    watch: { query: '.meeting' },
  }], { trusted: true })
  assertEquals(await uncadenced(store), false)
  let [moved] = await store.g.get([entity.eid])
  let wake = moved.wake as { every?: string; at: string }
  assertEquals([wake.every ?? null, Date.parse(wake.at) <= Date.now()], [
    null,
    true,
  ])
})

test("a subscription's turn holds its reads and the person's own alerts, never a door that takes the rows past them", () => {
  let by = (said: string) => [...offered].find(([w]) => w.includes(said))![1]
  let asked = by('Tell me about meetings'), seen = by('Budget hearing')
  for (
    let door of [
      'mail_send',
      'phone_send',
      'graph_apply',
      'app_deploy',
      'code_mode',
      'memory_save',
      'subscription_set',
      'fork',
    ]
  ) {
    assertEquals(
      [asked.includes(door), seen.includes(door)],
      [true, false],
      door,
    )
  }
  for (let kept of ['notification_send', 'text_send', 'graph_query']) {
    assertEquals(seen.includes(kept), true, kept)
  }
})

test('subscription_list shows each subscription, wake_list leaves them out, and subscription_cancel ends one', () => {
  assertEquals(listed.length, 2)
  let chats = listed.find((s: { mine?: boolean }) => s.mine)
  assertEquals(chats.query, '.operator_request.channel=chat')
  assertEquals(chats.rows > 0, true)
  assertEquals(wakes, [])
  assertEquals(gone.filter((b) => b && !b.tombstone).length, 0)
})

test("subscription_set watches a reading tool's declared query, over the space or its own store as the tool reads", () => {
  let watch = byQuery.watch as Record<string, unknown>
  assertEquals([watch.query, watch.local ?? null], ['.meeting&*', null])
  assertEquals(watch.args, { q: '.meeting&*' })
  let said = JSON.stringify(queried)
  assertStringIncludes(said, 'graph_query')
  assertStringIncludes(said, 'answers differently now')
  assertStringIncludes(said, 'Parks board')
  assertEquals((byTasks.watch as { local?: boolean }).local, true)
  assertStringIncludes(JSON.stringify(tasked), 'Call the clerk')
})

test('a tool whose answer is no store query is refused, and so is an argument its query has no part for', () => {
  assertStringIncludes(appsRefused, 'app_list is not subscribable')
  assertStringIncludes(branchRefused, 'branch plays no part in')
})

test('member_list says who is in the space as the person reads it: an owner every seat, anyone else their own', () => {
  let seen = (rows: { member: { person: { eid: string }; role: string } }[]) =>
    rows.map((r) => [r.member.person.eid, r.member.role]).sort()
  assertEquals(seen(members), [[matt, 'editor'], [person, 'owner']].sort())
  assertEquals(seen(mattSees as never), [[matt, 'editor']])
})

test('a subscription to member_list hears a role change in the directory within seconds', () => {
  assertEquals((bySeat.watch as { over?: string }).over, 'members')
  let said = JSON.stringify(promoted)
  assertStringIncludes(said, 'member_list')
  assertStringIncludes(said, 'owner')
})
