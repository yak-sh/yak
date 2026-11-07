import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { directoryOf, META } from './directory.ts'
import { platform } from './testing.ts'
import type { Env } from './env.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive } from './operator-channels.ts'

// The platform admin's Operator reads the platform; nobody else's does
// (T-146331). Each person asks their own Operator in their own space; the
// admin's reads another space's budget.
// The platform tracker: no bug open, none resolved, and every read it is
// asked kept.
let reads: URL[] = []
let p = platform('operator-admin', {
  TRACKER_SECRET: 'tracker-secret',
  TRACKER: {
    fetch: (req: globalThis.Request) => {
      reads.push(new URL(req.url))
      return Promise.resolve(Response.json([]))
    },
  } as unknown as Env['TRACKER'],
})
let dir = directoryOf(p.env.STORE)
let [jeff, ada] = [0, 0].map(() => crypto.randomUUID())
let as = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })
let mine = await dir.mint(jeff, 'jeffs', 'Jeff', as(jeff))
let hers = await dir.mint(ada, 'adas', 'Ada', as(ada))
await dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: {
      person: jeff,
      space: (await dir.space(META.space))!.eid,
      role: 'owner',
    },
  }],
}, { ...as(jeff), 'x-yak-kernel': '1' })

let asked: Request[] = []
let said = (text: string): Item[] => [{ kind: 'assistant', text }]
let store = operatorMemory()
let operator = operating(
  store,
  p.env,
  operatorModel((req) => {
    asked.push(req)
    let results = req.items.filter((i) => i.kind == 'result').length
    let next = req.tools.some((t) => t.name == 'admin_budget')
      ? [['admin_budget', { space: 'adas' }], ['admin_errors', {}]][results]
      : undefined
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: next
        ? [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: next[0] as string,
          args: JSON.stringify(next[1]),
        }]
        : said('Done.'),
      cost: 0.001,
    })
  }),
)
handleChannels(operator, p.env)
// Each person's requests to the model, asked in turn.
let ask = async (person: string, space: string) => {
  let from = asked.length
  await receive(store, { space, person, channel: 'chat' }, "What's adas spent?")
  await drain(store)
  return asked.slice(from)
}
let [admins, theirs] = [await ask(jeff, mine), await ask(ada, hers)]
let ADMIN = [
  'admin_budget',
  'admin_errors',
  'admin_fee',
  'bug_list',
  'bug_show',
]
let offered = (requests: Request[]) =>
  [
    ...new Set(
      requests.flatMap((r) => r.tools.map((t) => t.name))
        .filter((n) => ADMIN.includes(n) || n.startsWith('admin_')),
    ),
  ].sort()

test("the platform admin's Operator is offered the platform's reads, and only reads", () => {
  assertEquals(offered(admins), ADMIN)
})

test("another person's Operator is offered none of them", () => {
  assertEquals(theirs.length > 0, true)
  assertEquals(offered(theirs), [])
})

let outputs = admins.at(-1)!.items.flatMap((i) =>
  i.kind == 'result' ? [String(i.output)] : []
)

test("the admin's Operator reads any space's budget", () => {
  assertMatch(
    outputs[0],
    /^adas: \$\d+\.\d\d a month \(its plan's\)\nspent {4}\$0\.00 this month/,
  )
})

test("the admin's Operator reads the platform tracker's bugs", () => {
  assertMatch(outputs[1], /^Tracker: 0 unresolved bugs/)
  assertEquals(
    reads.map((u) => [u.pathname, u.searchParams.get('scope')]),
    [['/bugs', 'platform'], ['/bugs', 'platform']],
  )
})
