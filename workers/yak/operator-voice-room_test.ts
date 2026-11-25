import { equal, test } from '@yaks/testing'
import { discord } from '@yaks/discord'
import type { Comp } from '@yaks/graph'
import { inputOf } from '@yaks/session/intake'
import { guestOf, linked } from './chat.ts'
import { roomCall } from './chat-voice.ts'
import { owned } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { opened } from './lib/token.ts'
import { KERNEL, meta } from './meta.ts'
import type { Ticket } from './operator-calls.ts'
import { handleChannels, receive } from './operator-channels.ts'
import { drain } from './operator-store.ts'
import { callable, operatorMemory, operatorModel } from './operator-testing.ts'
import { operating } from './operator.ts'

let fixture = async (account: string) => {
  let { env, dir } = platform('voice-room', {
    MAIL: { send: () => Promise.resolve({ messageId: 'sent' }) },
  })
  let owner = crypto.randomUUID()
  let space = (await dir.at(await owned({ dir, person: owner }, 'barn')))!
  await meta(env).apply([{
    entity: { eid: owner },
    person: {},
    doc: { title: 'Ann' },
  }, {
    entity: { eid: crypto.randomUUID() },
    connection: {
      integration: 'discord-account',
      owner,
      account: 'ann',
      status: 'connected',
    },
  }], KERNEL)
  let room = {
    via: 'discord',
    connection: crypto.randomUUID(),
    server: 'barn',
    room: 'lounge',
  }
  let stream = new URL(await roomCall(env, space, room, 'ann'))
  let ticket = (await opened<Ticket>(
    'call',
    stream.searchParams.get('call')!,
    env.SESSION_SECRET!,
  ))!
  let member = await linked(env, discord, account)
  let writer = member ?? await guestOf(env, room.via, account)
  let store = operatorMemory()
  let tools: string[] = []
  let answered: string[] = []
  let model = operatorModel((req) => {
    let last = req.items.at(-1)
    let offered = callable(req)
    tools.push(...offered)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: last?.kind == 'result'
        ? [{ kind: 'assistant', text: last.output }]
        : offered.includes('member_add')
        ? [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'member_add',
          args: JSON.stringify({ email: 'jo@x.example', role: 'editor' }),
        }]
        : [{ kind: 'assistant', text: 'Please ask a space owner.' }],
      cost: 0,
    })
  })
  let operator = operating(store, env, model)
  handleChannels(operator, env, {
    voice: (request, answer) => {
      equal(request.person, ticket.person)
      answered.push(answer.text)
      return Promise.resolve({})
    },
  })
  let ask = async ({ heard = false, talking = false } = {}) => {
    let id = await receive(
      store,
      {
        space: ticket.space,
        person: ticket.person,
        channel: 'voice',
        address: member ? 'Ann' : 'Bo',
        reply_to: ticket.to,
        via: ticket.via,
        call: ticket.call,
        writer,
        ...member ? { linked: true } : {},
      },
      'Ember, invite Jo to the barn.',
      { heard },
    )
    if (talking) {
      await store.fx.work(store.g, undefined, { passes: 1 })
      await store.fx.idle()
      await operator.note(
        { person: ticket.person },
        space,
        'Can everyone hear me?',
        { call: ticket.call },
      )
    }
    await drain(store)
    let [request, intake] = await store.g.get([id, inputOf(id)])
    equal(request.failed, undefined)
    equal((intake.created as Comp).by, writer)
    return store.g.read('.operator_approval&*')
  }
  return { ask, answered, dir, owner, tools }
}

let ann = await fixture('ann')
test('a linked Discord voice speaker asks as the member, with no tap', async () => {
  equal(await ann.ask({ talking: true }), [])
  equal((await ann.dir.read('.invite')).length, 1)
  equal(ann.answered[0]?.includes('jo@x.example is invited'), true)
})

let bo = await fixture('bo')
test('an unlinked Discord voice speaker gets a guest turn', async () => {
  equal(await bo.ask(), [])
  equal(bo.tools.includes('member_add'), false)
  equal(bo.tools.includes('escalate'), true)
  equal(bo.answered, ['Please ask a space owner.'])
})

let steered = await fixture('ann')
test('a linked Discord voice turn steered by others asks the member to tap', async () => {
  let approvals = await steered.ask({ heard: true })
  equal(
    approvals.map((row) => {
      let approval = row.operator_approval as Comp
      return [approval.person, approval.tool, approval.number]
    }),
    [[steered.owner, 'member_add', undefined]],
  )
  equal((await steered.dir.read('.invite')).length, 0)
})
