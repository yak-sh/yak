import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Request } from '@yaks/model'
import { deliverChild, statusOf, transcript } from '@yaks/session'
import { directoryOf } from './directory.ts'
import { platform } from './directory-rows-probe.ts'
import { operating } from './operator.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { CHAT_QUIET, chatFork } from './operator-chat.ts'

let person = crypto.randomUUID()
let { env } = platform('outside-chat')
let dir = directoryOf(env.STORE)
let eid = await dir.mint(person, 'home', 'Home', {
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
let space = (await dir.at(eid))!
let held = { person }
let store = operatorMemory()
let asked: Request[] = []
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{
        kind: 'assistant',
        text: 'Done: checked the notes. Open: choose a date.',
      }],
      cost: 0.001,
    })
  }),
)
let main = await operator.ask({ ...held, administrative: true }, space, {
  say: 'Remember the blue notebook.',
})
await drain(store)
let first = await operator.run(held, space, { say: 'Check my notes.' })
let firstAsk = asked.at(-1)!
let [chat] = await store.g.get([first.session])
let original = await transcript(store.g, main.session)
let before = asked.length
let firstDue = await drain(store)
let second = await operator.run(held, space, {
  task: first.task,
  say: 'Which date is still open?',
})
let continued = asked.at(-1)!
let next = await drain(store)
let inputs = await store.g.read(
  `.entry.session=${first.session}&.using&!ask&.order=entry.seq&*`,
)
let deadline = Date.parse(String((inputs.at(-1)!.created as Comp).at)) +
  CHAT_QUIET
let notYet = await deliverChild(store.g, first.session, deadline - 1)
let during = await transcript(store.g, main.session)
await deliverChild(store.g, first.session, deadline)
await deliverChild(store.g, first.session, deadline)
let after = await transcript(store.g, main.session)
let notices = after.filter((b) => b.delivery)
let answerCount = asked.length
let quietAfterClosing = await drain(store)
let closedWork = await store.g.read('.spawned.notice=true&!completed')

// A new incarnation reads the persisted child and input timestamps, rather
// than relying on a timer or callback held by the first Operator instance.
let resumed = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{
        kind: 'assistant',
        text: 'Done: chose Tuesday. Open: nothing.',
      }],
      cost: 0.001,
    })
  }),
)
await resumed.run(held, space, { task: first.task, say: 'Choose Tuesday.' })
let ending = await drain(store)
await deliverChild(store.g, first.session, Number(ending))
let refreshed = (await transcript(store.g, main.session)).filter((b) =>
  b.delivery
)

// Explicit stop closes a settled chat immediately, even before quiet.
let stopping = await operator.run(held, space, { say: 'Check another note.' })
let stopped = await operator.stop(stopping.task, person)
await drain(store)
let stoppedNotice = (await transcript(store.g, main.session)).find((b) =>
  (b.delivery as Comp | undefined)?.child == stopping.session
)

test('an outside chat inherits the main context and continues privately with caller permissions', () => {
  assertEquals((chat.spawned as Comp).parent, main.session)
  assertEquals((chat.spawned as Comp).quiet, CHAT_QUIET)
  assertEquals((chat.operator_session as Comp).person, person)
  assertEquals((chat.operator_session as Comp).administrative, undefined)
  assertStringIncludes(JSON.stringify(firstAsk.items), 'blue notebook')
  assertStringIncludes(JSON.stringify(continued.items), 'Check my notes.')
  assertEquals(second.session, first.session)
  assertEquals(during, original)
  assertEquals(asked.length >= before + 1, true)
})

test('quiet closes once at the latest input deadline, without asking the main model', () => {
  assertEquals(firstDue != null, true)
  assertEquals(next, deadline)
  assertEquals(notYet, deadline)
  assertEquals(notices.length, 1)
  assertEquals(notices[0].notice != null, true)
  assertStringIncludes(
    (notices[0].content as Comp).body as string,
    'Check my notes.',
  )
  assertStringIncludes(
    (notices[0].content as Comp).body as string,
    'Which date is still open?',
  )
  assertStringIncludes(
    (notices[0].content as Comp).body as string,
    'choose a date',
  )
  assertEquals(statusOf(after), 'settled')
  assertEquals(answerCount, before + 1)
  assertEquals(quietAfterClosing, null)
  assertEquals(closedWork.length, 0)
})

test('a resumed chat refreshes its single notice and explicit stop closes immediately', () => {
  assertEquals(refreshed.length, 1)
  assertEquals(refreshed[0].entity.eid, notices[0].entity.eid)
  assertStringIncludes(
    (refreshed[0].content as Comp).body as string,
    'chose Tuesday',
  )
  assertEquals(stopped.stopped, true)
  assertEquals((stoppedNotice!.delivery as Comp).outcome, 'stopped')
})

