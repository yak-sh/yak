/**
 * Background work an agent does when nobody is asking it anything. A `dream`
 * is a standing intention whose `floor` column is the earliest it may run
 * again; `recall` is what dreaming consolidates — how many times a memory has
 * been recalled, and when it last was. A `recalled` edge records one such
 * recall, and a `meta` component marks text written for a dream to read later
 * rather than for anyone right now.
 *
 * Besides those components, this package does one thing: when a dream's floor
 * has passed it opens a desk — one agent session, asked the dream's own body
 * text, holding the dream's `claim` while it runs. What is opened is named in
 * the configuration beside the plugin (`@yaks/dreaming/effects`); when it
 * opens is this package's decision.
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
