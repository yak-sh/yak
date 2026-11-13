import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Request as ModelRequest } from '@yaks/model'
import { deliverChild, statusOf, transcript } from '@yaks/session'
import { helperParent } from './operator-helpers.ts'
import { CallError } from '@yaks/tools/errors'
import { directoryOf } from './directory.ts'
import { platform } from './directory-rows-probe.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { rootAt } from './operator-root.ts'
import { conversationOf } from './operator-host.ts'
import { helperHtml } from './operator-rows.ts'
import { call, type Ctx } from './tools.ts'

let person = crypto.randomUUID()
let { env } = platform('outside-helpers')
let dir = directoryOf(env.STORE)
let space = await dir.mint(person, 'home', 'Home', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let asked: ModelRequest[] = []
let service = operatorService(
  env,
  { person, space, role: 'owner' },
  operatorModel((req) => {
    asked.push(req)
    let question = JSON.stringify(req.items).includes('QUESTION_HELPER')
    let native = JSON.stringify(req.items).includes('NATIVE_HELPER')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      cost: 0.001,
      items: native && req.items.at(-1)?.kind != 'result'
        ? [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'spawn',
          args: JSON.stringify({
            title: 'Friday schedule check',
            prompt: 'NATIVE_REPORT: Check Friday.',
          }),
        }]
        : question && req.items.at(-1)?.kind != 'result'
        ? [{
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'decision_new',
          args: JSON.stringify({
            question: 'Choose Tuesday or Thursday.',
            recommended: 'Tuesday',
            choices: [{ label: 'Tuesday', description: 'Meet Tuesday.' }, {
              label: 'Thursday',
              description: 'Meet Thursday.',
            }],
          }),
        }]
        : [{
          kind: 'assistant',
          text: question
            ? 'The date needs your choice.'
            : 'Helper checked the schedule; Tuesday is free.',
        }],
    })
  }),
)
env.BUILDER = service.binding
let ctx: Ctx = { env, dir, person }
let chat = (await call(ctx, 'operator_chat', {
  space: 'home',
  say: 'Check the schedule privately.',
})).value!
let task = String(chat.task), parent = String(chat.session)
let root = await rootAt(service.store, space, person)
let before = await transcript(service.store.g, root)
let queued = (await call(ctx, 'helper_spawn', {
  space: 'home',
  task,
  title: 'Tuesday schedule check',
  brief: 'Check Tuesday.',
  model: 'helper-model',
})).value!
let helper = String(queued.session)
let [pending] = await service.store.g.get([helper])
let callsBefore = asked.length
await service.drain()
let reports = (await transcript(service.store.g, parent)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == helper
)
let mainWhileQuiet = await transcript(service.store.g, root)
let callsAfter = asked.length
let helperModel = asked.at(-1)!.model
let read = (await call(ctx, 'operator_read', { space: 'home', task: helper }))
  .value!
let [finished] = await service.store.g.get([helper])
await deliverChild(service.store.g, parent, Number.MAX_SAFE_INTEGER)
await deliverChild(service.store.g, parent, Number.MAX_SAFE_INTEGER)
let closed = (await transcript(service.store.g, root)).filter((b) => b.delivery)

test('helper_spawn returns a queued child of the caller chat; its passive report folds into one closing notice', () => {
  assertEquals(queued.parent, parent)
  assertEquals((pending.dispatch as Comp).state, 'queued')
  assertEquals((pending.spawned as Comp).parent, parent)
  assertEquals((pending.spawned as Comp).notice, true)
  assertEquals((pending.doc as Comp).title, 'Tuesday schedule check')
  assertEquals((finished.operator_session as Comp).person, person)
  assertEquals((finished.operator_session as Comp).administrative, undefined)
  assertEquals(reports.length, 1)
  assertEquals((reports[0].notice as Comp).child, helper)
  assertStringIncludes(
    (reports[0].content as Comp).body as string,
    'Tuesday is free',
  )
  assertEquals(mainWhileQuiet, before)
  assertEquals(callsAfter, callsBefore + 1)
  assertEquals(helperModel, 'helper-model')
  assertEquals(closed.length, 1)
  assertStringIncludes(
    (closed[0].content as Comp).body as string,
    'Tuesday is free',
  )
  assertEquals(statusOf(mainAfter), statusOf(before))
  assertEquals(JSON.stringify(read).includes('Tuesday is free'), true)
})
let mainAfter = await transcript(service.store.g, root)

