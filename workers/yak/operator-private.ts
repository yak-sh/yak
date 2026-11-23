// What the Operator answers a press of a button on one of its messages in a
// chat room, said to the presser alone (@yaks/chat `Presses`, Discord's
// ephemeral messages; chat.ts `pressedOn` holds the press and says it):
//
// - Show me, on a private message (`chat_private{to}`, chat_send's `to`):
//   its words and buttons, to the one account it is for; anyone else is
//   told whom it is for, and nothing of it.
// - Approve or Decline, on an approval sent there (operator-approvals.ts
//   `ROOM`): the approval answered as the person the presser's linked
//   account is, which the approval's own rule decides (`approvals`), as a
//   press of its link signed in as them would be.

import type { Bundle, Comp } from '@yaks/graph'
import { accountEid, type Answer, type Press, PRIVATE } from '@yaks/chat'
import type { Control } from '@yaks/host/senders'
import {
  type Approval,
  type approvals,
  digestOf,
  ROOM,
  type Standing,
} from './operator-approvals.ts'
import type { OperatorStore } from './operator-store.ts'

type Store = Pick<OperatorStore, 'g'>

let comp = (b: Bundle | null | undefined, name: string) =>
  (b?.[name] ?? {}) as Comp

// What a press of Approve or Decline came to, as its presser reads it.
let standing = (s: Standing, who?: string | null): string => {
  let say = s.say ?? 'This'
  switch (s.state) {
    case 'done':
      return `Done: ${say}.`
    case 'declined':
      return `Declined: ${say}. Nothing was done.`
    case 'used':
      return `${say}: answered already.`
    case 'expired':
      return `${say}: this waited too long. Ask again if you still want it.`
    case 'failed':
      return `${say}: it did not go through. ${s.said ?? ''}`.trim()
    case 'forbidden':
      return s.said!
    case 'theirs':
      return who
        ? 'Only the person this was asked of can answer it.'
        : "Only the person this was asked of can answer it, from the Discord account they linked on yaks.app's Profile."
    case 'waiting':
      return `${say}?`
    default:
      return 'What this was for changed or is gone. Ask again.'
  }
}

/** The answer to `press`, a press on `via` by the person `who` (the one its
 * presser's account is linked to, if any), for its presser alone. A press
 * of a control the Operator never posted says so. */
export let pressAnswer = async (
  store: Store,
  approve: ReturnType<typeof approvals>,
  { via, press, who }: { via: string; press: Press; who?: string | null },
): Promise<Answer> => {
  let { control } = press
  if (control.startsWith(PRIVATE)) {
    let [row] = await store.g.get([control.slice(PRIVATE.length)])
    let m = comp(row, 'chat_message')
    let to = comp(row, 'chat_private').to
    if (!to || m.via != via) {
      return { text: 'What this was for is gone.' }
    }
    if (to != press.author.id) {
      let [account] = await store.g.get([accountEid(via, String(to))])
      let name = comp(account, 'chat_account').name
      return {
        text: `This one is for ${name ? String(name) : 'someone else'} alone.`,
      }
    }
    let controls = m.controls as Control[] | undefined
    return {
      text: String(comp(row, 'doc').body ?? ''),
      ...controls?.length ? { controls } : {},
    }
  }
  let act = Object.entries(ROOM).find(([, prefix]) =>
    control.startsWith(prefix)
  )
  if (act) {
    let eid = control.slice(act[1].length)
    let [row] = await store.g.get([eid])
    let a = row?.operator_approval as Approval | undefined
    if (!a) return { text: standing({ state: 'gone' }) }
    let decline = act[0] == 'decline'
    let s = await approve(eid, digestOf(a), {
      press: !decline,
      decline,
      who: who ?? null,
      room: true,
    })
    return { text: standing(s, who) }
  }
  return { text: 'This button does nothing any more.' }
}
