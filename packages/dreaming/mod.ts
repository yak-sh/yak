/**
 * What an agent returns to when nothing is asking. A `dream` is a standing
 * intention with a floor under it — do not come back before this — and `recall`
 * is what dreaming consolidates: how many times a memory has surfaced, and
 * when it last did. The `recalled` edge is one surfacing, said as a sentence,
 * and a `meta` memo is said for the dream to find rather than for anyone now.
 *
 * Beside the words, the one act: a dream whose floor has passed opens a DESK —
 * one transcript, asked in the dream's own words, holding the dream's `claim`
 * while it works. What opens is the host's to name, in the config beside the
 * plugin (`@yaks/dreaming/effects`); when it opens is this package's.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { opening } from '@yaks/dreaming'
 *
 * // let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * // fx.created('dream', opening({ desk: { model: 'O-1' }, rest: '1h' }))
 * ```
 *
 * @module
 */

export { dreamingDoc } from './vocab.ts'
export * from './desk.ts'
