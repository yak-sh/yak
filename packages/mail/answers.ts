// Who a letter that arrived is from, and the reply that first answered it. An
// answer is a letter in its thread: one whose `reply_to` names it, as
// `mail_reply` writes, delivered. Any other letter that later left for the
// same address (a notice, a code, a letter about something else) answers
// nothing. Computed from the letters, never stored.

import type { Bundle, Comp } from '@yaks/graph'

let comp = (b: Bundle, name: string) => (b[name] ?? {}) as Comp
let lower = (v: unknown) => typeof v == 'string' ? v.trim().toLowerCase() : ''
let time = (v: unknown) => Date.parse(typeof v == 'string' ? v : '')

/// sender({ entity: { eid: 'l' },
///   mail: { from: 'hello@bot.example', reply_address: 'Ann@Example.com' } })
///   -> 'ann@example.com'
/// sender({ entity: { eid: 'l' }, mail: { from: 'bob@example.com' } })
///   -> 'bob@example.com'
/** Where an answer to a letter that arrived goes, lowercased. */
export let sender = (letter: Bundle): string =>
  lower(comp(letter, 'mail').reply_address) || lower(comp(letter, 'mail').from)

/// automated('noreply@notify.cloudflare.com') -> true
/// automated('no-reply@accounts.example') -> true
/// automated('mailer-daemon@mx.example') -> true
/// automated('0100019f-a1b2@bounce.example') -> true
/// automated('ann@example.com') -> false
/** Whether an address is a machine's: a no-reply, a bounce or a notifier,
 * which nobody reads an answer at. */
export let automated = (address: string): boolean =>
  /^(?:no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?)@/i
    .test(address) ||
  /@(?:[\w-]+\.)*(?:bounce|notify|envelope)\./i.test(address)

/** When a letter that left was delivered; NaN while it has not. */
export let left = (sent: Bundle): number => time(comp(sent, 'delivered').at)

/** When a letter arrived. */
export let arrived = (letter: Bundle): number => time(comp(letter, 'mail').at)

export type Answered = {
  letter: Bundle
  /** the first delivered reply to it, if one has left */
  answer?: Bundle
  /** from its arrival to that answer's delivery */
  ms?: number
}

/// let got = (eid, at) => ({ entity: { eid }, mail: { from: 'a@x.com', at } })
/// let reply = (eid, to, at) => ({ entity: { eid }, mail: { reply_to: to },
///   ...(at ? { delivered: { at } } : {}) })
/// let [a, b] = answers(
///   [got('a', '2026-10-12T10:00:00Z'), got('b', '2026-10-12T10:00:00Z')],
///   [reply('r2', 'a', '2026-10-12T12:00:00Z'),
///     reply('r1', 'a', '2026-10-12T11:00:00Z'), reply('rb', 'b')],
/// )
/// [a.answer?.entity.eid, a.ms, b.answer] -> ['r1', 3_600_000, undefined]
/** Each letter with the first delivered reply to it. */
export let answers = (letters: Bundle[], sent: Bundle[]): Answered[] => {
  let first = new Map<string, Bundle>()
  for (
    let b of sent.filter((b) => !Number.isNaN(left(b)))
      .sort((a, b) => left(a) - left(b))
  ) {
    let to = String(comp(b, 'mail').reply_to ?? '')
    if (to && !first.has(to)) first.set(to, b)
  }
  return letters.map((letter) => {
    let answer = first.get(letter.entity.eid)
    return answer
      ? { letter, answer, ms: left(answer) - arrived(letter) }
      : { letter }
  })
}
