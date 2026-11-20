/**
 * Whether a turn is the listener's: the conversation logic every channel
 * shares, a group text, a chat room or a call alike (D-465). A channel says
 * only whether words were said where others hear them (`group`) and whether
 * they were said to the listener (`to`: naming it, replying to it, or to it
 * alone). The listener reads everything it hears; in a group it answers only
 * when the words are for it and their speaker is done, and otherwise answers
 * {@link PASS}, which says nothing anywhere. A pause is not a turn.
 *
 * @module
 */

/** What the listener answers to stay quiet: a turn answered with it alone is
 * kept in its transcript and sent nowhere ({@link passes}). */
export let PASS = '(listening)'

/** Whether an answer is {@link PASS}, which no channel sends.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { passes } from '@yaks/session/turn'
 * equal(passes(' (listening)\n'), true)
 * equal(passes('Sure, (listening) to you.'), false)
 * ```
 */
export let passes = (text: string): boolean => text.trim() == PASS

/** Whether `text` names the listener by one of `names`, as words of their
 * own, in any case: how a channel without mentions (a group text) knows the
 * words were said to it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { named } from '@yaks/session/turn'
 * equal(named('Hey Mabel, what time is it?', ['Mabel', 'operator']), true)
 * equal(named('ask the operator', ['Mabel', 'operator']), true)
 * equal(named('Mabelle said so', ['Mabel']), false)
 * ```
 */
export let named = (text: string, names: string[]): boolean =>
  names.filter((n) => n.trim()).some((n) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped(n.trim())}($|[^\\p{L}\\p{N}])`,
      'iu',
    )
      .test(text)
  )

let escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What the listener is told before words, about whose turn it is: nothing
 * where they were said to it alone; in a group, that everyone in it reads the
 * answer, whether the words were said to it, and when to answer {@link PASS}.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { cue } from '@yaks/session/turn'
 * equal(cue({ group: false, to: true }), '')
 * equal(cue({ group: true, to: false }).includes('not said to you'), true)
 * equal(cue({ group: true, to: true }).includes('not said to you'), false)
 * ```
 */
export let cue = (said: { group: boolean; to: boolean }): string =>
  said.group
    ? `In a group: everyone in it reads your answer.${
      said.to ? '' : ' These words were not said to you.'
    } Answer only when they are for you and their speaker is done; while people talk among themselves, or someone is thinking aloud and more is coming, answer ${PASS} alone, which sends nothing. `
    : ''
