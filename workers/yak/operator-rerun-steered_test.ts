import { line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Item, ModelError } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive, type Request } from './operator-channels.ts'
import { rerun } from './operator-rerun.ts'
import { present } from './whereabouts.ts'
import { within } from './defects.ts'

// A conversation a yaks.app bug stopped, taken up again once it is fixed,
// keeps whatever made its stopped words ask for a tap (T-3464): how they
// came (relayed, by a number alone, or heard as a subscription's) and what
// it heard. The person's own ask still finishes with no tap (T-3155).
let { env } = platform('operator-rerun-steered')
env.ERRORS = { send: () => Promise.resolve() }
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let NUMBER = '+12695550142'
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

// While `broken`, every turn stops on a yaks.app bug; once fixed, the turn
// adds whoever the words it carries on named.
let broken = true
let service = operatorService(
  env,
  { person, role: 'owner', space: eid },
  operatorModel((req) => {
    if (broken) throw new ModelError('claude_tool', 'an unoffered tool')
    let said = req.items.findLast((i) =>
      i.kind == 'user' && / as owner/.test(i.text)
    )
    let who = said?.kind == 'user' && said.text.match(/(\w+) as owner/)?.[1]
    let items: Item[] = req.items.at(-1)?.kind == 'result' || !who
      ? [{ kind: 'assistant', text: 'Done.' }]
      : [{
        kind: 'call',
        id: crypto.randomUUID(),
        name: 'member_add',
        args: JSON.stringify({ email: `${who}@x.example`, role: 'owner' }),
      }]
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
await present(env, { person, channel: 'operator', place: eid, state: 'here' })

// Words on `came` stop on a bug, which is then fixed: what came of them.
// `after`, someone else's words written into the person's conversation
// once the turn has begun, as in a room heard in full.
let reran = async (
  came: Partial<Request>,
  who: string,
  heard = false,
  after?: Partial<Request>,
) => {
  broken = true
  let before = new Set(
    (await store.g.read('.stalled')).map((b) => b.entity.eid),
  )
  await within(env, {}, async () => {
    await receive(
      store,
      { space: eid, person, channel: 'chat', ...came },
      `Please add ${who} as owner`,
      { heard },
    )
    if (after) {
      await service.drain()
      await receive(
        store,
        { space: eid, person, channel: 'chat', ...after },
        `Please add ${who} as owner`,
      )
    }
    await service.drain()
  })
  let [stall] = (await store.g.read(line`.stalled .fields=stalled.fault`))
    .filter((b) => !before.has(b.entity.eid))
  broken = false
  await rerun(store, eid, {
    faults: [String((stall.stalled as Comp).fault)],
    bug: crypto.randomUUID(),
  })
  await service.drain()
  let approval = (await store.g.read('.operator_approval&*')).find((b) =>
    JSON.stringify(b.operator_approval).includes(`${who}@x.example`)
  )?.operator_approval as Comp | undefined
  let ran = (await store.g.read('.output&*')).some((b: Bundle) =>
    JSON.stringify(b.content).includes(`${who}@x.example is invited`)
  )
  return ran
    ? 'ran'
    : approval
    ? `asked${approval.number ? ` by text to ${approval.number}` : ''}`
    : 'neither'
}

let cases: [
  string,
  Partial<Request>,
  string,
  boolean,
  string,
  Partial<Request>?,
][] = [
  ['the person asks in their chat', {}, 'ann', false, 'ran'],
  [
    'their machine relays an ask',
    { channel: 'machine' },
    'bob',
    false,
    'asked',
  ],
  ['the turn heard words not theirs', {}, 'cat', true, 'asked'],
  [
    'someone texts showing their number',
    { channel: 'text', address: NUMBER },
    'dan',
    false,
    `asked by text to ${NUMBER}`,
  ],
  [
    "a subscription's words, whose turn holds only reads",
    { channel: 'subscription' },
    'eve',
    false,
    'neither',
  ],
  [
    "someone else's words land after the person's turn heard others'",
    {},
    'fay',
    true,
    'asked',
    { writer: crypto.randomUUID() },
  ],
]
let outcomes: [string, string][] = []
for (let [why, came, who, heard, , after] of cases) {
  outcomes.push([why, await reran(came, who, heard, after)])
}

test('a rerun after a fixed bug asks for the tap its stopped words would have', () => {
  assertEquals(outcomes, cases.map(([why, , , , want]) => [why, want]))
})
