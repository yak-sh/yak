// Who a letter that arrived is from, and the reply that first answered it. An
// answer is a letter we sent about it, delivered: one whose `reply_to` names
// it, as `mail_reply` writes, or whose `target` does, as `mail_send` writes
// with `about`. Any other letter that later left for the same address (a
// notice, a code, a letter about something else) answers nothing. Computed
// from the letters, never stored.

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

/// answering({ entity: { eid: 's' }, mail: { reply_to: 'a' } }) -> ['a']
/// answering({ entity: { eid: 's' }, mail: { target: 'b' } }) -> ['b']
/// answering({ entity: { eid: 's' }, mail: { reply_to: 'a', target: 'a' } })
///   -> ['a']
/** The letters a letter we sent answers: the one it replies to and the one it
 * is about. The one definition of an answer, for whatever reads them. */
export let answering = (sent: Bundle): string[] => {
  let mail = comp(sent, 'mail')
  return [...new Set([mail.reply_to, mail.target])]
    .filter((v): v is string => typeof v == 'string' && v != '')
}

/** The query for letters we sent that may answer one, delivered since
 * `from`: every letter {@link answering} reads something from. */
export let answersSince = (from: string): string =>
  `.delivered.at>=${from} (.mail.reply_to | .mail.target) ?mail ?delivered`

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
/// let about = { entity: { eid: 'n' }, mail: { target: 'a' },
///   delivered: { at: '2026-10-12T10:30:00Z' } }
/// answers([got('a', '2026-10-12T10:00:00Z')], [about])[0].answer?.entity.eid
///   -> 'n'
/** Each letter with the first delivered reply to it. */
export let answers = (letters: Bundle[], sent: Bundle[]): Answered[] => {
  let first = new Map<string, Bundle>()
  for (
    let b of sent.filter((b) => !Number.isNaN(left(b)))
      .sort((a, b) => left(a) - left(b))
  ) {
    for (let to of answering(b)) if (!first.has(to)) first.set(to, b)
  }
  return letters.map((letter) => {
    let answer = first.get(letter.entity.eid)
    return answer
      ? { letter, answer, ms: left(answer) - arrived(letter) }
      : { letter }
  })
}
