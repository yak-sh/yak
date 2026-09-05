// The worked example: somebody joins, and a letter goes out.
//
// This is the slot @yaks/member documents and leaves empty. Adding a person to
// a roster usually means writing to them, but a roster package must not know
// what a mail server is — so the seat is written by one package, and the
// letter about it by this one, joined by nothing but a component name.
//
// What makes it worth reading is what it does NOT do: it does not send
// anything. It writes a letter INTO THE GRAPH, through the graph's own
// `apply()`, and the `created(mail)` effect in ./send.ts sends it like any
// other. So one mechanism carries invitations, receipts, reminders and
// replies, and an invitation that could not be delivered leaves the same
// `bounced` on the same kind of entity as everything else.
//
// It is written against the `member` component by NAME, so this file imports
// nothing from @yaks/member — the two packages meet at a word.

import type { Change, Comp, Eid } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import { DELIVER, MAIL } from './comp.ts'

/** The seat that was just taken, as the letter's author sees it. */
export type Seat = {
  /** the roster row's own entity id */
  eid: Eid
  /** who joined */
  person: Eid
  /** what they joined */
  space: Eid
  /** what they joined AS — whatever your roster's role column says */
  role: string
  /** the whole `member` component, for a roster with more columns than these */
  member: Comp
}

/** The letter to send about a new seat, or `null` to send none. */
export type Welcome = (seat: Seat) => {
  /** the address it comes from */
  from: string
  /** the subject line */
  subject: string
  /** the body, as markdown */
  body: string
} | null

/** How the handler is built. */
export type Invite = {
  /** compose the letter (or decline to) */
  welcome: Welcome
  /** the graph's own `apply` — the letter goes through the full pipeline */
  apply: (change: Change) => unknown
  /** the id for the new letter (default: a fresh uuid) */
  eid?: () => Eid
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
}

let str = (c: Comp, k: string): string => c[k] == null ? '' : String(c[k])

/**
 * The `created(member)` handler: write an invitation to whoever just joined.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { invited, sending, stash } from '@yaks/mail'
 *
 * let fx = effects(vocab)
 * fx.created('mail', sending({ sender: stash() }))
 * fx.created('member', invited({
 *   apply: (change) => club.apply(change),
 *   welcome: ({ person }) => ({
 *     from: 'hello@books.example',
 *     subject: 'You are in the book club',
 *     body: `Welcome. We meet Thursdays.\n\n[The reading list](https://books.example/list)`,
 *   }),
 * }))
 * ```
 *
 * The letter is addressed to the person as an ENTITY (`deliver.to`), not to a
 * string, so the address it actually goes to is whatever their `email` says at
 * the moment it leaves — and a person with no address on file gets a letter
 * stamped `bounced` saying exactly that, rather than silence.
 */
export let invited = (
  {
    welcome,
    apply,
    eid = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
  }: Invite,
): Handler =>
(event) => {
  let member = event.comp
  if (!member) return
  let person = str(member, 'person')
  if (!person) return
  let letter = welcome({
    eid: event.entity.eid,
    person,
    space: str(member, 'space'),
    role: str(member, 'role'),
    member,
  })
  if (!letter) return
  return apply([{
    entity: { eid: eid() },
    [MAIL]: {
      from: letter.from,
      subject: letter.subject,
      body: letter.body,
      at: now(),
      // The letter is ABOUT the seat: correspondence hangs off the thing it
      // concerns, so the roster row reads back with its own invitation.
      target: event.entity.eid,
    },
    [DELIVER]: { to: person },
  }])
}
