import { equal, ok, test } from '@yaks/testing'
import type { Item, Request as ModelRequest } from '@yaks/model'
import type { Arrival } from '@yaks/phone'
import { platform } from './directory-rows-probe.ts'
import { operating } from './operator.ts'
import { handleChannels } from './operator-channels.ts'
import { callable, operatorMemory, operatorModel } from './operator-testing.ts'
import { operatorReply, operatorRequest } from './operator-host.ts'
import {
  signupArrived,
  signupTools,
  spaceArrived,
  textControl,
  textRoute,
  textStopped,
} from './operator-signup.ts'
import { drain } from './operator-store.ts'
import { rootOf } from './operator-root.ts'
import { stores } from './app-store-probe.ts'
import { appVocab } from './vocab.ts'
import { declared } from './directory-fixture.ts'
import type { Env } from './env.ts'
import type { Role } from './directory.ts'

let { env, dir } = platform('signup-operator')
let spaceId = crypto.randomUUID(), member = crypto.randomUUID()
await dir.apply({
  entities: [
    { entity: { eid: member }, person: {}, phone: { number: '+12695550100' } },
    { entity: { eid: spaceId }, space: { slug: 'church', store: 'church' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: member, space: spaceId, role: 'owner' },
    },
  ],
}, { 'x-yak-person': member, 'x-yak-role': 'owner' })
let space = (await dir.at(spaceId))!
let store = operatorMemory()
let seen: ModelRequest[] = [], replies: string[] = [], texts: string[] = []
let script: Item[][] | undefined
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
      items: script?.shift() ??
        [{ kind: 'assistant', text: 'Which form would you like?' }],
    })
  }),
})
handleChannels(operator, env, {
  signup: (_, answer) => {
    replies.push(answer.text)
    return Promise.resolve({})
  },
  text: (request, answer) => {
    texts.push(`${request.address}: ${answer.text}`)
    return Promise.resolve({})
  },
})
env.BUILDER = {
  idFromName: (name) => name,
  get: () => ({
    fetch: async (req: Request) => {
      equal(req.headers.get('x-space-eid'), spaceId)
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
          {
            person,
            space: spaceId,
            role: person == member ? 'owner' : 'viewer',
          },
          path,
          await req.json(),
          () => {},
        ))!
    },
  }),
}
let arrival = (from: string, text = 'KIDS'): Arrival & { via: string } => ({
  id: crypto.randomUUID(),
  from,
  to: '+12695550111',
  text,
  at: '2026-11-08T12:00:00Z',
  rcs: false,
  media: [],
  via: 'voipms',
})
let first = arrival('+12695550142')
let accepted = await signupArrived(env, space, first)
let redelivered = await signupArrived(env, space, first)
await drain(store)
await spaceArrived(env, space, arrival('+12695550143'))
await drain(store)
await spaceArrived(env, space, arrival('+12695550100', 'Add Sunday to it'))
await drain(store)
let stranger = (await dir.phoned(first.from))!
let walkIn = (await dir.phoned('+12695550143'))!
let requests = await store.g.read('.operator_request')
let asked = (person: string) =>
  requests.filter((b) =>
    (b.operator_request as { person: string }).person == person
  )
let tools = (i: number) => seen[i].tools.map((t) => t.name).sort()
let offered = (i: number) => callable(seen[i])
let FORMS = signupTools(env, space, '', '').map((t) => t.name).sort()

test('a text to a space is answered by keyword, kept quiet after STOP, and otherwise is a seated person’s own or a sign-up', () => {
  let routes = [null, 'stop', 'start', 'help'].map((word) =>
    [null, 'viewer', 'editor', 'owner'].map((role) =>
      [false, true].map((stopped) =>
        textRoute(word, stopped, role as Role | null)
      )
    )
  )
  equal(routes, [
    [['signup', 'quiet'], ...Array(3).fill(['own', 'quiet'])],
    ...Array(3).fill(Array(4).fill(['control', 'control'])),
  ])
})

test('a text from someone with no seat in the space runs as them, with only form tools', async () => {
  equal([accepted, redelivered], [true, false])
  equal([tools(0), tools(1)], [FORMS, FORMS])
  equal([asked(stranger).length, asked(walkIn).length], [1, 1])
  equal(replies, ['Which form would you like?', 'Which form would you like?'])
  ok(!JSON.stringify(seen.slice(0, 2)).includes('Private member tool'))
  equal((await store.g.get([rootOf(spaceId, walkIn)]))[0], undefined)
})

test("a member's text to the space's number is theirs to their own Operator, with their reach", async () => {
  equal(memberTurns, 3)
  ok(offered(2).includes('unrelated'))
  ok(!tools(2).some((t) => t.startsWith('signup_')))
  equal(asked(member).length, 1)
  ok((await store.g.get([rootOf(spaceId, member)]))[0]?.operator_session)
  equal(memberTexts, ['+12695550100: Which form would you like?'])
})

