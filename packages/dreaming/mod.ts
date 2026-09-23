/**
 * Background work an agent does when nobody is asking it anything. A `dream`
 * is a standing intention filed under a project; `recall` is what dreaming
 * consolidates — how many times a memory has been recalled, and when it last
 * was. A `recalled` edge records one such recall, and a `meta` component marks
 * text written for a dream to read later rather than for anyone right now.
 *
 * A dream runs as a @yaks/builders builder: it wears `builder` beside `dream`,
 * its `doc` body is the instruction, and @yaks/builders decides when a session
 * opens on it and keeps what that session answered as its output. This package
 * runs nothing itself.
 *
 * @module
 */

export { dreamingDoc } from './vocab.ts'

/** The components this package declares. */
export let DREAM = 'dream'
export let RECALL = 'recall'
