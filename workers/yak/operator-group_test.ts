// A group text to a space's number (T-1713): everyone in it is heard in the
// group's one conversation, each line kept as its writer's; a turn there has
// only what the space lets anyone do, whoever in it is a member; the
// Operator answers the group, and an answer of PASS sends nothing.
import { equal, ok, test } from '@yaks/testing'
import type { Item, Request as ModelRequest } from '@yaks/model'
import type { Arrival } from '@yaks/phone'
import { PASS } from '@yaks/session/turn'
import { platform } from './directory-rows-probe.ts'
import { operating } from './operator.ts'
import { handleChannels, type Request } from './operator-channels.ts'
import { callable, operatorMemory, operatorModel } from './operator-testing.ts'
import { operatorReply, operatorRequest } from './operator-host.ts'
import { spaceArrived } from './operator-signup.ts'
import { drain } from './operator-store.ts'

let { env, dir } = platform('group-operator')
let spaceId = crypto.randomUUID(), member = crypto.randomUUID()
let OURS = '+12695550111', ANN = '+12695550100', BO = '+12695550142'
await dir.apply({
  entities: [
    { entity: { eid: member }, person: {}, phone: { number: ANN } },
    { entity: { eid: spaceId }, space: { slug: 'church', store: 'church' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: member, space: spaceId, role: 'owner' },
    },
  ],
}, { 'x-yak-person': member, 'x-yak-role': 'owner' })
let space = (await dir.at(spaceId))!
let store = operatorMemory()
let seen: ModelRequest[] = [], sent: Request[] = []
let script: Item[][] = [
  [{ kind: 'assistant', text: 'The potluck is Sunday at noon.' }],
  [{ kind: 'assistant', text: PASS }],
]
let operator = operating(store, env, {
  directory: () => dir,
  tools: () => [{
    name: 'unrelated',
    description: 'Private member tool',
    parameters: {},
    run: () => 'private',
  }],
  ...operatorModel((req) => {
    seen.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: script.shift()!,
    })
  }),
})
handleChannels(operator, env, {
  group: (request) => (sent.push(request), Promise.resolve({})),
})
env.BUILDER = {
  idFromName: (name) => name,
  get: () => ({
    fetch: async (req: globalThis.Request) => {
      let path = new URL(req.url).pathname
      let person = req.headers.get('x-yak-person')!
      return req.headers.get('x-yak-kernel') == '1'
        ? await operatorReply(
          operator,
          spaceId,
          path,
          await req.json(),
          () => {},
          person,
        )
        : (await operatorRequest(
          operator,
          { person, space: spaceId, role: null },
          path,
          await req.json(),
          () => {},
        ))!
    },
  }),
}
let said = (from: string, text: string): Arrival & { via: string } => ({
  id: crypto.randomUUID(),
  from,
  to: OURS,
  group: [ANN, BO].filter((n) => n != from),
  text,
  at: '2026-11-20T12:00:00Z',
  rcs: false,
  media: [],
  via: 'telnyx',
})
await spaceArrived(env, space, said(ANN, 'Operator, when is the potluck?'))
await drain(store)
await spaceArrived(env, space, said(BO, "I'll bring pie"))
await drain(store)
let stranger = (await dir.phoned(BO))!
let requests = (await store.g.read('.operator_request'))
  .map((b) => b.operator_request as Request & { session: string })
let inputs = await store.g.read(
  '.entry.session &.content !output .order=entry.seq .fields=created.by',
)

test("everyone in a group text is heard in the group's one conversation, each line kept as its writer's", () => {
  equal(requests.map((r) => r.channel), ['group', 'group'])
  equal(new Set(requests.map((r) => r.session)).size, 1)
  equal(new Set(requests.map((r) => r.person)).size, 1)
  ok(![member, stranger].includes(requests[0].person))
  equal(requests.map((r) => r.writer), [member, stranger])
  equal(
    inputs.map((b) => (b.created as { by?: string } | undefined)?.by ?? ''),
    [member, stranger],
  )
})

test('the Operator is told who wrote each line, and whether it was said to it', () => {
  let words = seen.map((r) => JSON.stringify(r.items))
  ok(words[0].includes(`By group text with ${BO}.`))
  ok(words[0].includes(`From ${ANN}: Operator, when is the potluck?`))
  ok(!words[0].includes('not said to you'))
  ok(words[1].includes('not said to you'))
  ok(words[1].includes(`From ${BO}: I'll bring pie`))
})

test("a member's words in a group give the turn only what the space lets anyone do", () => {
  ok(!callable(seen[0]).includes('unrelated'))
  ok(!callable(seen[0]).includes('mail_send'))
})

test('the Operator answers the group once, and an answer of PASS sends nothing', () => {
  equal(sent.length, 1)
  equal(sent[0].group, [BO])
  equal(sent[0].address, ANN)
})
