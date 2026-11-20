// A group text to a space's number (T-1713): everyone in it is heard in the
// group's one conversation, each line kept as its writer's; a turn there has
// only what the space lets anyone do, whoever in it is a member; and an
// answer of PASS sends nothing. The answer goes to the whole group only when
// everyone in it agreed to texts and none replied STOP to the number; any
// other group is answered to its sender alone (T-1854).
import { equal, ok, test } from '@yaks/testing'
import type { Item, Request as ModelRequest } from '@yaks/model'
import type { Arrival } from '@yaks/phone'
import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'
import { PASS } from '@yaks/session/turn'
import { platform } from './directory-rows-probe.ts'
import { endpoints } from './endpoints.ts'
import { operating } from './operator.ts'
import { handleChannels, type Request } from './operator-channels.ts'
import { callable, operatorMemory, operatorModel } from './operator-testing.ts'
import { operatorReply, operatorRequest } from './operator-host.ts'
import { spaceArrived, textControl } from './operator-signup.ts'
import { drain } from './operator-store.ts'
import { texts } from './operator-texts.ts'
import { costOf } from './text-spend.ts'

let { env, dir } = platform('group-operator')
let spaceId = crypto.randomUUID(), member = crypto.randomUUID()
let OURS = '+12695550111', ANN = '+12695550100', BO = '+12695550142'
// DEE and CY agreed to texts, and CY then replied STOP to the space's
// number; EVE never agreed.
let DEE = '+12695550143', CY = '+12695550144', EVE = '+12695550145'
let agreed = async (person: string, number: string) =>
  await dir.apply(
    { entities: texts(person, number, true) },
    { 'x-yak-person': person },
  )
await dir.apply({
  entities: [
    { entity: { eid: member }, person: {}, phone: { number: ANN } },
    {
      entity: { eid: spaceId },
      space: { slug: 'church', store: 'church' },
      phone: { number: OURS },
      sender: { via: 'telnyx' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: member, space: spaceId, role: 'owner' },
    },
  ],
}, { 'x-yak-person': member, 'x-yak-role': 'owner' })
await agreed(member, ANN)
for (let number of [DEE, CY]) {
  let person = crypto.randomUUID()
  await dir.apply({
    entities: [{ entity: { eid: person }, person: {}, phone: { number } }],
  }, { 'x-yak-person': person })
  await agreed(person, number)
}
let space = (await dir.at(spaceId))!

// The provider, in process: what it was asked to send, to whom.
let sent: { to: string[]; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({ data: [{ phone_number: OURS }] })
  }
  let body = await req.json()
  sent.push({ to: [body.to].flat(), text: body.text })
  return Response.json({ data: { id: `msg-${sent.length}` } })
})
Object.assign(env, {
  PHONE_SENDER: { via: 'telnyx' },
  TELNYX_API: telnyx.url,
  TELNYX_API_KEY: 'test-only',
})

let store = operatorMemory()
let seen: ModelRequest[] = []
let script: Item[][] = [
  [{ kind: 'assistant', text: 'The potluck is Sunday at noon.' }],
  [{ kind: 'assistant', text: PASS }],
  [{ kind: 'assistant', text: 'Park behind the hall.' }],
  [{ kind: 'assistant', text: 'We meet at 12 Elm St.' }],
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
handleChannels(operator, env)
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
let arrival = (from: string, text: string, group: string[] = []) =>
  ({
    id: crypto.randomUUID(),
    from,
    to: OURS,
    ...(group.length ? { group } : {}),
    text,
    at: '2026-11-20T12:00:00Z',
    rcs: false,
    media: [],
    via: 'telnyx',
  }) as Arrival & { via: string }
let heard: string[] = []
let said = async (from: string, text: string, group: string[]) => {
  heard.push(text)
  await spaceArrived(env, space, arrival(from, text, group))
  await drain(store)
}
await store.g.apply(textControl(arrival(CY, 'STOP')), { trusted: true })
let spentBefore = (await dir.at(spaceId))!
await said(ANN, 'Operator, when is the potluck?', [BO])
await said(BO, "I'll bring pie", [ANN])
await said(ANN, 'Operator, where do we park?', [DEE])
await said(BO, "Operator, what's the address?", [EVE, CY])
await telnyx.stop()
let stranger = (await dir.phoned(BO))!
// In the order they were said.
let bodyOf = (b: Bundle) => String((b.doc as { body?: string }).body)
let requests =
  (await store.g.read('.operator_request .fields=operator_request,doc'))
    .sort((a, b) => heard.indexOf(bodyOf(a)) - heard.indexOf(bodyOf(b)))
    .map((b) => b.operator_request as Request & { session: string })
let inputs = await store.g.read(
  line`.entry.session=${
    requests[0].session
  } &.content !output .order=entry.seq .fields=created.by`,
)
let words = seen.map((r) => JSON.stringify(r.items))

test("everyone in a group text is heard in the group's one conversation, each line kept as its writer's", () => {
  equal(requests.map((r) => r.channel), ['group', 'group', 'group', 'group'])
  let first = requests.slice(0, 2)
  equal(new Set(first.map((r) => r.session)).size, 1)
  equal(new Set(first.map((r) => r.person)).size, 1)
  ok(![member, stranger].includes(first[0].person))
  equal(first.map((r) => r.writer), [member, stranger])
  equal(
    inputs.map((b) => (b.created as { by?: string } | undefined)?.by ?? ''),
    [member, stranger],
  )
})

test('the Operator is told who wrote each line, and whether it was said to it', () => {
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

test('a group is answered whole only when everyone in it agreed to texts from the number and none replied STOP; any other, to its sender alone', () => {
  equal(sent.map((s) => s.to), [[ANN], [ANN, DEE], [BO]])
  equal(sent.map((s) => s.text.split('\n')[0]), [
    'The potluck is Sunday at noon.',
    'Park behind the hall.',
    'We meet at 12 Elm St.',
  ])
})

test('the Operator is told who in a group has not agreed, so it can say why its answer goes to the sender alone', () => {
  ok(words[0].includes(`${BO} has not agreed`))
  ok(!words[2].includes('not agreed'))
  ok(words[3].includes(`${EVE} and ${CY} have not agreed`))
  ok(words[3].includes(`to ${BO} alone`))
})

test("a text to a group is paid from the space's budget once for each number it reaches", async () => {
  let spend = (s: typeof space) => s.meter?.texts ?? 0
  let paid = spend((await dir.at(spaceId))!) - spend(spentBefore)
  let cost = heard.map(costOf).reduce((a, b) => a + b) +
    sent.map((s) => costOf(s.text) * s.to.length).reduce((a, b) => a + b)
  equal(+paid.toFixed(6), +cost.toFixed(6))
})
