// A helper on its person's own machine: helper_spawn naming the space whose
// tunnel goes there asks the machine, through a stub gateway, to run an agent
// on the brief as the Operator in the person's conversation, and the
// machine's word about that run's task is the helper's report in its chat.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { mint } from '@yaks/graph'
import { CALLER } from '@yaks/tunnel'
import { answering } from '@yaks/model/step'
import { deliverChild, transcript } from '@yaks/session'
import { platform } from './directory-probe.ts'
import { directoryOf, META, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { rootAt } from './operator-root.ts'
import { call, type Ctx } from './tools.ts'
import { builderOf, SPACE } from './build-door.ts'

// The machine: each spawn it was asked for, what it answers one with, and
// the model steps of its owner's own turns, which it answers too
// (operator-machine_test.ts), counted.
let sent: {
  caller: string | null
  via: string | null
  body: unknown
}[] = []
let BOX = { task: mint(), session: mint() }
let steps = 0
let step = answering((req) => {
  steps++
  return Promise.resolve({
    id: mint(),
    model: req.model,
    items: [{ kind: 'assistant', text: 'Noted.' }],
  })
}, (e) => {
  throw e
})
let DISPATCH = {
  get: () => ({
    fetch: async (r: globalThis.Request) => {
      if (new URL(r.url).pathname != '/session/spawn') return step(r)
      sent.push({
        caller: r.headers.get(CALLER),
        via: r.headers.get('x-via'),
        body: await r.json(),
      })
      return Response.json({ ...BOX, names: { task: 'T-9', session: 'S-9' } })
    },
  }),
} as unknown as Env['DISPATCH']
let { env } = platform('operator-helpers-machine', { DISPATCH })
let dir = directoryOf(env.STORE)
let jeff = mint()
let eid = await dir.mint(jeff, 'jeffs', 'Jeff', {
  'x-yak-person': jeff,
  'x-yak-role': 'owner',
})
await stamp(env, {
  entities: [{
    entity: { eid },
    tunnel: { id: mint(), service: mint(), adopted: true },
  }, {
    entity: { eid: '$admin' },
    member: {
      space: (await dir.space(META.space))!.eid,
      person: jeff,
      role: 'owner',
    },
  }],
})

let service = operatorService(
  env,
  { person: jeff, space: eid, role: 'owner' },
  operatorModel((req) =>
    Promise.resolve({
      id: mint(),
      model: req.model,
      cost: 0.001,
      items: [{ kind: 'assistant', text: 'Noted.' }],
    })
  ),
)
env.BUILDER = service.binding
let g = service.store.g
let ctx: Ctx = { env, dir, person: jeff }
let chat = (await call(ctx, 'operator_chat', {
  space: 'jeffs',
  say: 'Fix the parser on my machine.',
})).value!
let parent = String(chat.session)
await service.drain()
let root = await rootAt(service.store, eid, jeff)
let before = steps
let spawned = (await call(ctx, 'helper_spawn', {
  space: 'jeffs',
  task: parent,
  title: 'Parser fix',
  brief: 'Fix the parser.',
  machine: 'jeffs',
})).value!
let helper = String(spawned.session)
await service.drain()
let [row] = await g.get([helper])
let modelAsked = steps - before

// The machine's word, as tunnel.ts `tell` brings it: the run's report, about
// the task it ran as there.
let told = (about: string, say: string, key = mint()) =>
  builderOf(env, eid)(() =>
    new Request('https://builder/operator/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-person': jeff,
        [SPACE]: eid,
      },
      body: JSON.stringify({
        say,
        request: { channel: 'machine', about },
        options: { id: key },
      }),
    })
  )
let heard = await told(BOX.task, 'T-9 — exited 0\n\nFixed it; checks pass.')
await service.drain()
await deliverChild(g, parent, Number.MAX_SAFE_INTEGER)
let reports = (await transcript(g, parent)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == helper
)
let closed = (await transcript(g, root)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == parent
)

test('a helper on the machine is one spawn asked of it as the Operator, in the conversation, and runs nothing here', () => {
  assertEquals(sent.length, 1)
  assertEquals(sent[0].caller, 'operator')
  assertEquals(sent[0].via, parent)
  assertEquals(sent[0].body, { brief: 'Fix the parser.', title: 'Parser fix' })
  assertEquals((row.spawned as Comp).parent, parent)
  assertEquals((row.operator_machine as Comp).task, BOX.task)
  assertEquals((row.operator_machine as Comp).names, 'T-9 S-9')
  assertEquals((row.operator_session as Comp).person, jeff)
  assertEquals(row.dispatch, undefined)
  assertEquals(modelAsked, 0)
})

test("the machine's word about its task is the helper's report, folded into the chat's closing notice", () => {
  assertEquals(heard.status, 200)
  assertEquals(reports.length, 1)
  assertStringIncludes(
    String((reports[0].content as Comp).body),
    'Fixed it; checks pass.',
  )
  assertEquals(closed.length, 1)
  assertStringIncludes(
    String((closed[0].content as Comp).body),
    'Fixed it; checks pass.',
  )
})

test('a machine no tunnel of this space reaches starts nothing', async () => {
  await assertRejects(
    () =>
      call(ctx, 'helper_spawn', {
        space: 'jeffs',
        task: parent,
        brief: 'Go.',
        machine: 'elsewhere',
      }),
    Error,
    'No machine of yours',
  )
  assertEquals(sent.length, 1)
})