let boundary = operatorMemory()
let root = crypto.randomUUID(), child = crypto.randomUUID()
let input = crypto.randomUUID(),
  ask = crypto.randomUUID(),
  call = crypto.randomUUID()
await boundary.g.apply([
  { entity: { eid: root }, session: { id: root } },
  { entity: { eid: child }, session: { id: child } },
  {
    entity: { eid: input },
    entry: { session: root },
    content: { body: 'Known context' },
    notice: {},
  },
  { entity: { eid: ask }, entry: { session: root }, ask: { through: input } },
  { entity: { eid: call }, entry: { session: root }, call: { source: ask } },
], { trusted: true })
let fork = await chatFork(boundary.g, root, child)
await boundary.g.apply(fork, { trusted: true })
let inherited = await transcript(boundary.g, child)

test('a chat fork excludes an unanswered parent tool turn', () => {
  assertEquals((fork.find((b) => b.fork)!.fork as Comp).from, input)
  assertEquals(
    inherited.some((b) => b.entity.eid == ask || b.entity.eid == call),
    false,
  )
})

let inflight = operatorMemory()
let activeRoot = crypto.randomUUID(), activeChild = crypto.randomUUID()
let known = crypto.randomUUID(),
  asking = crypto.randomUUID(),
  partial = crypto.randomUUID()
await inflight.g.apply([
  { entity: { eid: activeRoot }, session: { id: activeRoot } },
  { entity: { eid: activeChild }, session: { id: activeChild } },
  {
    entity: { eid: known },
    entry: { session: activeRoot },
    content: { body: 'Stable context' },
    notice: {},
  },
  {
    entity: { eid: asking },
    entry: { session: activeRoot },
    ask: { through: known },
    attempt: { by: activeRoot },
  },
  {
    entity: { eid: partial },
    entry: { session: activeRoot },
    output: { source: asking },
    content: { body: 'Unfinished answer' },
  },
], { trusted: true })
let activeFork = await chatFork(inflight.g, activeRoot, activeChild)

test('a chat fork excludes an in-flight response and its partial output', () => {
  assertEquals((activeFork.find((b) => b.fork)!.fork as Comp).from, known)
})

// A descendant remains in the sub-thread. The chat waits for that helper,
// even if its quiet interval has already passed.
let waiting = await operator.run(held, space, { say: 'Check with a helper.' })
let helper = crypto.randomUUID(), helperInput = crypto.randomUUID()
await store.g.apply([
  {
    entity: { eid: helper },
    session: { id: helper },
    spawned: { parent: waiting.session },
  },
  {
    entity: { eid: helperInput },
    entry: { session: helper },
    content: { body: 'Helper work' },
    using: {},
  },
], { trusted: true })
await deliverChild(store.g, waiting.session, Number.MAX_SAFE_INTEGER)
let whileHelping = (await transcript(store.g, main.session)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == waiting.session
)
await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  entry: { session: helper },
  output: { source: helperInput },
  content: { body: 'Helper checked the note.' },
}], { trusted: true })
await deliverChild(store.g, helper)
await drain(store)
await deliverChild(store.g, waiting.session, Number.MAX_SAFE_INTEGER)
let helperParent = (await transcript(store.g, waiting.session)).filter((b) =>
  (b.delivery as Comp | undefined)?.child == helper
)
let mainDeliveries = (await transcript(store.g, main.session)).filter((b) =>
  b.delivery
)

test('helpers report to the outside chat and hold its closing notice until they finish', () => {
  assertEquals(whileHelping.length, 0)
  assertEquals(helperParent.length, 1)
  assertEquals(helperParent[0].notice, undefined)
  assertEquals(
    mainDeliveries.some((b) => (b.delivery as Comp).child == helper),
    false,
  )
  assertEquals(
    mainDeliveries.filter((b) => (b.delivery as Comp).child == waiting.session)
      .length,
    1,
  )
})

let failed = await operator.run(held, space, { say: 'Check this failure.' })
await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  entry: { session: failed.session },
  output: {},
  exception: { type: 'Error', value: 'Could not finish the check' },
  content: { body: 'Could not finish the check' },
}], { trusted: true })
await deliverChild(store.g, failed.session)
let failure = (await transcript(store.g, main.session)).find((b) =>
  (b.delivery as Comp | undefined)?.child == failed.session
)

test('a failed outside chat closes before quiet with its outstanding work recorded', () => {
  assertEquals((failure!.delivery as Comp).outcome, 'failed')
  assertStringIncludes(
    (failure!.content as Comp).body as string,
    'work may remain',
  )
})
