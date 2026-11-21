// A press on the Operator's message in a chat room is answered for its
// presser alone (T-2360): a private message's words only to the one it is
// for, and an approval's Approve or Decline only as the person it asks.
import { equal, test } from '@yaks/testing'
import { line } from '@yaks/query'
import { accountEid, notice, type Press, PRIVATE } from '@yaks/chat'
import { operatorMemory } from './operator-testing.ts'
import { approvals, asker, ROOM } from './operator-approvals.ts'
import { pressAnswer } from './operator-private.ts'
import { chatRows } from './operator-rooms.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'

let store = operatorMemory()
let person = crypto.randomUUID(), session = crypto.randomUUID()
await store.g.apply([{ entity: { eid: session }, session: {} }], {
  trusted: true,
})
let ran: string[] = []
let approve = approvals(store, (a) => {
  ran.push(a.tool)
  return Promise.resolve('ran')
})
let press = (control: string, id = 'ann'): Press => ({
  id: 'i1',
  token: 'tok',
  control,
  room: 'general',
  server: 'barn',
  author: { id, name: id },
})
let answer = (control: string, id?: string, who?: string | null) =>
  pressAnswer(store, approve, {
    via: 'discord',
    press: press(control, id),
    who,
  })

let room = crypto.randomUUID()
let secret = crypto.randomUUID()
let controls = [{ id: 'approve:x', label: 'Approve' }]
await store.g.apply([
  ...chatRows('discord', {
    entity: { eid: secret },
    chat_message: { room, connection: 'c1', message_id: 'm1' },
  }, { eid: secret, text: 'Your code is 4411.', to: 'ann', controls }),
  {
    entity: { eid: accountEid('discord', 'ann') },
    chat_account: { via: 'discord', id: 'ann', name: 'Ann' },
  },
], { trusted: true })

test('a private message is one row, posted as a notice, whose words and buttons show only to its reader', async () => {
  let [row] = await store.g.get([secret])
  equal(row.chat_private, { to: 'ann' })
  equal(notice(secret, 'ann').controls, [{
    id: PRIVATE + secret,
    label: 'Show me',
  }])
  equal(await answer(PRIVATE + secret), {
    text: 'Your code is 4411.',
    controls,
  })
  equal(await answer(PRIVATE + secret, 'bo'), {
    text: 'This one is for Ann alone.',
  })
  equal(await answer(PRIVATE + crypto.randomUUID()), {
    text: 'What this was for is gone.',
  })
})

test("an approval's Approve counts only from the account linked to its person, once; Decline spends it undone", async () => {
  let ask = asker(
    { SESSION_SECRET: 'secret' } as Env,
    store,
    { eid: crypto.randomUUID() } as Space,
    { person, session },
    () => Promise.resolve(),
  )
  let pending = async (say: string) => {
    await ask({ tool: 'member_add', args: { email: say }, say })
    let rows = await store.g.read(line`.operator_approval&*`)
    return rows.find((b) =>
      (b.operator_approval as { say: string }).say == say
    )!.entity.eid
  }
  let add = await pending('Add bo@x.com')
  equal(await answer(ROOM.approve + add, 'bo', crypto.randomUUID()), {
    text: 'Only the person this was asked of can answer it.',
  })
  equal(
    (await answer(ROOM.approve + add, 'bo', null)).text.includes('Profile'),
    true,
  )
  equal(ran, [])
  equal(await answer(ROOM.approve + add, 'ann', person), {
    text: 'Done: Add bo@x.com.',
  })
  equal(await answer(ROOM.approve + add, 'ann', person), {
    text: 'Add bo@x.com: answered already.',
  })
  equal(ran, ['member_add'])

  let other = await pending('Add cy@x.com')
  equal(await answer(ROOM.decline + other, 'ann', person), {
    text: 'Declined: Add cy@x.com. Nothing was done.',
  })
  equal(ran, ['member_add'])
})

test('a press of a control the Operator never posted says so', async () => {
  equal(await answer('other:1'), {
    text: 'This button does nothing any more.',
  })
})