let stopping = (await call(ctx, 'helper_spawn', {
  space: 'home',
  task: parent,
  brief: 'Check Thursday.',
})).value!
let stopped =
  (await call(ctx, 'operator_stop', { space: 'home', task: stopping.session }))
    .value!
test('operator_stop accepts a helper session returned by helper_spawn', () => {
  assertEquals(stopped.session, stopping.session)
  assertEquals(stopped.stopped, true)
})

let stranger = crypto.randomUUID()
await dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: { space, person: stranger, role: 'editor' },
  }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let refused = await Promise.allSettled([
  helperParent(service.store, { person: stranger, space }, task),
  helperParent(service.store, { person: stranger, space }, helper),
  call(ctx, 'helper_spawn', {
    space: 'home',
    task: root,
    brief: 'Use the main thread.',
  }),
  call(ctx, 'helper_spawn', { space: 'home', task, brief: ' ' }),
  call({ ...ctx, person: crypto.randomUUID() }, 'helper_spawn', {
    space: 'home',
    task,
    brief: 'Let me in.',
  }),
])
test('helper_spawn requires a caller-owned private chat, a writing seat, and a nonempty brief', () => {
  assertEquals(
    refused.map((r) => r.status == 'rejected' && r.reason instanceof CallError),
    [true, true, true, true, true],
  )
})

let questioning = (await call(ctx, 'helper_spawn', {
  space: 'home',
  task,
  brief: 'QUESTION_HELPER',
})).value!
await service.drain()
let questionNotices = (await transcript(service.store.g, root)).filter((b) =>
  (b.notice as Comp | undefined)?.child == questioning.session
)
test('a helper’s question for the person reaches the main thread passively before the chat closes', () => {
  assertEquals(questionNotices.length, 1)
  assertStringIncludes(
    (questionNotices[0].content as Comp).body as string,
    'Choose Tuesday or Thursday.',
  )
})

let nativeChat = (await call(ctx, 'operator_chat', {
  space: 'home',
  say: 'NATIVE_HELPER: use a helper.',
})).value!
let [nativeChild] = await service.store.g.read(
  `.spawned.parent=${nativeChat.session}&*`,
)
let nativeReports =
  (await transcript(service.store.g, String(nativeChat.session))).filter((b) =>
    (b.delivery as Comp | undefined)?.child == nativeChild.entity.eid
  )
test('the Operator’s own spawn tool also reports passively inside an outside chat', () => {
  assertEquals((nativeChild.spawned as Comp).notice, true)
  assertEquals(nativeReports.length, 1)
  assertEquals((nativeReports[0].notice as Comp).child, nativeChild.entity.eid)
})

let listed = (
  await conversationOf(service.store, '/operator', String(nativeChat.session))
).aside!
  .helpers
let done = listed.find((h) => h.session == nativeChild.entity.eid)!
test('the chat’s aside lists a helper by its title, with its recap and how long ago it ended', () => {
  assertEquals(done.title, 'Friday schedule check')
  assertEquals(done.recap, 'Helper checked the schedule; Tuesday is free.')
  let html = helperHtml(done, Date.parse(done.until!) + 2 * 86_400_000)
  assertStringIncludes(html, 'Done</')
  assertStringIncludes(html, '2 days ago')
  assertStringIncludes(
    html,
    'title="Helper checked the schedule; Tuesday is free."',
  )
})

let failing = (await call(ctx, 'helper_spawn', {
  space: 'home',
  task,
  brief: 'A check that fails.',
})).value!
await service.store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  entry: { session: String(failing.session) },
  output: {},
  exception: { type: 'Error', value: 'Schedule unavailable' },
  content: { body: 'Schedule unavailable' },
}], { trusted: true })
await deliverChild(service.store.g, String(failing.session))
await deliverChild(service.store.g, String(failing.session))
let failureParent = (await transcript(service.store.g, parent)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == failing.session
)
let failureMain = (await transcript(service.store.g, root)).filter((b) =>
  (b.notice as Comp | undefined)?.child == failing.session
)
test('a failed helper reports once to its chat and immediately to the main thread by notice', () => {
  assertEquals(failureParent.length, 1)
  assertEquals(failureMain.length, 1)
  assertEquals((failureParent[0].delivery as Comp).outcome, 'failed')
  assertStringIncludes(
    (failureMain[0].content as Comp).body as string,
    'Schedule unavailable',
  )
})
