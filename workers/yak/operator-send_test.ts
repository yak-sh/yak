// session_send (operator-send.ts): one tool, a session id and a note. The
// owner-change case in a room, a thread waking another that tells its person
// there, is build_test.ts's.
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { type Reach, sessionSend } from './operator-send.ts'
import { wakeTools } from './operator-schedules.ts'
import { operatorMemory } from './operator-testing.ts'

let { env } = platform('operator-send')
let dir = directoryOf(env.STORE)
let [ada, bo, kit] = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
]
let space = (await dir.at(
  await dir.mint(ada, 'send-home', 'send-home', {
    'x-yak-person': ada,
    'x-yak-role': 'owner',
  }),
))!
await dir.apply({
  entities: [{
    entity: { eid: '$seat' },
    member: { space: space.eid, person: bo, role: 'editor' },
  }],
}, { 'x-yak-person': ada, 'x-yak-role': 'owner' })

// Ada's conversation and nested helpers; Bo's and Kit's conversations.
let store = operatorMemory()
let [adas, helper, nested, bos, kits] = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
]
let conversation = (eid: string, person: string): Bundle => ({
  entity: { eid },
  session: {},
  operator_session: { space: space.eid, person, conversation: true },
})
await store.g.apply([
  conversation(adas, ada),
  conversation(bos, bo),
  conversation(kits, kit),
  {
    entity: { eid: helper },
    session: {},
    spawned: { parent: adas },
    operator_session: { space: space.eid, person: ada },
  },
  {
    entity: { eid: nested },
    session: {},
    spawned: { parent: helper },
  },
], { trusted: true })

let MEMBER: Reach = { handoff: false, member: true }
let send = (
  person: string,
  from: string,
  args: Record<string, unknown>,
  reach = MEMBER,
) =>
  Promise.resolve(
    sessionSend(env, store, space, person, reach).run(
      { say: 'The explainer has a new owner.', ...args },
      {
        session: from,
        call: { entity: { eid: crypto.randomUUID() } },
        entries: [],
      },
    ),
  )
let requests = () => store.g.read(line`.operator_request.channel=thread&*`)

test("a note to one of the person's own sessions is its next words, from the sender", async () => {
  assertEquals(
    JSON.parse(String(await send(ada, adas, { session: helper }))),
    { session: helper, status: 'sent' },
  )
  let [said] = await store.g.read(
    line`.entry.session=${helper}&.entry.from=${`your session ${adas}`}&.content&*`,
  )
  assertEquals(
    (said.content as { body: string }).body,
    'The explainer has a new owner.',
  )
  assertEquals((said.entry as { from: string }).from, `your session ${adas}`)
})

test('parent wakes the session that started the helper', async () => {
  let say = 'The nested helper found the answer.'
  assertEquals(
    JSON.parse(String(await send(ada, nested, { session: 'parent', say }))),
    { session: helper, status: 'sent' },
  )
  let [said] = await store.g.read(
    line`.entry.session=${helper}&.entry.from=${`your session ${nested}`}&.content&*`,
  )
  assertEquals(said.content, { body: say })
})

test('parent from a session with no parent asks for an explicit id', async () => {
  await assertRejects(
    () =>
      send(ada, adas, { session: 'parent', space: 'send-home' }, {
        handoff: true,
        member: true,
      }),
    Error,
    'This session has no parent',
  )
})

test("a member's note wakes another person's conversation as their thread's words", async () => {
  await send(ada, helper, { session: bos })
  let [asked] = await requests()
  assertEquals(asked.operator_request, {
    space: space.eid,
    person: bo,
    channel: 'thread',
    about: bos,
    from: helper,
    address: 'someone',
    role: 'owner',
  })
})

test("a stranger wakes no thread but the room's it was addressed in, and nobody names their own", async () => {
  let refused = (person: string, from: string, session: string) =>
    assertRejects(
      () => send(person, from, { session }, { handoff: false, member: false }),
      Error,
      'No session',
    )
  await refused(kit, kits, adas)
  await refused(kit, kits, 'no-such-session')
  await assertRejects(
    () => send(ada, adas, { session: adas }),
    Error,
    'this session',
  )
})

test('a wake-up set in a helper wakes the conversation it works for', async () => {
  let set = wakeTools(store).find((t) => t.name == 'wake_set')!
  let told = JSON.parse(String(
    await set.run({ say: 'Look again.', at: '1h' }, {
      session: helper,
      call: { entity: { eid: crypto.randomUUID() } },
      entries: [],
    }),
  ))
  let [row] = await store.g.read(line`.wake.note=${'Look again.'}&*`)
  assertEquals(told.say, 'Look again.')
  assertEquals((row.wake as { target: string }).target, adas)
})
