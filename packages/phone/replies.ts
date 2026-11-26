// The words a number answers carrier keywords with: its campaign's own,
// kept as `keyword_replies{start, stop, help}` beside the number, and
// defaults naming whoever texts from it for any it does not give.

import type { Keyword } from './text.ts'

/** A number's own words for each keyword, as `keyword_replies` keeps them. */
export type Replies = Partial<Record<Keyword, string>>

/**
 * The words a number answers each keyword in: its own (`own`), and for any
 * it lacks, defaults naming `name`, whoever texts from it, with HELP giving
 * `office` to call where there is one. Each names the sender and says how to
 * opt out, as carriers require of these three answers.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replies } from '@yaks/phone'
 * let said = replies('Oak Hall', { stop: 'Oak Hall: Unsubscribed.' })
 * equal(said.stop, 'Oak Hall: Unsubscribed.')
 * equal(said.start.startsWith("Oak Hall: You're signed up for texts."), true)
 * equal(replies('Oak Hall', {}, '(269) 555-0100').help.includes('call (269) 555-0100'), true)
 * ```
 */
export let replies = (
  name: string,
  own: Replies = {},
  office = '',
): Record<Keyword, string> => ({
  start: own.start ||
    `${name}: You're signed up for texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
  stop: own.stop ||
    `${name}: You are unsubscribed and will get no more texts. Reply START to subscribe again.`,
  help: own.help ||
    `${name}: Reply here to reach us${
      office ? ` or call ${office}` : ''
    }. Msg & data rates may apply. Reply STOP to opt out.`,
})
