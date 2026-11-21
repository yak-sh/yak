// An approval as a line of its person's conversation (operator-approvals.ts):
// what its row holds, the digest its link and its card are bound to, and the
// card the web draws of it. Pure, so the browser's conversation draws it too.
import type { Bundle } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'
import { Button, Card } from '@yaks/ui/parts'
import { h } from 'preact'

type Args = Record<string, unknown>

/** How long an act waits for its person's answer: long enough to be
 * answered from their Updates or an alert once they are back, not only
 * while they watch the conversation. */
export let LIFE = 7 * 24 * 60 * 60_000

/** The choices an approval offers, as a decision's (@yaks/task). */
export let CHOICE = { approve: 'Approve', decline: 'Decline' }

/** An approval as what it asks of its person, a decision assigned to them
 * in the space: Needs you in their Updates and alerted the way they chose
 * (operator-alerts.ts), answered by Approve or Decline from any of them. */
export let asking = (a: Pick<Approval, 'person' | 'say'>, space: string) => ({
  task: {},
  doc: { title: `${a.say}?` },
  decision: {
    question: `${a.say}?`,
    choices: [
      { label: CHOICE.approve, description: 'Do it now.' },
      { label: CHOICE.decline, description: "Don't do it." },
    ],
  },
  filed: { assignee: a.person, project: space },
})

/** An act waiting for a tap, as its row keeps it. */
export type Approval = {
  person: string
  /** the session whose call asked, whose tools run it */
  session: string
  tool: string
  args: Args
  /** what it does, in the person's words */
  say: string
  /** where the link was texted; absent where the person approves on its
   * card in their chat or on a link in the Operator's answer, which only
   * they, signed in, open */
  number?: string
  expires: string
}

// The JSON of `v` with its keys in order, so a row read back from the store
// digests as it did when written.
let sorted = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(sorted).join(',')}]`
    : v && typeof v == 'object'
    ? `{${
      Object.keys(v).sort().map((k) =>
        `${JSON.stringify(k)}:${sorted((v as Args)[k])}`
      ).join(',')
    }}`
    : JSON.stringify(v ?? null)

/** The act a link is bound to: everything its row says, in 128 bits,
 * which the seal's mac keeps anyone from choosing. */
export let digestOf = (a: Approval) =>
  sha256(
    sorted([a.person, a.session, a.tool, a.args, a.say, a.number, a.expires]),
  ).slice(0, 32)

// How a card's approval stands, in a line under what it would do.
let CARD = {
  waiting: 'Nothing happens until you approve it, here or in your Updates.',
  approved: 'Approved.',
  approving: 'Approved in your Updates. Carrying it out…',
  declined: 'Declined. Nothing was done.',
  expired: 'This waited too long. Ask again if you still want it.',
}

/** An approval as a line of its person's conversation: a card saying what
 * it would do, with Approve and Decline the page's script presses in place
 * (operator-page.ts), or, once answered here or anywhere else or expired,
 * how it stands. */
export let approvalCard = (b: Bundle, now = Date.now()) => {
  let a = b.operator_approval as Approval
  let choice = (b.decided as { choice?: string } | undefined)?.choice
  let state: keyof typeof CARD = b.verified
    ? 'approved'
    : b.declined || (choice && choice != CHOICE.approve)
    ? 'declined'
    : choice
    ? 'approving'
    : Date.parse(a.expires) < now
    ? 'expired'
    : 'waiting'
  return h(
    Card,
    {
      'data-approval': b.entity.eid,
      'data-digest': digestOf(a),
      'data-state': state,
    },
    h(Card.Head, null, h(Card.Title, null, `${a.say}?`)),
    h(Card.Sub, { role: 'status', 'data-approval-status': '' }, CARD[state]),
    state == 'waiting'
      ? h(
        Card.Actions,
        null,
        h(
          Button,
          { mod: 'go', type: 'button', 'data-act': 'approve' },
          'Approve',
        ),
        h(Button, { type: 'button', 'data-act': 'decline' }, 'Decline'),
      )
      : null,
  )
}
