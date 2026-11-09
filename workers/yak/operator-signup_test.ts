import { equal, ok, test } from '@yaks/testing'
import type { Request as ModelRequest } from '@yaks/model'
import type { Arrival } from '@yaks/phone'
import { platform } from './directory-rows-probe.ts'
import { operating } from './operator.ts'
import { handleChannels } from './operator-channels.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operatorReply, operatorRequest } from './operator-host.ts'
import { signupArrived, textControl, textStopped } from './operator-signup.ts'
import { drain } from './operator-store.ts'
import { rootOf } from './operator-root.ts'

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
let seen: ModelRequest[] = [], replies: string[] = []
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
      items: [{ kind: 'assistant', text: 'Which form would you like?' }],
    })
  }),
})
handleChannels(operator, env, {
  signup: (_, answer) => {
    replies.push(answer.text)
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
          { person, space: spaceId, role: 'viewer' },
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
await signupArrived(env, space, arrival('+12695550100'))
await drain(store)
let stranger = (await dir.phoned(first.from))!
let requests = await store.g.read('.operator_request')
let sessions = await store.g.read('.operator_session')

test('inbound sign-ups run as the sender, with only form tools even when they own the space', () => {
  equal([accepted, redelivered], [true, false])
  equal(seen.length, 2)
  for (let req of seen) {
    equal(req.tools.map((t) => t.name).sort(), [
      'signup_answer',
      'signup_forms',
      'signup_mine',
      'signup_start',
    ])
  }
  equal(
    requests.map((b) => (b.operator_request as { person: string }).person)
      .sort(),
    [stranger, member].sort(),
  )
  equal(replies, ['Which form would you like?', 'Which form would you like?'])
  ok(sessions.every((b) => b.entity.eid != rootOf(spaceId, member)))
  ok(!JSON.stringify(seen).includes('Private member tool'))
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
  equal(seen.length, 2)
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
