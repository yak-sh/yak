// The key an output is built under, and the content hash each input
// contributes to it.
//
// A key is the SHA-256 of three things: the instruction, the model, and each
// input's content hash. Nothing else that could vary between two builds goes
// in, so an unchanged key means the output already built still answers, and a
// changed one means it no longer does.
//
// An input's content is what someone wrote on it: every property a client
// may write, on every component it wears. Server-owned bookkeeping is left out —
// `created` and `updated` stamps, counters like `recall` — because it moves
// without anything being said differently, and a key that moved with it would
// rebuild for nothing. A component with no properties at all is a tag whose
// presence is the fact, so it counts. The vocabulary says which is which, so
// this file names no component.

import { type Eid, sha256 } from '@yaks/graph'
import { content } from '@yaks/kernel'

/**
 * The content hash of an entity: SHA-256 over its client-written properties, in a
 * fixed order.
 *
 * ```ts
 * import { content } from '@yaks/builders'
 *
 * // let hash = content(vocab)(await g.get(eid))
 * ```
 */
export { content }

/** An input as a key reads it: its id, and the hash of its content. */
export type Input = [eid: Eid, hash: string]

/**
 * The key: SHA-256 over the instruction, the model, and each input's id and
 * content hash, taken in id order so the order links were written in does not
 * matter.
 *
 * ```ts
 * import { key } from '@yaks/builders'
 *
 * key('Summarize.', 'O-1', [['m-2', 'b…'], ['m-1', 'a…']])
 * // the same as key('Summarize.', 'O-1', [['m-1', 'a…'], ['m-2', 'b…']])
 * ```
 */
export let key = (
  instruction: string,
  model: string,
  inputs: Input[],
): string =>
  sha256(JSON.stringify([
    instruction,
    model,
    inputs.toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ]))