let control = async (text: string) => {
  let response = await operatorReply(
    operator,
    spaceId,
    '/operator/control',
    { arrival: { ...first, id: crypto.randomUUID(), text } },
    () => {},
    stranger,
  )
  return await response.json()
}
let stopped = await control('STOP')
let after = await control('KIDS')
let helped = await control('HELP')
let started = await control('START')
let keyword = await signupArrived(env, space, arrival(first.from, 'HELP'))
test('STOP persists until START, and carrier keywords never start a model turn', () => {
  equal([stopped.stopped, after.stopped, helped.stopped, started.stopped], [
    true,
    true,
    true,
    false,
  ])
  equal(keyword, false)
  equal(memberTurns, 3)
})

let incoming = arrival('+12695550199')
await store.g.apply(textControl({ ...incoming, text: 'STOP' }))
let blocked = await textStopped(store.g, incoming)
await store.g.apply(textControl({ ...incoming, text: 'START' }))
let unblocked = await textStopped(store.g, incoming)
test('opt-out is scoped to the number texted, without granting announcement consent to a new texter', async () => {
  equal([blocked, unblocked], [true, false])
  equal(await textStopped(store.g, { ...incoming, to: '+12695550112' }), false)
})

let pending = crypto.randomUUID()
let request = requests.find((b) =>
  (b.operator_request as { person: string }).person == stranger
)!
await store.g.apply([
  ...textControl({ ...first, text: 'STOP' }),
  {
    entity: { eid: pending },
    operator_answer: {
      request: request.entity.eid,
      text: 'An answer queued before STOP',
    },
  },
])
await drain(store)
let [suppressed] = await store.g.get([pending])
test('STOP suppresses a queued sign-up answer before the carrier is called', () => {
  equal(replies.length, 2)
  ok(suppressed.bounced)
  equal(suppressed.delivered, undefined)
})

let memberTurns = seen.length, memberTexts = [...texts]
let viewer = crypto.randomUUID(), hidden = crypto.randomUUID()
await dir.apply({
  entities: [
    { entity: { eid: viewer }, person: {}, phone: { number: '+12695550144' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: viewer, space: spaceId, role: 'viewer' },
    },
    { entity: { eid: hidden }, space: { slug: 'hidden', store: 'hidden' } },
    {
      entity: { eid: crypto.randomUUID() },
      operator_reach: {
        operator: spaceId,
        space: hidden,
        role: 'editor',
      },
    },
    {
      entity: { eid: '$notices' },
      app: {
        slug: 'notices',
        space: spaceId,
        store: 'church/notices',
        version: 1,
        access: 'private',
      },
    },
  ],
}, { 'x-yak-person': member, 'x-yak-role': 'owner' })
let app = (await dir.app(space, 'notices'))!
await declared(env, space, app)
let at = stores(env, appVocab(), {
  app: { eid: app.eid, mode: 'private', manifest: {} },
})
await at('church/notices').graph.apply([
  {
    entity: { eid: crypto.randomUUID() },
    doc: { title: 'Sunday service at ten' },
  },
], { trusted: true })
await store.g.apply([
  {
    entity: { eid: crypto.randomUUID() },
    memory: {},
    doc: { title: 'Private Operator memory' },
  },
], { trusted: true })
let original = env.STORE, registrations: Record<string, unknown>[] = []
env.STORE = {
  ...original,
  get: (name, options) => {
    let door = original.get(name, options)
    return {
      fetch: async (req: Request) => {
        if (new URL(req.url).pathname != '/signup') return await door.fetch(req)
        registrations.push(await req.json())
        return Response.json([{ title: 'Sunday school' }])
      },
    }
  },
} as Env['STORE']

let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
script = [
  call('graph_query', { q: '.doc' }),
  call('signup_forms', {}),
  [{
    kind: 'assistant',
    text: 'Sunday service is at ten. You can sign up for Sunday school.',
  }],
]
await spaceArrived(env, space, arrival('+12695550144', 'What is on Sunday?'))
await drain(store)
let viewerRoot = (await store.g.get([rootOf(spaceId, viewer)]))[0]

test("a viewer's text reads only their reach and offers sign-up without writer tools or private Operator context", () => {
  equal(seen.length, 6)
  let transcript = JSON.stringify(seen.slice(3))
  ok(transcript.includes('Sunday service at ten'))
  ok(transcript.includes('Sunday school'))
  ok(!transcript.includes('Private Operator memory'))
  ok(!transcript.includes('hidden (editor)'))
  for (let name of FORMS) ok(tools(3).includes(name))
  for (let name of ['graph_apply', 'unrelated', 'text_send', 'memory_recall']) {
    ok(!offered(3).includes(name))
  }
  equal(registrations[0].person, viewer)
  equal(registrations[0].phone, '+12695550144')
  ok(viewerRoot?.operator_session)
  equal(
    texts.at(-1),
    '+12695550144: Sunday service is at ten. You can sign up for Sunday school.',
  )
})
